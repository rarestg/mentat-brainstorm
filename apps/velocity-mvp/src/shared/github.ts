import { getCached, setCached } from './cache';
import type { GitHubCommit, GitHubPullRequest, GitHubRepo } from './types';
import type { RepoRef } from './repoUrl';

const GITHUB_API = 'https://api.github.com';
const GITHUB_OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEFAULT_TTL_MS = 3 * 60 * 1000;
const MAX_COMMIT_PAGES = 10;
const MAX_MERGED_PR_PAGES = 60;
const GITHUB_FETCH_TIMEOUT_MS = 8_000;
const CI_VERIFICATION_CONCURRENCY = 4;
const CI_VERIFICATION_SOFT_CAP_MID = 150;
const CI_VERIFICATION_SOFT_CAP_HIGH = 250;

interface GitHubBranchMetadata {
  default_branch?: string;
}

interface GitHubCheckRun {
  status: string;
  conclusion: string | null;
}

interface GitHubCheckRunsResponse {
  total_count: number;
  check_runs: GitHubCheckRun[];
}

interface GitHubCombinedStatusResponse {
  state: string;
}

interface GitHubOAuthTokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

type VerificationConfidence = 'high' | 'medium' | 'low';

interface MergedPrIngestionMetadata {
  pagesFetched: number;
  maxPages: number;
  truncated: boolean;
}

interface CiVerificationMetadata {
  evaluatedPrs: number;
  totalMergedPrs: number;
  coverageRatio: number;
  cap: number;
  capped: boolean;
  confidence: VerificationConfidence;
}

export interface GitHubAuthenticatedUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
}

export interface AttributionOptions {
  authoredByHandle?: string;
}

function isBot(loginOrName: string | undefined): boolean {
  if (!loginOrName) {
    return false;
  }
  const v = loginOrName.toLowerCase();
  return v.includes('[bot]') || v.endsWith('bot');
}

function normalizeHandle(handle: string | undefined): string | null {
  if (!handle) {
    return null;
  }
  const normalized = handle.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function authoredByTarget(login: string | undefined, options?: AttributionOptions): boolean {
  const target = normalizeHandle(options?.authoredByHandle);
  if (!target) {
    return true;
  }
  return normalizeHandle(login) === target;
}

async function ghGet<T>(url: string, token?: string): Promise<T> {
  const cacheKey = `${url}|${token ?? 'anon'}`;
  const cached = getCached<T>(cacheKey);
  if (cached) {
    return cached;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, GITHUB_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'mentat-velocity-mvp',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`GitHub API request timed out after ${GITHUB_FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    const resetAt =
      reset && Number.isFinite(Number(reset))
        ? new Date(Number(reset) * 1000).toISOString()
        : undefined;
    const body = await response.text();
    if (
      (response.status === 403 || response.status === 429) &&
      (remaining === '0' || body.toLowerCase().includes('rate limit'))
    ) {
      const authHint = token
        ? 'GitHub token is set; wait for reset and retry.'
        : 'Set GITHUB_TOKEN to raise rate limits and retry.';
      const whenHint = resetAt ? ` Reset at ${resetAt}.` : '';
      throw new Error(`GitHub API rate limit reached.${whenHint} ${authHint}`);
    }
    throw new Error(`GitHub API ${response.status}: ${body.slice(0, 240)}`);
  }

  const json = (await response.json()) as T;
  setCached(cacheKey, json, DEFAULT_TTL_MS);
  return json;
}

function hasPassingCheckRuns(response: GitHubCheckRunsResponse): boolean {
  if (response.check_runs.length === 0) {
    return false;
  }

  const failingConclusions = new Set(['failure', 'timed_out', 'cancelled', 'startup_failure', 'action_required', 'stale']);
  const passingConclusions = new Set(['success', 'neutral', 'skipped']);

  for (const run of response.check_runs) {
    if (run.status !== 'completed') {
      return false;
    }
    if (run.conclusion && failingConclusions.has(run.conclusion)) {
      return false;
    }
  }

  return response.check_runs.some((run) => run.conclusion !== null && passingConclusions.has(run.conclusion));
}

async function resolveDefaultBranchTargets(ref: RepoRef, token?: string): Promise<{
  branchTargets: Set<string>;
  usedFallback: boolean;
}> {
  try {
    const metadata = await ghGet<GitHubBranchMetadata>(`${GITHUB_API}/repos/${ref.owner}/${ref.repo}`, token);
    const defaultBranch = metadata.default_branch?.trim();
    if (defaultBranch) {
      return { branchTargets: new Set([defaultBranch]), usedFallback: false };
    }
  } catch {
    // Fall through to branch fallback below.
  }

  return { branchTargets: new Set(['main', 'master']), usedFallback: true };
}

async function isMergeCommitCiVerified(ref: RepoRef, mergeCommitSha: string, token?: string): Promise<boolean> {
  const checkRunsUrl = `${GITHUB_API}/repos/${ref.owner}/${ref.repo}/commits/${mergeCommitSha}/check-runs?per_page=100`;
  try {
    const checks = await ghGet<GitHubCheckRunsResponse>(checkRunsUrl, token);
    if (checks.check_runs.length > 0) {
      return hasPassingCheckRuns(checks);
    }
  } catch {
    // Fall back to the combined status API.
  }

  const statusUrl = `${GITHUB_API}/repos/${ref.owner}/${ref.repo}/commits/${mergeCommitSha}/status`;
  try {
    const status = await ghGet<GitHubCombinedStatusResponse>(statusUrl, token);
    return status.state === 'success';
  } catch {
    return false;
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await mapper(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
}

function resolveCiVerificationCap(totalMergedPrs: number): number {
  if (totalMergedPrs <= 80) {
    return totalMergedPrs;
  }
  if (totalMergedPrs <= 300) {
    return CI_VERIFICATION_SOFT_CAP_MID;
  }
  return CI_VERIFICATION_SOFT_CAP_HIGH;
}

function toCoverageRatio(evaluatedPrs: number, totalMergedPrs: number): number {
  if (totalMergedPrs <= 0) {
    return 1;
  }
  return Math.round((evaluatedPrs / totalMergedPrs) * 10_000) / 10_000;
}

function inferVerificationConfidence(coverageRatio: number): VerificationConfidence {
  if (coverageRatio >= 0.95) {
    return 'high';
  }
  if (coverageRatio >= 0.6) {
    return 'medium';
  }
  return 'low';
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, GITHUB_FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`GitHub API request timed out after ${GITHUB_FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function describeOAuthError(payload: GitHubOAuthTokenResponse): string {
  if (payload.error_description) {
    return payload.error_description;
  }
  if (payload.error) {
    return payload.error;
  }
  return 'Unknown OAuth exchange error';
}

export async function exchangeGitHubOAuthCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri?: string;
  state?: string;
}): Promise<{ accessToken: string; tokenType: string; scope: string }> {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
  });
  if (input.redirectUri) {
    body.set('redirect_uri', input.redirectUri);
  }
  if (input.state) {
    body.set('state', input.state);
  }

  const response = await fetchWithTimeout(GITHUB_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'mentat-velocity-mvp',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const raw = await response.text();
    throw new Error(`GitHub OAuth token exchange failed (${response.status}): ${raw.slice(0, 240)}`);
  }

  const payload = (await response.json()) as GitHubOAuthTokenResponse;
  if (!payload.access_token) {
    throw new Error(`GitHub OAuth token exchange failed: ${describeOAuthError(payload)}`);
  }

  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type ?? 'bearer',
    scope: payload.scope ?? '',
  };
}

export async function fetchGitHubAuthenticatedUser(accessToken: string): Promise<GitHubAuthenticatedUser> {
  const user = await ghGet<GitHubAuthenticatedUser>(`${GITHUB_API}/user`, accessToken);
  if (!user?.login || !Number.isFinite(user.id)) {
    throw new Error('GitHub OAuth user payload missing required id/login fields');
  }
  return user;
}

export async function fetchCommitsForWindow(
  ref: RepoRef,
  since: string,
  until: string,
  token?: string,
  options?: AttributionOptions,
): Promise<GitHubCommit[]> {
  const all: GitHubCommit[] = [];

  for (let page = 1; page <= MAX_COMMIT_PAGES; page += 1) {
    const url = `${GITHUB_API}/repos/${ref.owner}/${ref.repo}/commits?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&per_page=100&page=${page}`;
    const pageData = await ghGet<GitHubCommit[]>(url, token);
    if (pageData.length === 0) {
      break;
    }
    all.push(...pageData);

    if (pageData.length < 100) {
      break;
    }
  }

  const deduped = new Map<string, GitHubCommit>();
  for (const commit of all) {
    if (isBot(commit.author?.login) || isBot(commit.commit.author.name)) {
      continue;
    }

    // Ignore merge commits to reduce noisy integration-only activity.
    if (commit.parents.length > 1) {
      continue;
    }

    if (!authoredByTarget(commit.author?.login, options)) {
      continue;
    }

    deduped.set(commit.sha, commit);
  }

  return [...deduped.values()];
}

export async function fetchMergedPrsForWindow(
  ref: RepoRef,
  since: string,
  until: string,
  token?: string,
  options?: AttributionOptions,
): Promise<{
  mergedPrs: GitHubPullRequest[];
  ciVerifiedMergedPrs: GitHubPullRequest[];
  usedDefaultBranchFallback: boolean;
  ingestion: MergedPrIngestionMetadata;
  ciVerification: CiVerificationMetadata;
}> {
  const all: GitHubPullRequest[] = [];
  const { branchTargets, usedFallback } = await resolveDefaultBranchTargets(ref, token);
  let pagesFetched = 0;
  let truncated = false;

  const sinceMs = Date.parse(since);
  const untilMs = Date.parse(until);
  for (let page = 1; page <= MAX_MERGED_PR_PAGES; page += 1) {
    const url = `${GITHUB_API}/repos/${ref.owner}/${ref.repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`;
    const pageData = await ghGet<GitHubPullRequest[]>(url, token);
    pagesFetched = page;
    if (pageData.length === 0) {
      break;
    }

    all.push(...pageData);

    const oldestUpdatedMs = pageData.reduce((oldest, pr) => {
      const updatedMs = Date.parse(pr.updated_at ?? '');
      if (!Number.isFinite(updatedMs)) {
        return oldest;
      }
      return Math.min(oldest, updatedMs);
    }, Number.POSITIVE_INFINITY);
    if (Number.isFinite(oldestUpdatedMs) && oldestUpdatedMs < sinceMs) {
      break;
    }

    if (pageData.length < 100) {
      break;
    }

    if (page === MAX_MERGED_PR_PAGES) {
      truncated = !Number.isFinite(oldestUpdatedMs) || oldestUpdatedMs >= sinceMs;
    }
  }

  const mergedPrs = all.filter((pr) => {
    if (!pr.merged_at || isBot(pr.user?.login)) {
      return false;
    }
    if (!authoredByTarget(pr.user?.login, options)) {
      return false;
    }
    if (!branchTargets.has(pr.base.ref)) {
      return false;
    }
    const mergedMs = Date.parse(pr.merged_at);
    return Number.isFinite(mergedMs) && mergedMs >= sinceMs && mergedMs < untilMs;
  });

  const verificationCap = resolveCiVerificationCap(mergedPrs.length);
  const prsForVerification = mergedPrs.slice(0, verificationCap);
  const verification = await mapWithConcurrency(prsForVerification, CI_VERIFICATION_CONCURRENCY, async (pr) => ({
    pr,
    ciVerified:
      typeof pr.merge_commit_sha === 'string' && pr.merge_commit_sha.length > 0
        ? await isMergeCommitCiVerified(ref, pr.merge_commit_sha, token)
        : false,
  }));
  const coverageRatio = toCoverageRatio(prsForVerification.length, mergedPrs.length);

  return {
    mergedPrs,
    ciVerifiedMergedPrs: verification.filter((item) => item.ciVerified).map((item) => item.pr),
    usedDefaultBranchFallback: usedFallback,
    ingestion: {
      pagesFetched,
      maxPages: MAX_MERGED_PR_PAGES,
      truncated,
    },
    ciVerification: {
      evaluatedPrs: prsForVerification.length,
      totalMergedPrs: mergedPrs.length,
      coverageRatio,
      cap: verificationCap,
      capped: mergedPrs.length > verificationCap,
      confidence: inferVerificationConfidence(coverageRatio),
    },
  };
}

export async function fetchTopReposForUser(handle: string, token?: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  for (let page = 1; page <= 2; page += 1) {
    const url = `${GITHUB_API}/users/${handle}/repos?type=owner&sort=updated&per_page=100&page=${page}`;
    const pageData = await ghGet<GitHubRepo[]>(url, token);
    if (pageData.length === 0) {
      break;
    }
    repos.push(...pageData);
    if (pageData.length < 100) {
      break;
    }
  }

  return repos
    .filter((repo) => !repo.fork)
    .sort((a, b) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
    .slice(0, 3);
}

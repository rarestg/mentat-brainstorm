import { fetchCommitsForWindow, fetchMergedPrsForWindow } from './github';
import { buildMetrics, computeWindowSummary } from './metrics';
import { parseRepoUrl, toRepoUrl, type RepoRef } from './repoUrl';
import type { AttributionTransparency, RepoReportCard } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScanOptions {
  attribution?: {
    mode?: AttributionTransparency['mode'];
    handle?: string;
  };
}

function atUtcMinute(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCSeconds(0, 0);
  return copy;
}

function getWindows(nowInput?: Date): {
  now: Date;
  currentStart: Date;
  previousStart: Date;
} {
  const now = atUtcMinute(nowInput ?? new Date());
  const currentStart = new Date(now.getTime() - 30 * DAY_MS);
  const previousStart = new Date(now.getTime() - 60 * DAY_MS);
  return { now, currentStart, previousStart };
}

function normalizeHandle(handle: string | undefined): string | undefined {
  if (!handle) {
    return undefined;
  }
  const trimmed = handle.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveAttribution(options?: ScanOptions): AttributionTransparency {
  const requestedMode = options?.attribution?.mode;
  const requestedHandle = options?.attribution?.handle;
  const targetHandle = normalizeHandle(requestedHandle);
  if (requestedMode === 'handle-authored' && targetHandle) {
    return {
      mode: 'handle-authored',
      source: 'github-author-login-match',
      targetHandle,
      strict: true,
      productionReady: true,
      notes: `Strict handle-authored attribution is active. Commits and merged PRs are counted only when GitHub author login matches @${targetHandle}.`,
      policy: 'strict-login-match-only',
      confidence: 'high',
      ambiguity: 'low',
      repoWideImplications: 'No repo-wide collaborator activity is counted in this mode.',
    };
  }

  const fallbackReason =
    requestedMode === 'handle-authored'
      ? `Requested handle-authored attribution without a valid handle${requestedHandle ? ` ("${requestedHandle}")` : ''}; defaulted to repo-wide mode.`
      : 'No handle-authored attribution was requested; defaulted to repo-wide mode.';

  return {
    mode: 'repo-wide',
    source: 'github-author-login-match',
    strict: false,
    productionReady: true,
    notes:
      'Repo-wide attribution fallback is active. Metrics include all non-bot default-branch activity and can include collaborators beyond a single handle.',
    policy: 'repo-wide-non-bot-default-branch',
    confidence: 'contextual',
    ambiguity: 'elevated',
    repoWideImplications: 'Ownership is ambiguous because activity is not constrained to a strict handle login match.',
    fallbackReason,
  };
}

export async function scanRepoByUrl(repoUrl: string, token?: string, options?: ScanOptions): Promise<RepoReportCard> {
  let ref: RepoRef;
  try {
    ref = parseRepoUrl(repoUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid repository URL';
    throw new Error(`Invalid repository URL: ${message}`);
  }
  return scanRepo(ref, token, options);
}

export async function scanRepo(ref: RepoRef, token?: string, options?: ScanOptions): Promise<RepoReportCard> {
  const { now, currentStart, previousStart } = getWindows();
  const attribution = resolveAttribution(options);
  const authoredOptions =
    attribution.mode === 'handle-authored' && attribution.targetHandle
      ? { authoredByHandle: attribution.targetHandle }
      : undefined;

  const [currentCommits, previousCommits, currentMergedPrsResult, previousMergedPrsResult] = await Promise.all([
    fetchCommitsForWindow(ref, currentStart.toISOString(), now.toISOString(), token, authoredOptions),
    fetchCommitsForWindow(ref, previousStart.toISOString(), currentStart.toISOString(), token, authoredOptions),
    fetchMergedPrsForWindow(ref, currentStart.toISOString(), now.toISOString(), token, authoredOptions),
    fetchMergedPrsForWindow(ref, previousStart.toISOString(), currentStart.toISOString(), token, authoredOptions),
  ]);

  const currentSummary = computeWindowSummary({
    commits: currentCommits,
    mergedPrs: currentMergedPrsResult.mergedPrs,
    ciVerifiedMergedPrs: currentMergedPrsResult.ciVerifiedMergedPrs,
    start: currentStart,
    end: now,
    now,
    label: 'current30d',
  });

  const previousSummary = computeWindowSummary({
    commits: previousCommits,
    mergedPrs: previousMergedPrsResult.mergedPrs,
    ciVerifiedMergedPrs: previousMergedPrsResult.ciVerifiedMergedPrs,
    start: previousStart,
    end: currentStart,
    now,
    label: 'previous30d',
  });

  const usedDefaultBranchFallback = currentMergedPrsResult.usedDefaultBranchFallback || previousMergedPrsResult.usedDefaultBranchFallback;

  return {
    repo: {
      owner: ref.owner,
      name: ref.repo,
      url: toRepoUrl(ref),
    },
    scannedAt: now.toISOString(),
    attribution,
    assumptions: {
      offHoursDefinitionUtc: 'off-hours are unique commit-hour buckets outside 09:00-18:00 UTC.',
      equivalentEngineeringHoursFormula:
        'sum over 30 UTC days of min(12, 0.8*uniqueHours + 0.3*min(commits, 2*uniqueHours+1) + 1.5*min(ciVerifiedMergedPRs,3)).',
      defaultBranchScope: usedDefaultBranchFallback
        ? 'Default branch could not be resolved from repository metadata; merged PRs into main/master were evaluated.'
        : 'Merged PRs were evaluated only when targeting the repository default branch.',
      ciVerification:
        'CI-verified merged PRs require a merge commit SHA plus passing check-runs (or commit status success when checks are unavailable).',
    },
    metrics: buildMetrics(currentSummary, previousSummary),
    windows: [currentSummary, previousSummary],
  };
}

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCommitsForWindow, fetchMergedPrsForWindow } from './github';

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchMergedPrsForWindow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('treats merged PRs with missing merge commit SHA as CI-unverified', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/acme/missing-merge-sha')) {
        return createJsonResponse({ default_branch: 'main' });
      }
      if (url.includes('/repos/acme/missing-merge-sha/pulls?')) {
        return createJsonResponse([
          {
            id: 1,
            merged_at: '2026-01-15T00:00:00.000Z',
            html_url: 'https://github.com/acme/missing-merge-sha/pull/1',
            user: { login: 'human', type: 'User' },
            base: { ref: 'main' },
            merge_commit_sha: null,
          },
        ]);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMergedPrsForWindow(
      { owner: 'acme', repo: 'missing-merge-sha' },
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    );

    expect(result.mergedPrs).toHaveLength(1);
    expect(result.ciVerifiedMergedPrs).toHaveLength(0);
  });

  it('keeps PR unverified when checks are missing and status API is not successful', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/acme/no-checks')) {
        return createJsonResponse({ default_branch: 'main' });
      }
      if (url.includes('/repos/acme/no-checks/pulls?')) {
        return createJsonResponse([
          {
            id: 2,
            merged_at: '2026-01-15T00:00:00.000Z',
            html_url: 'https://github.com/acme/no-checks/pull/2',
            user: { login: 'human', type: 'User' },
            base: { ref: 'main' },
            merge_commit_sha: 'sha-no-checks',
          },
        ]);
      }
      if (url.includes('/repos/acme/no-checks/commits/sha-no-checks/check-runs')) {
        return createJsonResponse({ total_count: 0, check_runs: [] });
      }
      if (url.includes('/repos/acme/no-checks/commits/sha-no-checks/status')) {
        return createJsonResponse({ state: 'pending' });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMergedPrsForWindow(
      { owner: 'acme', repo: 'no-checks' },
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    );

    expect(result.mergedPrs).toHaveLength(1);
    expect(result.ciVerifiedMergedPrs).toHaveLength(0);
  });

  it('rejects PRs when at least one check run fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/acme/failed-check')) {
        return createJsonResponse({ default_branch: 'main' });
      }
      if (url.includes('/repos/acme/failed-check/pulls?')) {
        return createJsonResponse([
          {
            id: 3,
            merged_at: '2026-01-15T00:00:00.000Z',
            html_url: 'https://github.com/acme/failed-check/pull/3',
            user: { login: 'human', type: 'User' },
            base: { ref: 'main' },
            merge_commit_sha: 'sha-failed-check',
          },
        ]);
      }
      if (url.includes('/repos/acme/failed-check/commits/sha-failed-check/check-runs')) {
        return createJsonResponse({
          total_count: 2,
          check_runs: [
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'failure' },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMergedPrsForWindow(
      { owner: 'acme', repo: 'failed-check' },
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    );

    expect(result.mergedPrs).toHaveLength(1);
    expect(result.ciVerifiedMergedPrs).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([value]) => String(value).includes('/status'))).toBe(false);
  });

  it('falls back to commit status API when check-runs endpoint is unavailable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/acme/status-fallback')) {
        return createJsonResponse({ default_branch: 'main' });
      }
      if (url.includes('/repos/acme/status-fallback/pulls?')) {
        return createJsonResponse([
          {
            id: 4,
            merged_at: '2026-01-15T00:00:00.000Z',
            html_url: 'https://github.com/acme/status-fallback/pull/4',
            user: { login: 'human', type: 'User' },
            base: { ref: 'main' },
            merge_commit_sha: 'sha-status-fallback',
          },
        ]);
      }
      if (url.includes('/repos/acme/status-fallback/commits/sha-status-fallback/check-runs')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }
      if (url.includes('/repos/acme/status-fallback/commits/sha-status-fallback/status')) {
        return createJsonResponse({ state: 'success' });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMergedPrsForWindow(
      { owner: 'acme', repo: 'status-fallback' },
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    );

    expect(result.mergedPrs).toHaveLength(1);
    expect(result.ciVerifiedMergedPrs).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([value]) => String(value).includes('/status'))).toBe(true);
  });

  it('excludes PR when status fallback reports non-success', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/acme/status-fallback-fail')) {
        return createJsonResponse({ default_branch: 'main' });
      }
      if (url.includes('/repos/acme/status-fallback-fail/pulls?')) {
        return createJsonResponse([
          {
            id: 5,
            merged_at: '2026-01-15T00:00:00.000Z',
            html_url: 'https://github.com/acme/status-fallback-fail/pull/5',
            user: { login: 'human', type: 'User' },
            base: { ref: 'main' },
            merge_commit_sha: 'sha-status-fallback-fail',
          },
        ]);
      }
      if (url.includes('/repos/acme/status-fallback-fail/commits/sha-status-fallback-fail/check-runs')) {
        return createJsonResponse({ message: 'Not Found' }, 404);
      }
      if (url.includes('/repos/acme/status-fallback-fail/commits/sha-status-fallback-fail/status')) {
        return createJsonResponse({ state: 'failure' });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMergedPrsForWindow(
      { owner: 'acme', repo: 'status-fallback-fail' },
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    );

    expect(result.mergedPrs).toHaveLength(1);
    expect(result.ciVerifiedMergedPrs).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([value]) => String(value).includes('/status'))).toBe(true);
  });

  it('filters merged PRs to resolved default branch and falls back to main/master when default branch lookup fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/acme/default-branch-filter')) {
        return createJsonResponse({ default_branch: 'develop' });
      }
      if (url.includes('/repos/acme/default-branch-filter/pulls?')) {
        return createJsonResponse([
          {
            id: 6,
            merged_at: '2026-01-15T00:00:00.000Z',
            html_url: 'https://github.com/acme/default-branch-filter/pull/6',
            user: { login: 'human', type: 'User' },
            base: { ref: 'develop' },
            merge_commit_sha: 'sha-develop',
          },
          {
            id: 7,
            merged_at: '2026-01-15T00:00:00.000Z',
            html_url: 'https://github.com/acme/default-branch-filter/pull/7',
            user: { login: 'human', type: 'User' },
            base: { ref: 'main' },
            merge_commit_sha: 'sha-main',
          },
        ]);
      }
      if (url.includes('/repos/acme/default-branch-filter/commits/sha-develop/check-runs')) {
        return createJsonResponse({ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] });
      }
      if (url.includes('/repos/acme/default-branch-filter/commits/sha-main/check-runs')) {
        return createJsonResponse({ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] });
      }
      if (url.endsWith('/repos/acme/default-branch-fallback')) {
        return createJsonResponse({ message: 'not found' }, 404);
      }
      if (url.includes('/repos/acme/default-branch-fallback/pulls?')) {
        return createJsonResponse([
          {
            id: 8,
            merged_at: '2026-01-15T00:00:00.000Z',
            html_url: 'https://github.com/acme/default-branch-fallback/pull/8',
            user: { login: 'human', type: 'User' },
            base: { ref: 'main' },
            merge_commit_sha: 'sha-fallback-main',
          },
          {
            id: 9,
            merged_at: '2026-01-15T00:00:00.000Z',
            html_url: 'https://github.com/acme/default-branch-fallback/pull/9',
            user: { login: 'human', type: 'User' },
            base: { ref: 'master' },
            merge_commit_sha: 'sha-fallback-master',
          },
          {
            id: 10,
            merged_at: '2026-01-15T00:00:00.000Z',
            html_url: 'https://github.com/acme/default-branch-fallback/pull/10',
            user: { login: 'human', type: 'User' },
            base: { ref: 'develop' },
            merge_commit_sha: 'sha-fallback-develop',
          },
        ]);
      }
      if (url.includes('/repos/acme/default-branch-fallback/commits/sha-fallback-main/check-runs')) {
        return createJsonResponse({ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] });
      }
      if (url.includes('/repos/acme/default-branch-fallback/commits/sha-fallback-master/check-runs')) {
        return createJsonResponse({ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const filtered = await fetchMergedPrsForWindow(
      { owner: 'acme', repo: 'default-branch-filter' },
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    );
    expect(filtered.usedDefaultBranchFallback).toBe(false);
    expect(filtered.mergedPrs.map((pr) => pr.id)).toEqual([6]);
    expect(filtered.ciVerifiedMergedPrs.map((pr) => pr.id)).toEqual([6]);

    const fallback = await fetchMergedPrsForWindow(
      { owner: 'acme', repo: 'default-branch-fallback' },
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    );
    expect(fallback.usedDefaultBranchFallback).toBe(true);
    expect(fallback.mergedPrs.map((pr) => pr.id)).toEqual([8, 9]);
    expect(fallback.ciVerifiedMergedPrs.map((pr) => pr.id)).toEqual([8, 9]);
  });

  it('limits CI verification to first 20 merged PRs', async () => {
    const mergedPrs = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      merged_at: '2026-01-15T00:00:00.000Z',
      html_url: `https://github.com/acme/ci-cap/pull/${i + 1}`,
      user: { login: 'human', type: 'User' },
      base: { ref: 'main' },
      merge_commit_sha: `sha-${i + 1}`,
    }));

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/acme/ci-cap')) {
        return createJsonResponse({ default_branch: 'main' });
      }
      if (url.includes('/repos/acme/ci-cap/pulls?')) {
        return createJsonResponse(mergedPrs);
      }
      if (url.includes('/repos/acme/ci-cap/commits/') && url.includes('/check-runs')) {
        return createJsonResponse({
          total_count: 1,
          check_runs: [{ status: 'completed', conclusion: 'success' }],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchMergedPrsForWindow(
      { owner: 'acme', repo: 'ci-cap' },
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
    );

    const checkRunCalls = fetchMock.mock.calls.filter(([value]) => String(value).includes('/check-runs'));
    expect(result.mergedPrs).toHaveLength(25);
    expect(result.ciVerifiedMergedPrs).toHaveLength(20);
    expect(checkRunCalls).toHaveLength(20);
  });

  it('supports strict author-login filtering for commits and PRs', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/repos/acme/strict-attribution')) {
        return createJsonResponse({ default_branch: 'main' });
      }
      if (url.includes('/repos/acme/strict-attribution/commits?')) {
        return createJsonResponse([
          {
            sha: 'sha-alice',
            parents: [{ sha: 'parent-a' }],
            author: { login: 'alice', type: 'User' },
            commit: {
              author: { name: 'alice', date: '2026-01-15T00:00:00.000Z' },
              committer: { name: 'alice', date: '2026-01-15T00:00:00.000Z' },
            },
          },
          {
            sha: 'sha-bob',
            parents: [{ sha: 'parent-b' }],
            author: { login: 'bob', type: 'User' },
            commit: {
              author: { name: 'bob', date: '2026-01-15T00:00:00.000Z' },
              committer: { name: 'bob', date: '2026-01-15T00:00:00.000Z' },
            },
          },
        ]);
      }
      if (url.includes('/repos/acme/strict-attribution/pulls?')) {
        return createJsonResponse([
          {
            id: 21,
            merged_at: '2026-01-15T00:00:00.000Z',
            html_url: 'https://github.com/acme/strict-attribution/pull/21',
            user: { login: 'alice', type: 'User' },
            base: { ref: 'main' },
            merge_commit_sha: 'sha-pr-alice',
          },
          {
            id: 22,
            merged_at: '2026-01-15T00:00:00.000Z',
            html_url: 'https://github.com/acme/strict-attribution/pull/22',
            user: { login: 'bob', type: 'User' },
            base: { ref: 'main' },
            merge_commit_sha: 'sha-pr-bob',
          },
        ]);
      }
      if (url.includes('/repos/acme/strict-attribution/commits/sha-pr-alice/check-runs')) {
        return createJsonResponse({ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'success' }] });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const commits = await fetchCommitsForWindow(
      { owner: 'acme', repo: 'strict-attribution' },
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      undefined,
      { authoredByHandle: 'alice' },
    );
    const prs = await fetchMergedPrsForWindow(
      { owner: 'acme', repo: 'strict-attribution' },
      '2026-01-01T00:00:00.000Z',
      '2026-02-01T00:00:00.000Z',
      undefined,
      { authoredByHandle: 'alice' },
    );

    expect(commits.map((commit) => commit.sha)).toEqual(['sha-alice']);
    expect(prs.mergedPrs.map((pr) => pr.id)).toEqual([21]);
    expect(prs.ciVerifiedMergedPrs.map((pr) => pr.id)).toEqual([21]);
  });
});

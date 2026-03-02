import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { scanRepoByUrl } from './scanService';
import type { GitHubCommit, GitHubPullRequest } from './types';

vi.mock('./github', () => ({
  fetchCommitsForWindow: vi.fn(),
  fetchMergedPrsForWindow: vi.fn(),
}));

import { fetchCommitsForWindow, fetchMergedPrsForWindow } from './github';

const fetchCommitsForWindowMock = vi.mocked(fetchCommitsForWindow);
const fetchMergedPrsForWindowMock = vi.mocked(fetchMergedPrsForWindow);

function commitFixture(sha: string, isoDate: string): GitHubCommit {
  return {
    sha,
    parents: [{ sha: `${sha}-parent` }],
    author: { login: 'alice', type: 'User' },
    commit: {
      author: { name: 'Alice', date: isoDate },
      committer: { name: 'Alice', date: isoDate },
    },
  };
}

function prFixture(id: number, isoDate: string): GitHubPullRequest {
  return {
    id,
    merged_at: isoDate,
    html_url: `https://github.com/acme/repo/pull/${id}`,
    user: { login: 'alice', type: 'User' },
    base: { ref: 'main' },
    merge_commit_sha: `sha-${id}`,
  };
}

function mergedResultFixture(input: {
  mergedPrs?: GitHubPullRequest[];
  ciVerifiedMergedPrs?: GitHubPullRequest[];
  usedDefaultBranchFallback?: boolean;
  capped?: boolean;
  confidence?: 'high' | 'medium' | 'low';
}) {
  const mergedPrs = input.mergedPrs ?? [];
  const ciVerifiedMergedPrs = input.ciVerifiedMergedPrs ?? [];
  const evaluatedPrs = ciVerifiedMergedPrs.length;
  return {
    mergedPrs,
    ciVerifiedMergedPrs,
    usedDefaultBranchFallback: input.usedDefaultBranchFallback ?? false,
    ingestion: {
      pagesFetched: 1,
      maxPages: 10,
      truncated: false,
    },
    ciVerification: {
      evaluatedPrs,
      totalMergedPrs: mergedPrs.length,
      coverageRatio: mergedPrs.length === 0 ? 1 : evaluatedPrs / mergedPrs.length,
      cap: 20,
      capped: input.capped ?? false,
      confidence: input.confidence ?? 'high',
    },
  };
}

describe('scanService attribution/window edges', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchCommitsForWindowMock.mockReset();
    fetchMergedPrsForWindowMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses strict handle-authored attribution and computes exact 30d window boundaries', async () => {
    const frozenNow = new Date('2026-03-15T12:34:56.789Z');
    vi.setSystemTime(frozenNow);

    fetchCommitsForWindowMock.mockResolvedValue([]);
    fetchMergedPrsForWindowMock.mockResolvedValue(mergedResultFixture({}));

    await scanRepoByUrl('https://github.com/acme/repo', undefined, {
      attribution: {
        mode: 'handle-authored',
        handle: ' Alice ',
      },
    });

    const expectedNowIso = '2026-03-15T12:34:00.000Z';
    const expectedCurrentStartIso = '2026-02-13T12:34:00.000Z';
    const expectedPreviousStartIso = '2026-01-14T12:34:00.000Z';

    expect(fetchCommitsForWindowMock).toHaveBeenNthCalledWith(
      1,
      { owner: 'acme', repo: 'repo' },
      expectedCurrentStartIso,
      expectedNowIso,
      undefined,
      { authoredByHandle: 'alice' },
    );
    expect(fetchCommitsForWindowMock).toHaveBeenNthCalledWith(
      2,
      { owner: 'acme', repo: 'repo' },
      expectedPreviousStartIso,
      expectedCurrentStartIso,
      undefined,
      { authoredByHandle: 'alice' },
    );
    expect(fetchMergedPrsForWindowMock).toHaveBeenNthCalledWith(
      1,
      { owner: 'acme', repo: 'repo' },
      expectedCurrentStartIso,
      expectedNowIso,
      undefined,
      { authoredByHandle: 'alice' },
    );
    expect(fetchMergedPrsForWindowMock).toHaveBeenNthCalledWith(
      2,
      { owner: 'acme', repo: 'repo' },
      expectedPreviousStartIso,
      expectedCurrentStartIso,
      undefined,
      { authoredByHandle: 'alice' },
    );
  });

  it('falls back to repo-wide attribution when handle-authored mode has an invalid handle', async () => {
    vi.setSystemTime(new Date('2026-03-15T12:34:56.789Z'));

    fetchCommitsForWindowMock.mockResolvedValue([]);
    fetchMergedPrsForWindowMock.mockResolvedValue(mergedResultFixture({}));

    const report = await scanRepoByUrl('https://github.com/acme/repo', undefined, {
      attribution: {
        mode: 'handle-authored',
        handle: '   ',
      },
    });

    expect(report.attribution.mode).toBe('repo-wide');
    expect(report.attribution.fallbackReason).toContain('defaulted to repo-wide mode');
    expect(fetchCommitsForWindowMock).toHaveBeenNthCalledWith(
      1,
      { owner: 'acme', repo: 'repo' },
      expect.any(String),
      expect.any(String),
      undefined,
      undefined,
    );
    expect(fetchMergedPrsForWindowMock).toHaveBeenNthCalledWith(
      1,
      { owner: 'acme', repo: 'repo' },
      expect.any(String),
      expect.any(String),
      undefined,
      undefined,
    );
  });

  it('handles heavy activity and surfaces default-branch fallback assumptions', async () => {
    vi.setSystemTime(new Date('2026-03-15T12:34:56.789Z'));

    const currentCommits = Array.from({ length: 180 }, (_, index) =>
      commitFixture(`current-${index}`, `2026-03-${String((index % 14) + 1).padStart(2, '0')}T${String(index % 24).padStart(2, '0')}:00:00.000Z`),
    );
    const previousCommits = Array.from({ length: 120 }, (_, index) =>
      commitFixture(`previous-${index}`, `2026-02-${String((index % 14) + 1).padStart(2, '0')}T${String((index + 3) % 24).padStart(2, '0')}:00:00.000Z`),
    );
    const currentMergedPrs = Array.from({ length: 70 }, (_, index) =>
      prFixture(index + 1, `2026-03-${String((index % 14) + 1).padStart(2, '0')}T12:00:00.000Z`),
    );
    const previousMergedPrs = Array.from({ length: 35 }, (_, index) =>
      prFixture(index + 1000, `2026-02-${String((index % 14) + 1).padStart(2, '0')}T12:00:00.000Z`),
    );

    fetchCommitsForWindowMock.mockResolvedValueOnce(currentCommits).mockResolvedValueOnce(previousCommits);
    fetchMergedPrsForWindowMock
      .mockResolvedValueOnce(
        mergedResultFixture({
        mergedPrs: currentMergedPrs,
        ciVerifiedMergedPrs: currentMergedPrs.slice(0, 55),
        usedDefaultBranchFallback: true,
        capped: true,
        confidence: 'medium',
      }),
      )
      .mockResolvedValueOnce(
        mergedResultFixture({
        mergedPrs: previousMergedPrs,
        ciVerifiedMergedPrs: previousMergedPrs.slice(0, 20),
        usedDefaultBranchFallback: false,
        confidence: 'high',
      }),
      );

    const report = await scanRepoByUrl('https://github.com/acme/repo');

    expect(report.metrics.commitsPerDay).toBeGreaterThan(0);
    expect(report.metrics.mergedPrs).toBe(55);
    expect(report.metrics.mergedPrsUnverified).toBe(70);
    expect(report.metrics.equivalentEngineeringHours).toBeGreaterThan(0);
    expect(report.windows).toHaveLength(2);
    expect(report.windows[0]?.throughputHeatmap).toHaveLength(7);
    expect(report.windows[0]?.throughputHeatmap?.[0]).toHaveLength(24);
    expect(report.assumptions.defaultBranchScope).toContain('main/master');
  });
});

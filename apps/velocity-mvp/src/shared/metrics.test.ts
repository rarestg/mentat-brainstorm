import { describe, expect, it } from 'vitest';
import { buildMetrics, computeWindowSummary } from './metrics';

type SummaryInput = Parameters<typeof computeWindowSummary>[0];
type CommitLike = SummaryInput['commits'][number];
type PullLike = SummaryInput['mergedPrs'][number];

function commit(sha: string, date: string): CommitLike {
  return {
    sha,
    parents: [{ sha: `${sha}-parent` }],
    author: { login: 'human', type: 'User' },
    commit: {
      author: { name: 'human', date },
      committer: { name: 'human', date },
    },
  };
}

function pr(id: number, mergedAt: string): PullLike {
  return {
    id,
    merged_at: mergedAt,
    html_url: `https://github.com/acme/repo/pull/${id}`,
    user: { login: 'human', type: 'User' },
    base: { ref: 'main' },
    merge_commit_sha: `sha-${id}`,
  };
}

describe('metrics', () => {
  it('computes expected summaries and acceleration', () => {
    const now = new Date('2026-02-01T00:00:00.000Z');
    const start = new Date('2026-01-02T00:00:00.000Z');
    const prevStart = new Date('2025-12-03T00:00:00.000Z');

    const current = computeWindowSummary({
      label: 'current30d',
      now,
      start,
      end: now,
      commits: [
        commit('a', '2026-01-10T08:12:00.000Z'),
        commit('b', '2026-01-10T09:32:00.000Z'),
        commit('c', '2026-01-11T23:10:00.000Z'),
      ],
      mergedPrs: [pr(1, '2026-01-10T12:00:00.000Z')],
    });

    const previous = computeWindowSummary({
      label: 'previous30d',
      now,
      start: prevStart,
      end: start,
      commits: [commit('d', '2025-12-10T09:00:00.000Z')],
      mergedPrs: [],
    });

    expect(current.activeCodingHours).toBe(3);
    expect(current.offHoursRatio).toBeCloseTo(0.67, 2);

    const metrics = buildMetrics(current, previous);
    expect(metrics.commitsPerDay).toBeCloseTo(0.1, 3);
    expect(metrics.mergedPrsUnverified).toBe(1);
    expect(metrics.mergedPrsCiVerified).toBe(1);
    expect(metrics.mergedPrs).toBe(1);
    expect(metrics.velocityAcceleration).toBeGreaterThan(0);
  });

  it('uses CI-verified merged PRs for EEH while exposing unverified count', () => {
    const now = new Date('2026-02-01T00:00:00.000Z');
    const start = new Date('2026-01-02T00:00:00.000Z');

    const summary = computeWindowSummary({
      label: 'current30d',
      now,
      start,
      end: now,
      commits: [commit('a', '2026-01-10T09:00:00.000Z')],
      mergedPrs: [pr(1, '2026-01-10T12:00:00.000Z'), pr(2, '2026-01-11T12:00:00.000Z')],
      ciVerifiedMergedPrs: [pr(1, '2026-01-10T12:00:00.000Z')],
    });

    expect(summary.mergedPrCountUnverified).toBe(2);
    expect(summary.mergedPrCountCiVerified).toBe(1);
    expect(summary.mergedPrCount).toBe(1);
  });
});

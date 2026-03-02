import { describe, expect, it } from 'vitest';
import { getLeaderboardArtifact, getProfileByHandle, persistScanReport } from './db';
import type { RepoReportCard } from '../../shared/types';

interface SqlCall {
  sql: string;
  params: unknown[];
}

function createPreparedStatement(
  sql: string,
  handlers: {
    onRun: (sql: string, params: unknown[]) => Promise<unknown>;
    onFirst: (sql: string, params: unknown[]) => Promise<unknown>;
    onAll: (sql: string, params: unknown[]) => Promise<unknown>;
  },
): D1PreparedStatement {
  let boundParams: unknown[] = [];
  const statement = {} as D1PreparedStatement;

  statement.bind = ((...params: unknown[]) => {
    boundParams = params;
    return statement;
  }) as D1PreparedStatement['bind'];
  statement.run = (() => handlers.onRun(sql, boundParams)) as D1PreparedStatement['run'];
  statement.first = (<T = Record<string, unknown>>() => handlers.onFirst(sql, boundParams) as Promise<T | null>) as D1PreparedStatement['first'];
  statement.all = (<T = Record<string, unknown>>() => handlers.onAll(sql, boundParams) as Promise<D1Result<T>>) as D1PreparedStatement['all'];
  statement.raw = ((options?: { columnNames?: boolean }) => {
    if (options?.columnNames) {
      return Promise.resolve([[]] as [string[], ...unknown[][]]);
    }
    return Promise.resolve([] as unknown[][]);
  }) as D1PreparedStatement['raw'];

  return statement;
}

function makeScanReport(overrides?: Partial<RepoReportCard>): RepoReportCard {
  return {
    repo: {
      owner: 'acme',
      name: 'repo',
      url: 'https://github.com/acme/repo',
    },
    scannedAt: '2026-02-27T00:00:00.000Z',
    attribution: {
      mode: 'repo-wide',
      source: 'github-author-login-match',
      strict: false,
      productionReady: true,
      notes: 'repo-wide fallback',
    },
    assumptions: {
      offHoursDefinitionUtc: 'off-hours',
      equivalentEngineeringHoursFormula: 'eeh formula',
      defaultBranchScope: 'default branch only',
      ciVerification: 'ci verification',
    },
    metrics: {
      commitsPerDay: 1,
      mergedPrsUnverified: 3,
      mergedPrsCiVerified: 2,
      mergedPrs: 2,
      activeCodingHours: 20,
      offHoursRatio: 0.4,
      velocityAcceleration: 0.1,
      equivalentEngineeringHours: 44,
    },
    windows: [],
    ...overrides,
  };
}

function makeHeatmapCounts(seed = 0): number[][] {
  return Array.from({ length: 7 }, (_, day) =>
    Array.from({ length: 24 }, (_, hour) => {
      if (day === 1 && hour === 10) {
        return seed + 9;
      }
      if (day === 4 && hour === 22) {
        return seed + 4;
      }
      return seed;
    }),
  );
}

describe('persistScanReport', () => {
  it('recomputes leaderboard rows for first and repeat scans without rank=0 writes', async () => {
    const runCalls: SqlCall[] = [];
    let snapshotId = 0;
    const aggregateQueue = [
      {
        scanned_repos: 1,
        featured_repo: 'https://github.com/acme/repo',
        attribution_mode: 'repo-wide',
        attribution_source: 'github-author-login-match',
        attribution_target_handle: 'acme',
        attribution_strict: 0,
        total_equivalent_engineering_hours: 120,
        total_merged_prs_unverified: 12,
        total_merged_prs_ci_verified: 11,
        total_merged_prs: 11,
        total_commits_per_day: 3.2,
        total_active_coding_hours: 40,
        total_off_hours_ratio: 0.2,
        total_velocity_acceleration: 0.6,
      },
      {
        scanned_repos: 1,
        featured_repo: 'https://github.com/acme/repo',
        attribution_mode: 'repo-wide',
        attribution_source: 'github-author-login-match',
        attribution_target_handle: 'acme',
        attribution_strict: 0,
        total_equivalent_engineering_hours: 180,
        total_merged_prs_unverified: 17,
        total_merged_prs_ci_verified: 15,
        total_merged_prs: 15,
        total_commits_per_day: 4.1,
        total_active_coding_hours: 46,
        total_off_hours_ratio: 0.25,
        total_velocity_acceleration: 0.9,
      },
    ];
    const rankQueue = [
      { rank: 2, total_rows: 3 },
      { rank: 1, total_rows: 3 },
    ];

    const db = {
      prepare(sql: string) {
        return createPreparedStatement(sql, {
          async onRun(currentSql, params) {
            runCalls.push({ sql: currentSql, params });
            if (currentSql.includes('INSERT INTO snapshots')) {
              snapshotId += 1;
              return { success: true, meta: { last_row_id: snapshotId } };
            }
            return { success: true, meta: { last_row_id: 0 } };
          },
          async onFirst(currentSql) {
            if (currentSql.includes('SELECT id FROM users WHERE handle = ?')) {
              return { id: 1 };
            }
            if (currentSql.includes('SELECT id FROM repos WHERE url = ?')) {
              return { id: 10 };
            }
            if (currentSql.includes('WITH latest_repo_scans AS')) {
              return aggregateQueue.shift() ?? null;
            }
            if (currentSql.includes('SELECT handle FROM users WHERE id = ?')) {
              return { handle: 'acme' };
            }
            if (currentSql.includes('(SELECT COUNT(*) FROM leaderboard_rows) AS total_rows')) {
              return rankQueue.shift() ?? { rank: 1, total_rows: 1 };
            }
            return null;
          },
          async onAll() {
            return { success: true, results: [] };
          },
        });
      },
      batch() {
        return Promise.resolve([]) as Promise<D1Result<unknown>[]>;
      },
      exec() {
        return Promise.resolve({ count: 0, duration: 0 }) as Promise<D1ExecResult>;
      },
      dump() {
        return Promise.resolve(new ArrayBuffer(0));
      },
    } as unknown as D1Database;

    await persistScanReport(db, makeScanReport());
    await persistScanReport(db, makeScanReport({ scannedAt: '2026-02-28T00:00:00.000Z' }));

    const leaderboardWrites = runCalls.filter((call) => call.sql.includes('INSERT INTO leaderboard_rows'));
    expect(leaderboardWrites).toHaveLength(2);
    expect(leaderboardWrites.every((call) => Number(call.params[1]) > 0)).toBe(true);

    const rankRecomputeWrites = runCalls.filter(
      (call) => call.sql.includes('WITH ranked AS') && call.sql.includes('UPDATE leaderboard_rows'),
    );
    expect(rankRecomputeWrites).toHaveLength(2);

    const historyWrites = runCalls.filter((call) => call.sql.includes('INSERT INTO profile_metrics_history'));
    expect(historyWrites).toHaveLength(2);
    expect(historyWrites[0]?.params[2]).toBe(2);
    expect(historyWrites[0]?.params[5]).toBe(120);
    expect(historyWrites[1]?.params[2]).toBe(1);
    expect(historyWrites[1]?.params[5]).toBe(180);
  });
});

describe('getLeaderboardArtifact', () => {
  it('bounds invalid rank values so percentiles remain valid', async () => {
    const rows = [
      {
        user_id: 1,
        handle: 'alice',
        rank: 0,
        leaderboard_updated_at: '2026-03-01T00:00:00.000Z',
        scanned_repos: 1,
        featured_repo: null,
        ai_ready_score: null,
        scan_insight: null,
        total_equivalent_engineering_hours: 100,
        total_merged_prs_unverified: 10,
        total_merged_prs_ci_verified: 9,
        total_merged_prs: 9,
        total_commits_per_day: 3.2,
        total_active_coding_hours: 40,
        total_off_hours_ratio: 0.2,
        total_velocity_acceleration: 0.6,
        attribution_mode: 'repo-wide',
        attribution_source: 'github-author-login-match',
        attribution_target_handle: null,
        attribution_strict: 0,
        t30_equivalent_engineering_hours: 50,
        t30_merged_prs: 5,
        t30_commits_per_day: 2.1,
        t30_active_coding_hours: 20,
      },
      {
        user_id: 2,
        handle: 'bob',
        rank: 2,
        leaderboard_updated_at: '2026-03-01T00:00:00.000Z',
        scanned_repos: 1,
        featured_repo: null,
        ai_ready_score: null,
        scan_insight: null,
        total_equivalent_engineering_hours: 80,
        total_merged_prs_unverified: 8,
        total_merged_prs_ci_verified: 7,
        total_merged_prs: 7,
        total_commits_per_day: 2.8,
        total_active_coding_hours: 36,
        total_off_hours_ratio: 0.1,
        total_velocity_acceleration: 0.4,
        attribution_mode: 'repo-wide',
        attribution_source: 'github-author-login-match',
        attribution_target_handle: null,
        attribution_strict: 0,
        t30_equivalent_engineering_hours: 40,
        t30_merged_prs: 4,
        t30_commits_per_day: 2.0,
        t30_active_coding_hours: 18,
      },
    ];

    const db = {
      prepare(sql: string) {
        return createPreparedStatement(sql, {
          async onRun() {
            return { success: true, meta: { last_row_id: 0 } };
          },
          async onFirst() {
            return null;
          },
          async onAll(currentSql) {
            if (currentSql.includes('FROM leaderboard_rows lr')) {
              return { success: true, results: rows };
            }
            if (currentSql.includes('FROM crowns c')) {
              return { success: true, results: [] };
            }
            return { success: true, results: [] };
          },
        });
      },
      batch() {
        return Promise.resolve([]) as Promise<D1Result<unknown>[]>;
      },
      exec() {
        return Promise.resolve({ count: 0, duration: 0 }) as Promise<D1ExecResult>;
      },
      dump() {
        return Promise.resolve(new ArrayBuffer(0));
      },
    } as unknown as D1Database;

    const artifact = await getLeaderboardArtifact(db);
    expect(artifact.entries[0]?.rank).toBe(1);
    expect(artifact.entries[0]?.percentile).toBe(100);
    expect(artifact.entries[1]?.percentile).toBeGreaterThanOrEqual(0);
    expect(artifact.entries[1]?.percentile).toBeLessThanOrEqual(100);
    expect(artifact.entries[0]?.provenance?.totals.state).toBe('authoritative');
    expect(artifact.entries[0]?.provenance?.profile.trendPoints.state).toBe('unavailable');
    expect(artifact.entries[0]?.provenance?.profile.throughputHeatmap.state).toBe('unavailable');
    expect(artifact.entries[0]?.provenance?.profile.rotatingInsights.state).toBe('authoritative');
    expect(Array.isArray(artifact.entries[0]?.profile?.rotatingInsights)).toBe(true);
  });

  it('hydrates authoritative profile modules when history and scan heatmap payloads exist', async () => {
    const rows = [
      {
        user_id: 7,
        handle: 'zeus',
        rank: 1,
        leaderboard_updated_at: '2026-03-01T00:00:00.000Z',
        scanned_repos: 2,
        featured_repo: 'https://github.com/zeus/app',
        ai_ready_score: null,
        scan_insight: null,
        total_equivalent_engineering_hours: 210,
        total_merged_prs_unverified: 22,
        total_merged_prs_ci_verified: 18,
        total_merged_prs: 18,
        total_commits_per_day: 5.2,
        total_active_coding_hours: 63,
        total_off_hours_ratio: 0.31,
        total_velocity_acceleration: 0.44,
        attribution_mode: 'handle-authored',
        attribution_source: 'github-author-login-match',
        attribution_target_handle: 'zeus',
        attribution_strict: 1,
        t30_equivalent_engineering_hours: 210,
        t30_merged_prs: 18,
        t30_commits_per_day: 5.2,
        t30_active_coding_hours: 63,
      },
    ];

    const db = {
      prepare(sql: string) {
        return createPreparedStatement(sql, {
          async onRun() {
            return { success: true, meta: { last_row_id: 0 } };
          },
          async onFirst() {
            return null;
          },
          async onAll(currentSql) {
            if (currentSql.includes('FROM leaderboard_rows lr')) {
              return { success: true, results: rows };
            }
            if (currentSql.includes('FROM crowns c')) {
              return { success: true, results: [] };
            }
            if (currentSql.includes('WITH ranked_history AS')) {
              return {
                success: true,
                results: [
                  { user_id: 7, captured_at: '2026-03-01T00:00:00.000Z', equivalent_engineering_hours: 210 },
                  { user_id: 7, captured_at: '2026-02-01T00:00:00.000Z', equivalent_engineering_hours: 190 },
                ],
              };
            }
            if (currentSql.includes('WITH latest_repo_scans AS')) {
              return {
                success: true,
                results: [
                  {
                    user_id: 7,
                    scanned_at: '2026-03-01T00:00:00.000Z',
                    windows_json: JSON.stringify([
                      { label: 'current30d', throughputHeatmap: makeHeatmapCounts(0) },
                      { label: 'previous30d', throughputHeatmap: makeHeatmapCounts(0) },
                    ]),
                  },
                ],
              };
            }
            return { success: true, results: [] };
          },
        });
      },
      batch() {
        return Promise.resolve([]) as Promise<D1Result<unknown>[]>;
      },
      exec() {
        return Promise.resolve({ count: 0, duration: 0 }) as Promise<D1ExecResult>;
      },
      dump() {
        return Promise.resolve(new ArrayBuffer(0));
      },
    } as unknown as D1Database;

    const artifact = await getLeaderboardArtifact(db);
    const entry = artifact.entries[0];
    expect(entry?.profile?.trendPoints).toEqual([190, 210]);
    expect(entry?.profile?.throughputHeatmap?.length).toBe(7);
    expect(entry?.profile?.throughputHeatmap?.[1]?.[10]).toBe(4);
    expect(entry?.provenance?.profile.trendPoints.state).toBe('authoritative');
    expect(entry?.provenance?.profile.throughputHeatmap.state).toBe('authoritative');
    expect(entry?.provenance?.profile.rotatingInsights.state).toBe('authoritative');
    expect(entry?.profile?.rotatingInsights?.length).toBeGreaterThan(0);
  });
});

describe('getProfileByHandle', () => {
  it('marks unavailable trend/heatmap provenance when profile history is insufficient', async () => {
    const db = {
      prepare(sql: string) {
        return createPreparedStatement(sql, {
          async onRun() {
            return { success: true, meta: { last_row_id: 0 } };
          },
          async onFirst(currentSql) {
            if (currentSql.includes('FROM users u') && currentSql.includes('INNER JOIN leaderboard_rows lr')) {
              return {
                user_id: 3,
                handle: 'hera',
                rank: 2,
                leaderboard_updated_at: '2026-03-01T00:00:00.000Z',
                scanned_repos: 1,
                featured_repo: 'https://github.com/hera/app',
                ai_ready_score: null,
                scan_insight: null,
                total_equivalent_engineering_hours: 120,
                total_merged_prs_unverified: 12,
                total_merged_prs_ci_verified: 10,
                total_merged_prs: 10,
                total_commits_per_day: 3.1,
                total_active_coding_hours: 40,
                total_off_hours_ratio: 0.2,
                total_velocity_acceleration: 0.1,
                attribution_mode: 'repo-wide',
                attribution_source: 'github-author-login-match',
                attribution_target_handle: null,
                attribution_strict: 0,
                t30_equivalent_engineering_hours: 80,
                t30_merged_prs: 6,
                t30_commits_per_day: 2.7,
                t30_active_coding_hours: 33,
                total_rows: 5,
              };
            }
            return null;
          },
          async onAll(currentSql) {
            if (currentSql.includes('FROM crowns')) {
              return { success: true, results: [] };
            }
            if (currentSql.includes('FROM profile_metrics_history')) {
              return {
                success: true,
                results: [
                  {
                    captured_at: '2026-03-01T00:00:00.000Z',
                    rank: 2,
                    percentile: 80,
                    stack_tier: 2,
                    equivalent_engineering_hours: 120,
                    merged_prs: 10,
                    commits_per_day: 3.1,
                    active_coding_hours: 40,
                  },
                ],
              };
            }
            if (currentSql.includes('WITH latest_repo_scans AS')) {
              return { success: true, results: [] };
            }
            return { success: true, results: [] };
          },
        });
      },
      batch() {
        return Promise.resolve([]) as Promise<D1Result<unknown>[]>;
      },
      exec() {
        return Promise.resolve({ count: 0, duration: 0 }) as Promise<D1ExecResult>;
      },
      dump() {
        return Promise.resolve(new ArrayBuffer(0));
      },
    } as unknown as D1Database;

    const profile = await getProfileByHandle(db, 'hera');
    expect(profile).not.toBeNull();
    expect(profile?.leaderboard.profile?.trendPoints).toBeUndefined();
    expect(profile?.leaderboard.profile?.throughputHeatmap).toBeUndefined();
    expect(profile?.leaderboard.profile?.rotatingInsights?.length).toBeGreaterThan(0);
    expect(profile?.leaderboard.provenance?.profile.trendPoints.state).toBe('unavailable');
    expect(profile?.leaderboard.provenance?.profile.trendPoints.reason).toBe('insufficient-history-points');
    expect(profile?.leaderboard.provenance?.profile.throughputHeatmap.state).toBe('unavailable');
    expect(profile?.leaderboard.provenance?.profile.throughputHeatmap.reason).toBe('no-scan-history');
    expect(profile?.leaderboard.provenance?.profile.rotatingInsights.state).toBe('authoritative');
  });
});

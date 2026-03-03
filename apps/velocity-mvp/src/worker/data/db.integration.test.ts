import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaderboardArtifact, RepoReportCard, SeedCreator } from '../../shared/types';

vi.mock('../../shared/leaderboard', () => ({
  buildLeaderboard: vi.fn(),
}));

import { buildLeaderboard } from '../../shared/leaderboard';
import { getLeaderboardArtifact, getProfileByHandle, persistLeaderboardArtifact, persistScanReport, refreshLeaderboardFromSeed } from './db';

const buildLeaderboardMock = vi.mocked(buildLeaderboard);

function splitSqlStatements(sql: string): string[] {
  const withoutPragmas = sql.replace(/^PRAGMA\s+[^;]+;\s*$/gim, '');
  const triggerPattern = /CREATE\s+TRIGGER[\s\S]*?END;/gim;
  const triggerStatements = Array.from(withoutPragmas.matchAll(triggerPattern)).map(([statement]) => statement);

  const baseStatements = withoutPragmas
    .replace(triggerPattern, '')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => `${statement};`);

  const normalizedTriggers = triggerStatements
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => (statement.endsWith(';') ? statement : `${statement};`));

  return [...baseStatements, ...normalizedTriggers];
}

async function loadMigrationStatements(): Promise<string[]> {
  const [schemaSql, authSql, rankConstraintSql] = await Promise.all([
    readFile(new URL('../../../migrations/0001_velocity_schema.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../../migrations/0002_auth_identity_refresh.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../../migrations/0003_leaderboard_rank_constraints.sql', import.meta.url), 'utf8'),
  ]);
  return [...splitSqlStatements(schemaSql), ...splitSqlStatements(authSql), ...splitSqlStatements(rankConstraintSql)];
}

async function applyMigrations(db: D1Database): Promise<void> {
  const statements = await loadMigrationStatements();
  for (const statement of statements) {
    await db.exec(statement);
  }
}

async function createLocalD1Database(): Promise<{ mf: Miniflare; db: D1Database }> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } };',
    compatibilityDate: '2025-01-01',
    d1Databases: { DB: `velocity-integration-${randomUUID()}` },
    d1Persist: false,
    port: 0,
  });
  const db = await mf.getD1Database('DB');
  await applyMigrations(db);
  return { mf, db };
}

function reportFixture(overrides?: Partial<RepoReportCard>): RepoReportCard {
  return {
    repo: {
      owner: 'alice',
      name: 'project',
      url: 'https://github.com/alice/project',
    },
    scannedAt: new Date().toISOString(),
    attribution: {
      mode: 'repo-wide',
      source: 'github-author-login-match',
      strict: false,
      productionReady: true,
      notes: 'Repo-wide fallback attribution',
    },
    assumptions: {
      offHoursDefinitionUtc: 'off-hours',
      equivalentEngineeringHoursFormula: 'formula',
      defaultBranchScope: 'default branch only',
      ciVerification: 'ci checks and status',
    },
    metrics: {
      commitsPerDay: 3.5,
      mergedPrsUnverified: 8,
      mergedPrsCiVerified: 7,
      mergedPrs: 7,
      activeCodingHours: 46,
      offHoursRatio: 0.44,
      velocityAcceleration: 0.26,
      equivalentEngineeringHours: 91.2,
    },
    windows: [],
    ...overrides,
  };
}

function artifactFixture(entries: LeaderboardArtifact['entries']): LeaderboardArtifact {
  return {
    generatedAt: '2026-02-28T12:00:00.000Z',
    sourceSeedPath: 'data/seed-creators.json',
    entries,
  };
}

function seededEntryWithRepo(handle: string, equivalentEngineeringHours: number): LeaderboardArtifact['entries'][number] {
  return {
    rank: 1,
    handle,
    scannedRepos: 1,
    attribution: {
      mode: 'handle-authored',
      source: 'github-author-login-match',
      targetHandle: handle,
      strict: true,
      productionReady: true,
      notes: 'strict',
    },
    totals: {
      equivalentEngineeringHours,
      mergedPrsUnverified: 9,
      mergedPrsCiVerified: 8,
      mergedPrs: 8,
      commitsPerDay: 2.4,
      activeCodingHours: 36,
      offHoursRatio: 0.2,
      velocityAcceleration: 0.2,
    },
    repos: [
      reportFixture({
        repo: {
          owner: handle,
          name: 'seed-repo',
          url: `https://github.com/${handle}/seed-repo`,
        },
        attribution: {
          mode: 'handle-authored',
          source: 'github-author-login-match',
          targetHandle: handle,
          strict: true,
          productionReady: true,
          notes: 'strict',
        },
      }),
    ],
  };
}

describe('worker data integration (local D1)', () => {
  let mf: Miniflare | undefined;
  let db: D1Database;

  beforeEach(async () => {
    buildLeaderboardMock.mockReset();
    const fixture = await createLocalD1Database();
    mf = fixture.mf;
    db = fixture.db;
  });

  afterEach(async () => {
    if (mf) {
      await mf.dispose();
    }
  });

  it('persists first scan report into snapshots, scans, and leaderboard tables', async () => {
    await persistScanReport(db, reportFixture());

    const snapshotCount = await db.prepare('SELECT COUNT(*) AS count FROM snapshots').first<{ count: number }>();
    const scanCount = await db.prepare('SELECT COUNT(*) AS count FROM scans').first<{ count: number }>();
    const leaderboardRow = await db
      .prepare(
        `SELECT lr.rank, lr.scanned_repos, lr.total_equivalent_engineering_hours
         FROM leaderboard_rows lr
         INNER JOIN users u ON u.id = lr.user_id
         WHERE u.handle = ?`,
      )
      .bind('alice')
      .first<{ rank: number; scanned_repos: number; total_equivalent_engineering_hours: number }>();

    expect(Number(snapshotCount?.count ?? 0)).toBe(1);
    expect(Number(scanCount?.count ?? 0)).toBe(1);
    expect(leaderboardRow).toMatchObject({
      rank: 1,
      scanned_repos: 1,
      total_equivalent_engineering_hours: 91.2,
    });
  });

  it('updates existing leaderboard rows on repeat persistence for the same handle', async () => {
    await persistLeaderboardArtifact(
      db,
      artifactFixture([
        {
          rank: 2,
          handle: 'alice',
          scannedRepos: 1,
          attribution: {
            mode: 'handle-authored',
            source: 'github-author-login-match',
            targetHandle: 'alice',
            strict: true,
            productionReady: true,
            notes: 'strict',
          },
          totals: {
            equivalentEngineeringHours: 40,
            mergedPrsUnverified: 5,
            mergedPrsCiVerified: 4,
            mergedPrs: 4,
            commitsPerDay: 1.3,
            activeCodingHours: 24,
            offHoursRatio: 0.21,
            velocityAcceleration: 0.11,
          },
          repos: [],
        },
      ]),
    );

    await persistLeaderboardArtifact(
      db,
      artifactFixture([
        {
          rank: 1,
          handle: 'alice',
          scannedRepos: 2,
          attribution: {
            mode: 'handle-authored',
            source: 'github-author-login-match',
            targetHandle: 'alice',
            strict: true,
            productionReady: true,
            notes: 'strict',
          },
          totals: {
            equivalentEngineeringHours: 140,
            mergedPrsUnverified: 15,
            mergedPrsCiVerified: 14,
            mergedPrs: 14,
            commitsPerDay: 3.8,
            activeCodingHours: 70,
            offHoursRatio: 0.39,
            velocityAcceleration: 0.42,
          },
          repos: [],
        },
      ]),
    );

    const leaderboardRow = await db
      .prepare(
        `SELECT rank, scanned_repos, total_equivalent_engineering_hours
         FROM leaderboard_rows lr
         INNER JOIN users u ON u.id = lr.user_id
         WHERE u.handle = ?`,
      )
      .bind('alice')
      .first<{ rank: number; scanned_repos: number; total_equivalent_engineering_hours: number }>();
    const rowCount = await db.prepare('SELECT COUNT(*) AS count FROM leaderboard_rows').first<{ count: number }>();

    expect(Number(rowCount?.count ?? 0)).toBe(1);
    expect(leaderboardRow).toMatchObject({
      rank: 1,
      scanned_repos: 2,
      total_equivalent_engineering_hours: 140,
    });
  });

  it('returns leaderboard rows ordered by rank with bounded percentile values', async () => {
    await persistLeaderboardArtifact(
      db,
      artifactFixture([
        {
          rank: 1,
          handle: 'alice',
          scannedRepos: 3,
          attribution: {
            mode: 'handle-authored',
            source: 'github-author-login-match',
            targetHandle: 'alice',
            strict: true,
            productionReady: true,
            notes: 'strict',
          },
          totals: {
            equivalentEngineeringHours: 200,
            mergedPrsUnverified: 21,
            mergedPrsCiVerified: 20,
            mergedPrs: 20,
            commitsPerDay: 4.9,
            activeCodingHours: 82,
            offHoursRatio: 0.52,
            velocityAcceleration: 0.61,
          },
          repos: [],
        },
        {
          rank: 2,
          handle: 'bob',
          scannedRepos: 2,
          attribution: {
            mode: 'handle-authored',
            source: 'github-author-login-match',
            targetHandle: 'bob',
            strict: true,
            productionReady: true,
            notes: 'strict',
          },
          totals: {
            equivalentEngineeringHours: 120,
            mergedPrsUnverified: 12,
            mergedPrsCiVerified: 11,
            mergedPrs: 11,
            commitsPerDay: 2.9,
            activeCodingHours: 52,
            offHoursRatio: 0.3,
            velocityAcceleration: 0.33,
          },
          repos: [],
        },
        {
          rank: 3,
          handle: 'carol',
          scannedRepos: 1,
          attribution: {
            mode: 'handle-authored',
            source: 'github-author-login-match',
            targetHandle: 'carol',
            strict: true,
            productionReady: true,
            notes: 'strict',
          },
          totals: {
            equivalentEngineeringHours: 60,
            mergedPrsUnverified: 7,
            mergedPrsCiVerified: 6,
            mergedPrs: 6,
            commitsPerDay: 1.7,
            activeCodingHours: 34,
            offHoursRatio: 0.23,
            velocityAcceleration: 0.17,
          },
          repos: [],
        },
      ]),
    );

    const artifact = await getLeaderboardArtifact(db);
    expect(artifact.entries.map((entry) => entry.handle)).toEqual(['alice', 'bob', 'carol']);
    expect(artifact.entries.map((entry) => entry.rank)).toEqual([1, 2, 3]);
    expect(artifact.entries.every((entry) => (entry.percentile ?? 0) >= 0 && (entry.percentile ?? 0) <= 100)).toBe(true);
  });

  it('W2-018 guard: local integration harness enforces rank > 0 trigger from migration 0003', async () => {
    await db.prepare('INSERT INTO users (handle) VALUES (?)').bind('rank-trigger-user').run();
    const user = await db.prepare('SELECT id FROM users WHERE handle = ?').bind('rank-trigger-user').first<{ id: number }>();

    await expect(
      db
        .prepare(
          `INSERT INTO leaderboard_rows (
             user_id,
             rank,
             scanned_repos,
             featured_repo,
             ai_ready_score,
             scan_insight,
             total_equivalent_engineering_hours,
             total_merged_prs_unverified,
             total_merged_prs_ci_verified,
             total_merged_prs,
             total_commits_per_day,
             total_active_coding_hours,
             total_off_hours_ratio,
             total_velocity_acceleration
           ) VALUES (?, 0, 1, NULL, NULL, NULL, 10, 1, 1, 1, 1, 1, 0.1, 0.1)`,
        )
        .bind(user?.id ?? -1)
        .run(),
    ).rejects.toThrow('leaderboard_rows.rank must be > 0');
  });

  it('records refresh-run metadata and links profile history rows to refresh_run_id', async () => {
    buildLeaderboardMock.mockResolvedValue(
      artifactFixture([
        {
          rank: 1,
          handle: 'alice',
          scannedRepos: 1,
          attribution: {
            mode: 'handle-authored',
            source: 'github-author-login-match',
            targetHandle: 'alice',
            strict: true,
            productionReady: true,
            notes: 'strict',
          },
          totals: {
            equivalentEngineeringHours: 80,
            mergedPrsUnverified: 10,
            mergedPrsCiVerified: 9,
            mergedPrs: 9,
            commitsPerDay: 2.3,
            activeCodingHours: 38,
            offHoursRatio: 0.25,
            velocityAcceleration: 0.24,
          },
          repos: [],
        },
        {
          rank: 2,
          handle: 'bob',
          scannedRepos: 1,
          attribution: {
            mode: 'handle-authored',
            source: 'github-author-login-match',
            targetHandle: 'bob',
            strict: true,
            productionReady: true,
            notes: 'strict',
          },
          totals: {
            equivalentEngineeringHours: 70,
            mergedPrsUnverified: 9,
            mergedPrsCiVerified: 8,
            mergedPrs: 8,
            commitsPerDay: 1.9,
            activeCodingHours: 35,
            offHoursRatio: 0.2,
            velocityAcceleration: 0.19,
          },
          repos: [],
        },
      ]),
    );

    const result = await refreshLeaderboardFromSeed(db, [{ handle: 'alice' }, { handle: 'bob' }] as SeedCreator[], undefined, 'manual');

    const refreshRun = await db
      .prepare('SELECT id, status, entries_processed, trigger_type FROM refresh_runs WHERE id = ?')
      .bind(result.runId)
      .first<{ id: number; status: string; entries_processed: number; trigger_type: string }>();
    const linkedHistoryCount = await db
      .prepare('SELECT COUNT(*) AS count FROM profile_metrics_history WHERE refresh_run_id = ?')
      .bind(result.runId)
      .first<{ count: number }>();

    expect(refreshRun).toMatchObject({
      id: result.runId,
      status: 'success',
      entries_processed: 2,
      trigger_type: 'manual',
    });
    expect(Number(linkedHistoryCount?.count ?? 0)).toBe(2);
    expect(result.entriesProcessed).toBe(2);
    expect(result.trigger).toBe('manual');
  });

  it('VEL-001 guard: percentile must stay <= 100 even when manual scan rows are present', async () => {
    await persistLeaderboardArtifact(
      db,
      artifactFixture([
        {
          rank: 1,
          handle: 'seeded',
          scannedRepos: 1,
          attribution: {
            mode: 'handle-authored',
            source: 'github-author-login-match',
            targetHandle: 'seeded',
            strict: true,
            productionReady: true,
            notes: 'strict',
          },
          totals: {
            equivalentEngineeringHours: 50,
            mergedPrsUnverified: 4,
            mergedPrsCiVerified: 4,
            mergedPrs: 4,
            commitsPerDay: 1.1,
            activeCodingHours: 15,
            offHoursRatio: 0.1,
            velocityAcceleration: 0.05,
          },
          repos: [],
        },
      ]),
    );

    await persistScanReport(
      db,
      reportFixture({
        repo: {
          owner: 'manual-user',
          name: 'repo',
          url: 'https://github.com/manual-user/repo',
        },
      }),
    );

    const artifact = await getLeaderboardArtifact(db);
    expect(Math.max(...artifact.entries.map((entry) => entry.percentile ?? 0))).toBeLessThanOrEqual(100);
  });

  it('VEL-002 guard: repeat manual scan should refresh leaderboard totals for the same handle', async () => {
    await persistScanReport(db, reportFixture());
    await persistScanReport(
      db,
      reportFixture({
        metrics: {
          commitsPerDay: 10,
          mergedPrsUnverified: 15,
          mergedPrsCiVerified: 14,
          mergedPrs: 14,
          activeCodingHours: 90,
          offHoursRatio: 0.5,
          velocityAcceleration: 0.8,
          equivalentEngineeringHours: 210,
        },
      }),
    );

    const leaderboardRow = await db
      .prepare(
        `SELECT lr.total_equivalent_engineering_hours
         FROM leaderboard_rows lr
         INNER JOIN users u ON u.id = lr.user_id
         WHERE u.handle = ?`,
      )
      .bind('alice')
      .first<{ total_equivalent_engineering_hours: number }>();

    expect(leaderboardRow?.total_equivalent_engineering_hours).toBe(210);
  });

  it('W2-001 guard: seed pruning keeps manual canonical entrants while removing stale seed-only rows', async () => {
    await persistScanReport(
      db,
      reportFixture({
        repo: {
          owner: 'manual-user',
          name: 'repo',
          url: 'https://github.com/manual-user/repo',
        },
      }),
    );

    await persistLeaderboardArtifact(
      db,
      artifactFixture([
        seededEntryWithRepo('seed-a', 90),
        seededEntryWithRepo('seed-b', 80),
      ]),
      {
        ownershipSource: 'seed-refresh:manual',
        pruneRowsOutsideArtifact: true,
      },
    );

    await persistLeaderboardArtifact(
      db,
      artifactFixture([seededEntryWithRepo('seed-a', 95)]),
      {
        ownershipSource: 'seed-refresh:manual',
        pruneRowsOutsideArtifact: true,
      },
    );

    const persistedRows = await db
      .prepare(
        `SELECT u.handle
         FROM leaderboard_rows lr
         INNER JOIN users u ON u.id = lr.user_id
         ORDER BY lower(u.handle) ASC`,
      )
      .all<{ handle: string }>();
    expect((persistedRows.results ?? []).map((row) => row.handle)).toEqual(['manual-user', 'seed-a']);
  });

  it('W2-019 guard: manual canonical entrants survive refresh even when not present in seed artifact', async () => {
    await persistScanReport(
      db,
      reportFixture({
        repo: {
          owner: 'manual-user',
          name: 'repo',
          url: 'https://github.com/manual-user/repo',
        },
        metrics: {
          commitsPerDay: 6.1,
          mergedPrsUnverified: 16,
          mergedPrsCiVerified: 14,
          mergedPrs: 14,
          activeCodingHours: 67,
          offHoursRatio: 0.36,
          velocityAcceleration: 0.57,
          equivalentEngineeringHours: 166,
        },
      }),
    );

    buildLeaderboardMock.mockResolvedValue(
      artifactFixture([
        {
          rank: 1,
          handle: 'seeded',
          scannedRepos: 1,
          attribution: {
            mode: 'handle-authored',
            source: 'github-author-login-match',
            targetHandle: 'seeded',
            strict: true,
            productionReady: true,
            notes: 'strict',
          },
          totals: {
            equivalentEngineeringHours: 99,
            mergedPrsUnverified: 11,
            mergedPrsCiVerified: 10,
            mergedPrs: 10,
            commitsPerDay: 2.9,
            activeCodingHours: 41,
            offHoursRatio: 0.2,
            velocityAcceleration: 0.31,
          },
          repos: [],
        },
      ]),
    );

    await refreshLeaderboardFromSeed(db, [{ handle: 'seeded' }] as SeedCreator[], undefined, 'manual');

    const persistedRows = await db
      .prepare(
        `SELECT u.handle, lr.total_equivalent_engineering_hours AS equivalent_engineering_hours
         FROM leaderboard_rows lr
         INNER JOIN users u ON u.id = lr.user_id
         ORDER BY lower(u.handle) ASC`,
      )
      .all<{ handle: string; equivalent_engineering_hours: number }>();
    const handles = (persistedRows.results ?? []).map((row) => row.handle);
    const manualRow = (persistedRows.results ?? []).find((row) => row.handle === 'manual-user');

    expect(handles).toContain('seeded');
    expect(handles).toContain('manual-user');
    expect(manualRow?.equivalent_engineering_hours).toBe(166);
  });

  it('W2-019 guard: failed seed refresh must not delete existing manual canonical rows', async () => {
    await persistScanReport(
      db,
      reportFixture({
        repo: {
          owner: 'manual-user',
          name: 'repo',
          url: 'https://github.com/manual-user/repo',
        },
        metrics: {
          commitsPerDay: 4.1,
          mergedPrsUnverified: 9,
          mergedPrsCiVerified: 8,
          mergedPrs: 8,
          activeCodingHours: 39,
          offHoursRatio: 0.22,
          velocityAcceleration: 0.2,
          equivalentEngineeringHours: 88,
        },
      }),
    );

    buildLeaderboardMock.mockRejectedValueOnce(new Error('seed refresh exploded'));

    await expect(refreshLeaderboardFromSeed(db, [{ handle: 'seeded' }] as SeedCreator[], undefined, 'manual')).rejects.toThrow(
      'seed refresh exploded',
    );

    const manualRow = await db
      .prepare(
        `SELECT lr.total_equivalent_engineering_hours
         FROM leaderboard_rows lr
         INNER JOIN users u ON u.id = lr.user_id
         WHERE u.handle = ?`,
      )
      .bind('manual-user')
      .first<{ total_equivalent_engineering_hours: number }>();
    const refreshRun = await db
      .prepare('SELECT status, error_message FROM refresh_runs ORDER BY id DESC LIMIT 1')
      .first<{ status: string; error_message: string | null }>();

    expect(manualRow?.total_equivalent_engineering_hours).toBe(88);
    expect(refreshRun?.status).toBe('failed');
    expect(refreshRun?.error_message).toContain('seed refresh exploded');
  });

  it('W2-009 guard: refresh persistence rollback prevents partial canonical leaderboard state', async () => {
    await persistLeaderboardArtifact(
      db,
      artifactFixture([
        {
          rank: 1,
          handle: 'seeded',
          scannedRepos: 1,
          attribution: {
            mode: 'handle-authored',
            source: 'github-author-login-match',
            targetHandle: 'seeded',
            strict: true,
            productionReady: true,
            notes: 'strict',
          },
          totals: {
            equivalentEngineeringHours: 77,
            mergedPrsUnverified: 8,
            mergedPrsCiVerified: 7,
            mergedPrs: 7,
            commitsPerDay: 2.1,
            activeCodingHours: 31,
            offHoursRatio: 0.19,
            velocityAcceleration: 0.17,
          },
          repos: [],
        },
      ]),
    );

    buildLeaderboardMock.mockResolvedValue(
      artifactFixture([
        {
          rank: 1,
          handle: 'alice',
          scannedRepos: 1,
          attribution: {
            mode: 'handle-authored',
            source: 'github-author-login-match',
            targetHandle: 'alice',
            strict: true,
            productionReady: true,
            notes: 'strict',
          },
          totals: {
            equivalentEngineeringHours: 88,
            mergedPrsUnverified: 9,
            mergedPrsCiVerified: 8,
            mergedPrs: 8,
            commitsPerDay: 2.4,
            activeCodingHours: 34,
            offHoursRatio: 0.2,
            velocityAcceleration: 0.21,
          },
          repos: [],
        },
        {
          rank: 2,
          handle: undefined as unknown as string,
          scannedRepos: 1,
          attribution: {
            mode: 'handle-authored',
            source: 'github-author-login-match',
            targetHandle: 'broken',
            strict: true,
            productionReady: true,
            notes: 'strict',
          },
          totals: {
            equivalentEngineeringHours: 12,
            mergedPrsUnverified: 2,
            mergedPrsCiVerified: 1,
            mergedPrs: 1,
            commitsPerDay: 0.5,
            activeCodingHours: 8,
            offHoursRatio: 0.1,
            velocityAcceleration: 0.03,
          },
          repos: [],
        },
      ]),
    );

    await expect(refreshLeaderboardFromSeed(db, [{ handle: 'seeded' }] as SeedCreator[], undefined, 'manual')).rejects.toThrow();

    const leaderboardRows = await db
      .prepare(
        `SELECT u.handle
         FROM leaderboard_rows lr
         INNER JOIN users u ON u.id = lr.user_id
         ORDER BY lower(u.handle) ASC`,
      )
      .all<{ handle: string }>();
    const historyCount = await db.prepare('SELECT COUNT(*) AS count FROM profile_metrics_history').first<{ count: number }>();
    const refreshRun = await db
      .prepare('SELECT status, entries_processed FROM refresh_runs ORDER BY id DESC LIMIT 1')
      .first<{ status: string; entries_processed: number | null }>();

    expect((leaderboardRows.results ?? []).map((row) => row.handle)).toEqual(['seeded']);
    expect(Number(historyCount?.count ?? 0)).toBe(1);
    expect(refreshRun?.status).toBe('failed');
    expect(refreshRun?.entries_processed).toBeNull();
  });

  it('W2-012 guard: thirtyDay metrics use latest-per-repo semantics across repeat scans', async () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const daysAgoIso = (daysAgo: number) => new Date(now - daysAgo * dayMs).toISOString();

    await persistScanReport(
      db,
      reportFixture({
        repo: {
          owner: 'alice',
          name: 'repo-a',
          url: 'https://github.com/alice/repo-a',
        },
        scannedAt: daysAgoIso(8),
        metrics: {
          commitsPerDay: 1.5,
          mergedPrsUnverified: 2,
          mergedPrsCiVerified: 2,
          mergedPrs: 2,
          activeCodingHours: 12,
          offHoursRatio: 0.2,
          velocityAcceleration: 0.1,
          equivalentEngineeringHours: 20,
        },
      }),
    );
    await persistScanReport(
      db,
      reportFixture({
        repo: {
          owner: 'alice',
          name: 'repo-a',
          url: 'https://github.com/alice/repo-a',
        },
        scannedAt: daysAgoIso(2),
        metrics: {
          commitsPerDay: 3,
          mergedPrsUnverified: 5,
          mergedPrsCiVerified: 4,
          mergedPrs: 4,
          activeCodingHours: 20,
          offHoursRatio: 0.25,
          velocityAcceleration: 0.3,
          equivalentEngineeringHours: 40,
        },
      }),
    );
    await persistScanReport(
      db,
      reportFixture({
        repo: {
          owner: 'alice',
          name: 'repo-b',
          url: 'https://github.com/alice/repo-b',
        },
        scannedAt: daysAgoIso(1),
        metrics: {
          commitsPerDay: 4,
          mergedPrsUnverified: 6,
          mergedPrsCiVerified: 5,
          mergedPrs: 5,
          activeCodingHours: 24,
          offHoursRatio: 0.3,
          velocityAcceleration: 0.35,
          equivalentEngineeringHours: 60,
        },
      }),
    );

    const artifact = await getLeaderboardArtifact(db);
    const alice = artifact.entries.find((entry) => entry.handle === 'alice');

    expect(alice?.thirtyDay).toEqual({
      equivalentEngineeringHours: 100,
      mergedPrs: 9,
      commitsPerDay: 3.5,
      activeCodingHours: 22,
    });
    expect(alice?.provenance?.thirtyDay.source).toBe('d1:snapshots.current30d.latest-per-repo');
  });

  it('Wave3 contract: exposes freshness metadata, trust signals, and server-backed rivalry progression', async () => {
    const aliceRoundOne = seededEntryWithRepo('alice', 100);
    const bobRoundOne = seededEntryWithRepo('bob', 140);
    const aliceRoundTwo = seededEntryWithRepo('alice', 120);
    const bobRoundTwo = seededEntryWithRepo('bob', 150);

    await persistLeaderboardArtifact(db, {
      generatedAt: '2026-02-20T00:00:00.000Z',
      sourceSeedPath: 'data/seed-creators.json',
      entries: [
        {
          ...aliceRoundOne,
          rank: 2,
          aiReadyScore: 86,
          totals: {
            ...aliceRoundOne.totals,
            equivalentEngineeringHours: 100,
            mergedPrsUnverified: 12,
            mergedPrsCiVerified: 10,
            mergedPrs: 10,
            commitsPerDay: 6,
            activeCodingHours: 48,
            offHoursRatio: 0.45,
            velocityAcceleration: 0.3,
          },
        },
        {
          ...bobRoundOne,
          rank: 1,
          aiReadyScore: 74,
          totals: {
            ...bobRoundOne.totals,
            equivalentEngineeringHours: 140,
            mergedPrsUnverified: 14,
            mergedPrsCiVerified: 13,
            mergedPrs: 13,
            commitsPerDay: 7,
            activeCodingHours: 54,
            offHoursRatio: 0.3,
            velocityAcceleration: 0.35,
          },
        },
      ],
    });

    await persistLeaderboardArtifact(db, {
      generatedAt: '2026-03-01T00:00:00.000Z',
      sourceSeedPath: 'data/seed-creators.json',
      entries: [
        {
          ...aliceRoundTwo,
          rank: 2,
          aiReadyScore: 86,
          totals: {
            ...aliceRoundTwo.totals,
            equivalentEngineeringHours: 120,
            mergedPrsUnverified: 20,
            mergedPrsCiVerified: 2,
            mergedPrs: 2,
            commitsPerDay: 28,
            activeCodingHours: 62,
            offHoursRatio: 0.82,
            velocityAcceleration: 0.7,
          },
        },
        {
          ...bobRoundTwo,
          rank: 1,
          aiReadyScore: 74,
          totals: {
            ...bobRoundTwo.totals,
            equivalentEngineeringHours: 150,
            mergedPrsUnverified: 15,
            mergedPrsCiVerified: 14,
            mergedPrs: 14,
            commitsPerDay: 8,
            activeCodingHours: 56,
            offHoursRatio: 0.34,
            velocityAcceleration: 0.38,
          },
        },
      ],
    });

    const leaderboard = await getLeaderboardArtifact(db);
    const aliceEntry = leaderboard.entries.find((entry) => entry.handle === 'alice');
    const bobEntry = leaderboard.entries.find((entry) => entry.handle === 'bob');
    expect(leaderboard.freshness?.schemaVersion).toBe('2026-03-wave3');
    expect(leaderboard.freshness?.cacheVersion).toMatch(/^\d+:\d+$/);
    expect(leaderboard.freshness?.latestSnapshotId).toBeGreaterThan(0);
    expect(leaderboard.freshness?.isStale).toBe(false);
    expect(leaderboard.freshness?.staleReasons).toEqual([]);
    expect(aliceEntry?.trust?.verification.state).toBe('pending');
    expect(aliceEntry?.trust?.verification.reasonCodes).toContain('ci-coverage-below-threshold');
    expect(bobEntry?.trust?.verification.reasonCodes).toContain('readiness-below-threshold');
    expect((aliceEntry?.trust?.anomalies ?? []).map((flag) => flag.key)).toEqual(
      expect.arrayContaining(['ci-coverage-low', 'off-hours-dominant', 'commit-throughput-outlier']),
    );

    const aliceProfile = await getProfileByHandle(db, 'alice');
    expect(aliceProfile?.freshness?.cacheVersion).toBe(leaderboard.freshness?.cacheVersion);
    expect(aliceProfile?.leaderboard.trust?.verification.reasonCodes).toContain('ci-coverage-below-threshold');
    expect(aliceProfile?.rivalry?.source).toBe('server');
    expect(aliceProfile?.rivalry?.rivalHandle).toBe('bob');
    expect(aliceProfile?.rivalry?.trend).toBe('closing');
    expect(aliceProfile?.rivalry?.currentGapEquivalentEngineeringHours).toBe(-30);
  });
});

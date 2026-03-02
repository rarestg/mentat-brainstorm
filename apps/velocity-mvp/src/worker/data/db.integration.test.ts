import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeaderboardArtifact, RepoReportCard, SeedCreator } from '../../shared/types';

vi.mock('../../shared/leaderboard', () => ({
  buildLeaderboard: vi.fn(),
}));

import { buildLeaderboard } from '../../shared/leaderboard';
import { getLeaderboardArtifact, persistLeaderboardArtifact, persistScanReport, refreshLeaderboardFromSeed } from './db';

const buildLeaderboardMock = vi.mocked(buildLeaderboard);

function splitSqlStatements(sql: string): string[] {
  return sql
    .replace(/^PRAGMA\s+[^;]+;\s*$/gim, '')
    .split(';')
    .map((statement) => statement.replace(/\s+/g, ' ').trim())
    .filter((statement) => statement.length > 0)
    .map((statement) => `${statement};`);
}

async function loadMigrationStatements(): Promise<string[]> {
  const [schemaSql, authSql] = await Promise.all([
    readFile(new URL('../../../migrations/0001_velocity_schema.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../../migrations/0002_auth_identity_refresh.sql', import.meta.url), 'utf8'),
  ]);
  return [...splitSqlStatements(schemaSql), ...splitSqlStatements(authSql)];
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
    scannedAt: '2026-02-28T12:00:00.000Z',
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
});

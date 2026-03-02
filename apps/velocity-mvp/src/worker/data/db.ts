import type {
  AttributionTransparency,
  LeaderboardArtifact,
  LeaderboardEntry,
  LeaderboardEntryProvenance,
  MetricBlockProvenance,
  ProfileCrown,
  ProfileMetricsHistoryPoint,
  ProfileResponse,
  RepoReportCard,
  SeedCreator,
} from '../../shared/types';
import { buildLeaderboard } from '../../shared/leaderboard';
import { detectInitialStackCrowns, inferOperatingStackTier, stackTierLabel } from './stack';

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function toStringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toBoolFromNumber(value: unknown): boolean {
  return toNumber(value, 0) > 0;
}

const HEATMAP_DAYS = 7;
const HEATMAP_HOURS = 24;
const PROFILE_TREND_POINTS_LIMIT = 10;
const PROFILE_ROTATING_INSIGHTS_LIMIT = 4;
const THROUGHPUT_HEATMAP_SOURCE = 'd1:scans.windows_json.current30d.throughputHeatmap';
const TREND_POINTS_SOURCE = 'd1:profile_metrics_history';
const ROTATING_INSIGHTS_SOURCE = 'derived:d1:leaderboard_rows+d1:profile_metrics_history';
const THIRTY_DAY_SOURCE = 'd1:snapshots.current30d.latest-per-repo';

function createEmptyHeatmapCounts(): number[][] {
  return Array.from({ length: HEATMAP_DAYS }, () => Array.from({ length: HEATMAP_HOURS }, () => 0));
}

function isIsoTimestamp(input: string): boolean {
  return Number.isFinite(Date.parse(input));
}

function latestIsoTimestamp(left: string | undefined, right: string | undefined): string | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  if (!isIsoTimestamp(left)) {
    return right;
  }
  if (!isIsoTimestamp(right)) {
    return left;
  }
  return left >= right ? left : right;
}

function isValidHeatmapMatrix(value: unknown): value is number[][] {
  return (
    Array.isArray(value) &&
    value.length === HEATMAP_DAYS &&
    value.every(
      (row) =>
        Array.isArray(row) &&
        row.length === HEATMAP_HOURS &&
        row.every((cell) => typeof cell === 'number' && Number.isFinite(cell) && cell >= 0),
    )
  );
}

function normalizeHeatmapCounts(matrix: number[][]): number[][] {
  return matrix.map((row) => row.map((value) => Math.max(0, Math.round(value))));
}

function addHeatmapCounts(target: number[][], source: number[][]): void {
  for (let day = 0; day < HEATMAP_DAYS; day += 1) {
    for (let hour = 0; hour < HEATMAP_HOURS; hour += 1) {
      target[day][hour] += source[day][hour];
    }
  }
}

function toHeatmapIntensityLevels(counts: number[][]): number[][] {
  let maxCount = 0;
  for (const row of counts) {
    for (const cell of row) {
      if (cell > maxCount) {
        maxCount = cell;
      }
    }
  }

  if (maxCount <= 0) {
    return createEmptyHeatmapCounts();
  }

  return counts.map((row) =>
    row.map((cell) => {
      if (cell <= 0) {
        return 0;
      }
      const scaled = Math.round((cell / maxCount) * 4);
      return Math.max(1, Math.min(4, scaled));
    }),
  );
}

function buildInClausePlaceholders(values: unknown[]): string {
  return values.map(() => '?').join(', ');
}

function buildTrendPointsFromHistory(
  pointsDescendingByCaptureTime: Array<{ equivalentEngineeringHours: number }>,
): number[] {
  if (pointsDescendingByCaptureTime.length < 2) {
    return [];
  }

  return [...pointsDescendingByCaptureTime]
    .reverse()
    .slice(-PROFILE_TREND_POINTS_LIMIT)
    .map((point) => round2(Math.max(0, toNumber(point.equivalentEngineeringHours))));
}

function formatRatioPercent(value: number): string {
  return `${round2(value * 100)}%`;
}

function formatSignedPercent(value: number): string {
  const rounded = round2(value * 100);
  return `${rounded >= 0 ? '+' : ''}${rounded}%`;
}

function buildRotatingInsights(
  entry: {
    rank: number;
    totals: {
      equivalentEngineeringHours: number;
      mergedPrsUnverified: number;
      mergedPrsCiVerified: number;
      mergedPrs: number;
      offHoursRatio: number;
      velocityAcceleration: number;
    };
  },
  percentile: number | undefined,
  trendPoints: number[],
): string[] {
  const insights: string[] = [];
  insights.push(
    `Rank #${entry.rank} with ${round2(entry.totals.equivalentEngineeringHours)} equivalent engineering hours in the current 30-day window.`,
  );

  if (entry.totals.mergedPrsUnverified > 0) {
    const coverageRatio = entry.totals.mergedPrsCiVerified / entry.totals.mergedPrsUnverified;
    insights.push(
      `CI verification coverage is ${formatRatioPercent(coverageRatio)} (${entry.totals.mergedPrsCiVerified}/${entry.totals.mergedPrsUnverified} merged PRs).`,
    );
  } else if (entry.totals.mergedPrsCiVerified > 0) {
    insights.push(`CI-verified merged PRs recorded: ${entry.totals.mergedPrsCiVerified}.`);
  } else {
    insights.push('No merged PRs were observed in this 30-day window.');
  }

  insights.push(
    `Velocity acceleration is ${formatSignedPercent(entry.totals.velocityAcceleration)} and off-hours ratio is ${formatRatioPercent(entry.totals.offHoursRatio)}.`,
  );

  if (trendPoints.length >= 2) {
    const delta = round2(trendPoints[trendPoints.length - 1] - trendPoints[0]);
    const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    insights.push(`Trend moved ${direction} by ${Math.abs(delta)} EEH across the latest ${trendPoints.length} snapshots.`);
  } else {
    insights.push(`Trend requires at least 2 snapshots; currently ${trendPoints.length} point is available.`);
  }

  if (typeof percentile === 'number' && Number.isFinite(percentile)) {
    insights.push(`Current global percentile is ${round2(percentile)}.`);
  }

  return insights.slice(0, PROFILE_ROTATING_INSIGHTS_LIMIT);
}

function buildScanActionInsightFromTotals(totals: {
  mergedPrsUnverified: number;
  mergedPrsCiVerified: number;
  offHoursRatio: number;
  velocityAcceleration: number;
  commitsPerDay: number;
}): string {
  if (totals.mergedPrsUnverified > 0) {
    const ciCoverage = totals.mergedPrsCiVerified / Math.max(1, totals.mergedPrsUnverified);
    if (ciCoverage < 0.7) {
      return `Next fix: improve CI verification coverage (${Math.round(ciCoverage * 100)}%) on merged PRs.`;
    }
  }
  if (totals.offHoursRatio > 0.45) {
    return `Next fix: reduce off-hours concentration (${Math.round(totals.offHoursRatio * 100)}%) by shifting core merge windows.`;
  }
  if (totals.velocityAcceleration < 0) {
    return 'Next fix: reverse negative acceleration by restoring weekly merged PR throughput.';
  }
  if (totals.commitsPerDay < 1.5) {
    return 'Next fix: increase consistent commit cadence before next leaderboard refresh.';
  }
  return 'Next fix: run Mentat Scan on your top repo for AI-readiness action items.';
}

function normalizeScanInsight(scanInsight: string | null | undefined, totals: {
  mergedPrsUnverified: number;
  mergedPrsCiVerified: number;
  offHoursRatio: number;
  velocityAcceleration: number;
  commitsPerDay: number;
}): string {
  const trimmed = typeof scanInsight === 'string' ? scanInsight.trim() : '';
  if (!trimmed) {
    return buildScanActionInsightFromTotals(totals);
  }

  const normalized = trimmed.toLowerCase();
  if (
    normalized.includes('mentat scan link pending in mvp') ||
    normalized.includes('live scan ingestion from /api/scan')
  ) {
    return buildScanActionInsightFromTotals(totals);
  }

  return trimmed;
}

function authoritativeProvenance(source: string, capturedAt?: string): MetricBlockProvenance {
  return {
    state: 'authoritative',
    source,
    capturedAt,
  };
}

function unavailableProvenance(source: string, reason: string, capturedAt?: string): MetricBlockProvenance {
  return {
    state: 'unavailable',
    source,
    reason,
    capturedAt,
  };
}

interface TrendPayload {
  trendPoints?: number[];
  capturedAt?: string;
  reason?: string;
}

interface HeatmapPayload {
  throughputHeatmap?: number[][];
  capturedAt?: string;
  reason?: string;
}

function buildFallbackRepoWindows(metrics: RepoReportCard['metrics']): RepoReportCard['windows'] {
  return [
    {
      label: 'current30d',
      commitCount: Math.max(0, Math.round(toNumber(metrics.commitsPerDay) * 30)),
      mergedPrCountUnverified: Math.max(0, Math.round(toNumber(metrics.mergedPrsUnverified))),
      mergedPrCountCiVerified: Math.max(0, Math.round(toNumber(metrics.mergedPrsCiVerified))),
      mergedPrCount: Math.max(0, Math.round(toNumber(metrics.mergedPrs))),
      activeCodingHours: round2(Math.max(0, toNumber(metrics.activeCodingHours))),
      offHoursRatio: round2(Math.max(0, toNumber(metrics.offHoursRatio))),
      equivalentEngineeringHours: round2(Math.max(0, toNumber(metrics.equivalentEngineeringHours))),
    },
    {
      label: 'previous30d',
      commitCount: 0,
      mergedPrCountUnverified: 0,
      mergedPrCountCiVerified: 0,
      mergedPrCount: 0,
      activeCodingHours: 0,
      offHoursRatio: 0,
      equivalentEngineeringHours: 0,
    },
  ];
}

function parseRepoAssumptions(assumptionsJson: string | null): RepoReportCard['assumptions'] {
  const fallback: RepoReportCard['assumptions'] = {
    offHoursDefinitionUtc: 'off-hours are unique commit-hour buckets outside 09:00-18:00 UTC.',
    equivalentEngineeringHoursFormula:
      'sum over 30 UTC days of min(12, 0.8*uniqueHours + 0.3*min(commits, 2*uniqueHours+1) + 1.5*min(ciVerifiedMergedPRs,3)).',
    defaultBranchScope: 'Default branch scope unavailable for this snapshot.',
    ciVerification: 'CI verification assumptions unavailable for this snapshot.',
  };

  if (!assumptionsJson) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(assumptionsJson) as unknown;
    if (!parsed || typeof parsed !== 'object') {
      return fallback;
    }
    const shape = parsed as Partial<RepoReportCard['assumptions']>;
    return {
      offHoursDefinitionUtc: toStringValue(shape.offHoursDefinitionUtc, fallback.offHoursDefinitionUtc),
      equivalentEngineeringHoursFormula: toStringValue(shape.equivalentEngineeringHoursFormula, fallback.equivalentEngineeringHoursFormula),
      defaultBranchScope: toStringValue(shape.defaultBranchScope, fallback.defaultBranchScope),
      ciVerification: toStringValue(shape.ciVerification, fallback.ciVerification),
    };
  } catch {
    return fallback;
  }
}

function parseRepoWindows(
  windowsJson: string | null,
  metrics: RepoReportCard['metrics'],
): RepoReportCard['windows'] {
  const fallback = buildFallbackRepoWindows(metrics);
  if (!windowsJson) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(windowsJson) as unknown;
    if (!Array.isArray(parsed)) {
      return fallback;
    }
    const sanitized: RepoReportCard['windows'] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      const row = item as Record<string, unknown>;
      const label = toStringValue(row.label);
      if (label !== 'current30d' && label !== 'previous30d') {
        continue;
      }
      sanitized.push({
        label,
        commitCount: Math.max(0, Math.round(toNumber(row.commitCount))),
        mergedPrCountUnverified: Math.max(0, Math.round(toNumber(row.mergedPrCountUnverified))),
        mergedPrCountCiVerified: Math.max(0, Math.round(toNumber(row.mergedPrCountCiVerified))),
        mergedPrCount: Math.max(0, Math.round(toNumber(row.mergedPrCount))),
        activeCodingHours: round2(Math.max(0, toNumber(row.activeCodingHours))),
        offHoursRatio: round2(Math.max(0, toNumber(row.offHoursRatio))),
        equivalentEngineeringHours: round2(Math.max(0, toNumber(row.equivalentEngineeringHours))),
        throughputHeatmap: isValidHeatmapMatrix(row.throughputHeatmap) ? normalizeHeatmapCounts(row.throughputHeatmap) : undefined,
      });
    }
    if (sanitized.length === 0) {
      return fallback;
    }
    const current = sanitized.find((entry) => entry.label === 'current30d') ?? fallback[0];
    const previous = sanitized.find((entry) => entry.label === 'previous30d') ?? fallback[1];
    return [current, previous];
  } catch {
    return fallback;
  }
}

function parseStoredAttribution(
  attributionJson: string | null,
  fallback: {
    attribution_mode: unknown;
    attribution_source: unknown;
    attribution_target_handle: unknown;
    attribution_strict: unknown;
  },
): AttributionTransparency {
  if (attributionJson) {
    try {
      const parsed = JSON.parse(attributionJson) as unknown;
      if (parsed && typeof parsed === 'object') {
        return normalizeAttribution(parsed as AttributionTransparency);
      }
    } catch {
      // Fall through to DB-column fallback attribution.
    }
  }
  return parseAttributionFromRow(fallback);
}

interface LatestRepoCardSqlRow {
  user_id: number;
  snapshot_id: number;
  scanned_at: string;
  owner: string;
  name: string;
  url: string;
  commits_per_day: number;
  merged_prs_unverified: number;
  merged_prs_ci_verified: number;
  merged_prs: number;
  active_coding_hours: number;
  off_hours_ratio: number;
  velocity_acceleration: number;
  equivalent_engineering_hours: number;
  attribution_mode: string;
  attribution_source: string;
  attributed_handle: string | null;
  attribution_strict: number;
  assumptions_json: string | null;
  windows_json: string | null;
  attribution_json: string | null;
  user_repo_rank: number;
}

async function loadLatestRepoCardsByUserId(
  db: D1Database,
  userIds: number[],
  limitPerUser = 3,
): Promise<Map<number, RepoReportCard[]>> {
  const cardsByUserId = new Map<number, RepoReportCard[]>();
  if (userIds.length === 0) {
    return cardsByUserId;
  }

  const placeholders = buildInClausePlaceholders(userIds);
  const rowsResult = await db
    .prepare(
      `WITH latest_repo_scans AS (
         SELECT
           s.user_id,
           s.repo_id,
           s.id AS snapshot_id,
           s.scanned_at,
           s.commits_per_day,
           s.merged_prs_unverified,
           s.merged_prs_ci_verified,
           s.merged_prs,
           s.active_coding_hours,
           s.off_hours_ratio,
           s.velocity_acceleration,
           s.equivalent_engineering_hours,
           s.attribution_mode,
           s.attribution_source,
           s.attributed_handle,
           s.attribution_strict,
           ROW_NUMBER() OVER (
             PARTITION BY s.user_id, s.repo_id
             ORDER BY datetime(s.scanned_at) DESC, s.id DESC
           ) AS repo_rank
         FROM snapshots s
         WHERE s.snapshot_type = 'scan'
           AND s.repo_id IS NOT NULL
           AND s.user_id IN (${placeholders})
       ),
       ranked_latest AS (
         SELECT
           lrs.*,
           r.owner,
           r.name,
           r.url,
           sc.assumptions_json,
           sc.windows_json,
           sc.attribution_json,
           ROW_NUMBER() OVER (
             PARTITION BY lrs.user_id
             ORDER BY lrs.equivalent_engineering_hours DESC, datetime(lrs.scanned_at) DESC, lrs.snapshot_id DESC
           ) AS user_repo_rank
         FROM latest_repo_scans lrs
         INNER JOIN repos r ON r.id = lrs.repo_id
         LEFT JOIN scans sc ON sc.snapshot_id = lrs.snapshot_id
         WHERE lrs.repo_rank = 1
       )
       SELECT
         user_id,
         snapshot_id,
         scanned_at,
         owner,
         name,
         url,
         commits_per_day,
         merged_prs_unverified,
         merged_prs_ci_verified,
         merged_prs,
         active_coding_hours,
         off_hours_ratio,
         velocity_acceleration,
         equivalent_engineering_hours,
         attribution_mode,
         attribution_source,
         attributed_handle,
         attribution_strict,
         assumptions_json,
         windows_json,
         attribution_json,
         user_repo_rank
       FROM ranked_latest
       WHERE user_repo_rank <= ${Math.max(1, Math.floor(limitPerUser))}
       ORDER BY user_id ASC, user_repo_rank ASC`,
    )
    .bind(...userIds)
    .all<LatestRepoCardSqlRow>();

  for (const row of rowsResult.results ?? []) {
    const metrics: RepoReportCard['metrics'] = {
      commitsPerDay: round2(Math.max(0, toNumber(row.commits_per_day))),
      mergedPrsUnverified: Math.max(0, Math.round(toNumber(row.merged_prs_unverified))),
      mergedPrsCiVerified: Math.max(0, Math.round(toNumber(row.merged_prs_ci_verified))),
      mergedPrs: Math.max(0, Math.round(toNumber(row.merged_prs))),
      activeCodingHours: round2(Math.max(0, toNumber(row.active_coding_hours))),
      offHoursRatio: round2(Math.max(0, toNumber(row.off_hours_ratio))),
      velocityAcceleration: round2(toNumber(row.velocity_acceleration)),
      equivalentEngineeringHours: round2(Math.max(0, toNumber(row.equivalent_engineering_hours))),
    };

    const card: RepoReportCard = {
      repo: {
        owner: toStringValue(row.owner),
        name: toStringValue(row.name),
        url: toStringValue(row.url),
      },
      scannedAt: toStringValue(row.scanned_at),
      attribution: parseStoredAttribution(row.attribution_json, {
        attribution_mode: row.attribution_mode,
        attribution_source: row.attribution_source,
        attribution_target_handle: row.attributed_handle,
        attribution_strict: row.attribution_strict,
      }),
      assumptions: parseRepoAssumptions(row.assumptions_json),
      windows: parseRepoWindows(row.windows_json, metrics),
      metrics,
    };

    const existing = cardsByUserId.get(row.user_id) ?? [];
    existing.push(card);
    cardsByUserId.set(row.user_id, existing);
  }

  return cardsByUserId;
}

interface HistoryTrendSqlRow {
  user_id: number;
  captured_at: string;
  equivalent_engineering_hours: number;
}

interface LatestScanHeatmapSqlRow {
  user_id: number;
  scanned_at: string;
  windows_json: string;
}

function parseCurrentWindowHeatmapFromWindowsJson(windowsJson: string): {
  foundCurrentWindow: boolean;
  heatmapCounts?: number[][];
} {
  try {
    const parsed = JSON.parse(windowsJson) as unknown;
    if (!Array.isArray(parsed)) {
      return { foundCurrentWindow: false };
    }

    const currentWindow = parsed.find((windowSummary) => {
      if (!windowSummary || typeof windowSummary !== 'object') {
        return false;
      }
      return toStringValue((windowSummary as { label?: unknown }).label) === 'current30d';
    }) as { throughputHeatmap?: unknown } | undefined;

    if (!currentWindow) {
      return { foundCurrentWindow: false };
    }

    if (!isValidHeatmapMatrix(currentWindow.throughputHeatmap)) {
      return { foundCurrentWindow: true };
    }

    return {
      foundCurrentWindow: true,
      heatmapCounts: normalizeHeatmapCounts(currentWindow.throughputHeatmap),
    };
  } catch {
    return { foundCurrentWindow: false };
  }
}

async function loadTrendPayloadByUserId(db: D1Database, userIds: number[]): Promise<Map<number, TrendPayload>> {
  const payloadByUserId = new Map<number, TrendPayload>();
  if (userIds.length === 0) {
    return payloadByUserId;
  }

  const placeholders = buildInClausePlaceholders(userIds);
  const trendRowsResult = await db
    .prepare(
      `WITH ranked_history AS (
         SELECT
           user_id,
           captured_at,
           equivalent_engineering_hours,
           ROW_NUMBER() OVER (
             PARTITION BY user_id
             ORDER BY datetime(captured_at) DESC, id DESC
           ) AS history_rank
         FROM profile_metrics_history
         WHERE user_id IN (${placeholders})
       )
       SELECT user_id, captured_at, equivalent_engineering_hours
       FROM ranked_history
       WHERE history_rank <= ${PROFILE_TREND_POINTS_LIMIT}
       ORDER BY user_id ASC, datetime(captured_at) DESC, captured_at DESC`,
    )
    .bind(...userIds)
    .all<HistoryTrendSqlRow>();

  const historyByUserId = new Map<number, Array<{ capturedAt: string; equivalentEngineeringHours: number }>>();
  for (const row of trendRowsResult.results ?? []) {
    const existing = historyByUserId.get(row.user_id) ?? [];
    existing.push({
      capturedAt: row.captured_at,
      equivalentEngineeringHours: round2(toNumber(row.equivalent_engineering_hours)),
    });
    historyByUserId.set(row.user_id, existing);
  }

  for (const userId of userIds) {
    const history = historyByUserId.get(userId) ?? [];
    const trendPoints = buildTrendPointsFromHistory(history);
    const latestCapturedAt = history[0]?.capturedAt;

    if (trendPoints.length >= 2) {
      payloadByUserId.set(userId, {
        trendPoints,
        capturedAt: latestCapturedAt,
      });
      continue;
    }

    payloadByUserId.set(userId, {
      capturedAt: latestCapturedAt,
      reason: history.length === 0 ? 'no-profile-history' : 'insufficient-history-points',
    });
  }

  return payloadByUserId;
}

async function loadHeatmapPayloadByUserId(db: D1Database, userIds: number[]): Promise<Map<number, HeatmapPayload>> {
  const payloadByUserId = new Map<number, HeatmapPayload>();
  if (userIds.length === 0) {
    return payloadByUserId;
  }

  const placeholders = buildInClausePlaceholders(userIds);
  const rowsResult = await db
    .prepare(
      `WITH latest_repo_scans AS (
         SELECT
           s.user_id,
           s.id AS snapshot_id,
           s.scanned_at,
           ROW_NUMBER() OVER (
             PARTITION BY s.user_id, s.repo_id
             ORDER BY datetime(s.scanned_at) DESC, s.id DESC
           ) AS repo_rank
         FROM snapshots s
         WHERE s.snapshot_type = 'scan'
           AND s.repo_id IS NOT NULL
           AND s.user_id IN (${placeholders})
       )
       SELECT
         lrs.user_id,
         lrs.scanned_at,
         sc.windows_json
       FROM latest_repo_scans lrs
       INNER JOIN scans sc ON sc.snapshot_id = lrs.snapshot_id
       WHERE lrs.repo_rank = 1`,
    )
    .bind(...userIds)
    .all<LatestScanHeatmapSqlRow>();

  const aggregateByUserId = new Map<
    number,
    {
      hasLatestRepoScan: boolean;
      hasCurrentWindow: boolean;
      hasHeatmapCounts: boolean;
      latestScannedAt?: string;
      counts: number[][];
    }
  >();

  for (const row of rowsResult.results ?? []) {
    const current = aggregateByUserId.get(row.user_id) ?? {
      hasLatestRepoScan: false,
      hasCurrentWindow: false,
      hasHeatmapCounts: false,
      latestScannedAt: undefined,
      counts: createEmptyHeatmapCounts(),
    };
    current.hasLatestRepoScan = true;
    current.latestScannedAt = latestIsoTimestamp(current.latestScannedAt, row.scanned_at);

    const parsed = parseCurrentWindowHeatmapFromWindowsJson(row.windows_json);
    if (parsed.foundCurrentWindow) {
      current.hasCurrentWindow = true;
    }
    if (parsed.heatmapCounts) {
      current.hasHeatmapCounts = true;
      addHeatmapCounts(current.counts, parsed.heatmapCounts);
    }

    aggregateByUserId.set(row.user_id, current);
  }

  for (const userId of userIds) {
    const aggregate = aggregateByUserId.get(userId);
    if (!aggregate) {
      payloadByUserId.set(userId, { reason: 'no-scan-history' });
      continue;
    }

    if (aggregate.hasHeatmapCounts) {
      payloadByUserId.set(userId, {
        throughputHeatmap: toHeatmapIntensityLevels(aggregate.counts),
        capturedAt: aggregate.latestScannedAt,
      });
      continue;
    }

    payloadByUserId.set(userId, {
      capturedAt: aggregate.latestScannedAt,
      reason: aggregate.hasCurrentWindow ? 'missing-throughput-heatmap-buckets' : 'missing-current30d-window',
    });
  }

  return payloadByUserId;
}

function buildProfileProvenance(params: {
  totalsCapturedAt?: string;
  trendPayload: TrendPayload;
  heatmapPayload: HeatmapPayload;
  hasRotatingInsights: boolean;
}): LeaderboardEntryProvenance {
  return {
    totals: authoritativeProvenance('d1:leaderboard_rows', params.totalsCapturedAt),
    thirtyDay: authoritativeProvenance(THIRTY_DAY_SOURCE, params.totalsCapturedAt),
    profile: {
      trendPoints: params.trendPayload.trendPoints
        ? authoritativeProvenance(TREND_POINTS_SOURCE, params.trendPayload.capturedAt)
        : unavailableProvenance(TREND_POINTS_SOURCE, params.trendPayload.reason ?? 'insufficient-history-points', params.trendPayload.capturedAt),
      throughputHeatmap: params.heatmapPayload.throughputHeatmap
        ? authoritativeProvenance(THROUGHPUT_HEATMAP_SOURCE, params.heatmapPayload.capturedAt)
        : unavailableProvenance(
            THROUGHPUT_HEATMAP_SOURCE,
            params.heatmapPayload.reason ?? 'missing-throughput-heatmap-buckets',
            params.heatmapPayload.capturedAt,
          ),
      rotatingInsights: params.hasRotatingInsights
        ? authoritativeProvenance(ROTATING_INSIGHTS_SOURCE, params.totalsCapturedAt)
        : unavailableProvenance(ROTATING_INSIGHTS_SOURCE, 'insights-derivation-failed', params.totalsCapturedAt),
    },
  };
}

function normalizeAttribution(input: AttributionTransparency | undefined): AttributionTransparency {
  if (input?.mode === 'handle-authored' && input.targetHandle) {
    return {
      mode: 'handle-authored',
      source: 'github-author-login-match',
      targetHandle: normalizeHandle(input.targetHandle),
      strict: true,
      productionReady: true,
      notes: input.notes,
    };
  }

  return {
    mode: 'repo-wide',
    source: 'github-author-login-match',
    strict: false,
    productionReady: true,
    notes: input?.notes ?? 'Repo-wide fallback attribution.',
  };
}

function attributionModeToRowValue(mode: AttributionTransparency['mode']): 'repo-wide' | 'handle-authored' {
  return mode === 'handle-authored' ? 'handle-authored' : 'repo-wide';
}

function parseAttributionFromRow(row: {
  attribution_mode?: unknown;
  attribution_source?: unknown;
  attribution_target_handle?: unknown;
  attribution_strict?: unknown;
}): AttributionTransparency {
  const mode = toStringValue(row.attribution_mode, 'repo-wide') === 'handle-authored' ? 'handle-authored' : 'repo-wide';
  const strict = toBoolFromNumber(row.attribution_strict);
  const targetHandle = toStringValue(row.attribution_target_handle);
  const sourceValue = toStringValue(row.attribution_source, 'github-author-login-match');
  const source: AttributionTransparency['source'] =
    sourceValue === 'github-author-login-match' ? 'github-author-login-match' : 'github-author-login-match';
  return {
    mode,
    source,
    targetHandle: targetHandle.length > 0 ? targetHandle : undefined,
    strict,
    productionReady: true,
    notes:
      mode === 'handle-authored'
        ? 'Metrics were attributed via strict GitHub commit/PR author login matching.'
        : 'Metrics include repo-wide non-bot activity.',
  };
}

export interface AuthSessionIdentity {
  sessionId: string;
  handle: string;
  userId: number;
  expiresAt: string;
  provider: 'github';
  providerLogin: string;
  providerUserId: string;
  avatarUrl: string | null;
  profileUrl: string | null;
}

export interface GitHubOAuthAccountInput {
  providerUserId: string;
  providerLogin: string;
  encryptedAccessToken: string;
  tokenType: string;
  scope: string;
  avatarUrl: string;
  profileUrl: string;
}

export interface RefreshSeedResult {
  runId: number;
  generatedAt: string;
  entriesProcessed: number;
  sourceSeedPath: string;
  trigger: 'manual' | 'scheduled';
}

async function upsertUser(db: D1Database, handle: string): Promise<number> {
  const normalized = normalizeHandle(handle);
  await db
    .prepare(
      `INSERT INTO users (handle, updated_at)
       VALUES (?, CURRENT_TIMESTAMP)
       ON CONFLICT(handle) DO UPDATE SET updated_at = excluded.updated_at`,
    )
    .bind(normalized)
    .run();

  const row = await db.prepare('SELECT id FROM users WHERE handle = ?').bind(normalized).first<{ id: number }>();
  return row?.id ?? 0;
}

async function upsertRepo(db: D1Database, owner: string, name: string, url: string): Promise<number> {
  await db
    .prepare(
      `INSERT INTO repos (owner, name, url, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(url) DO UPDATE SET owner = excluded.owner, name = excluded.name, updated_at = excluded.updated_at`,
    )
    .bind(owner, name, url)
    .run();

  const row = await db.prepare('SELECT id FROM repos WHERE url = ?').bind(url).first<{ id: number }>();
  return row?.id ?? 0;
}

async function upsertRepoOwnership(
  db: D1Database,
  userId: number,
  repoId: number,
  attribution: AttributionTransparency | undefined,
  source: string,
): Promise<void> {
  const normalized = normalizeAttribution(attribution);
  await db
    .prepare(
      `INSERT INTO repo_ownership (
        user_id,
        repo_id,
        attribution_mode,
        attribution_source,
        attribution_target_handle,
        strict_attribution,
        ownership_source,
        last_verified_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, repo_id) DO UPDATE SET
        attribution_mode = excluded.attribution_mode,
        attribution_source = excluded.attribution_source,
        attribution_target_handle = excluded.attribution_target_handle,
        strict_attribution = excluded.strict_attribution,
        ownership_source = excluded.ownership_source,
        last_verified_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      userId,
      repoId,
      attributionModeToRowValue(normalized.mode),
      normalized.source,
      normalized.targetHandle ?? null,
      normalized.strict ? 1 : 0,
      source,
    )
    .run();
}

async function insertSnapshot(
  db: D1Database,
  userId: number,
  repoId: number | null,
  scannedAt: string,
  metrics: RepoReportCard['metrics'],
  attribution: AttributionTransparency | undefined,
): Promise<number> {
  const normalizedAttribution = normalizeAttribution(attribution);
  const result = await db
    .prepare(
      `INSERT INTO snapshots (
        user_id,
        repo_id,
        snapshot_type,
        scanned_at,
        commits_per_day,
        merged_prs_unverified,
        merged_prs_ci_verified,
        merged_prs,
        active_coding_hours,
        off_hours_ratio,
        velocity_acceleration,
        equivalent_engineering_hours,
        attribution_mode,
        attribution_source,
        attributed_handle,
        attribution_strict
      ) VALUES (?, ?, 'scan', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      userId,
      repoId,
      scannedAt,
      metrics.commitsPerDay,
      metrics.mergedPrsUnverified,
      metrics.mergedPrsCiVerified,
      metrics.mergedPrs,
      metrics.activeCodingHours,
      metrics.offHoursRatio,
      metrics.velocityAcceleration,
      metrics.equivalentEngineeringHours,
      attributionModeToRowValue(normalizedAttribution.mode),
      normalizedAttribution.source,
      normalizedAttribution.targetHandle ?? null,
      normalizedAttribution.strict ? 1 : 0,
    )
    .run();

  return toNumber(result.meta.last_row_id);
}

async function insertScanDetails(db: D1Database, snapshotId: number, report: RepoReportCard): Promise<void> {
  const attributionJson = report.attribution ? JSON.stringify(report.attribution) : null;
  await db
    .prepare(
      `INSERT OR REPLACE INTO scans (snapshot_id, assumptions_json, windows_json, attribution_json)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(snapshotId, JSON.stringify(report.assumptions), JSON.stringify(report.windows), attributionJson)
    .run();
}

function computePercentile(rank: number, totalRows: number): number {
  if (totalRows <= 1) {
    return 100;
  }

  const boundedRank = Math.min(Math.max(Math.floor(rank), 1), totalRows);
  return round2((1 - (boundedRank - 1) / (totalRows - 1)) * 100);
}

async function upsertLeaderboardRow(db: D1Database, userId: number, entry: LeaderboardEntry): Promise<void> {
  const attribution = normalizeAttribution(entry.attribution);
  const rank = Math.max(1, Math.floor(entry.rank));
  await db
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
        total_velocity_acceleration,
        attribution_mode,
        attribution_source,
        attribution_target_handle,
        attribution_strict,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        rank = excluded.rank,
        scanned_repos = excluded.scanned_repos,
        featured_repo = excluded.featured_repo,
        ai_ready_score = excluded.ai_ready_score,
        scan_insight = excluded.scan_insight,
        total_equivalent_engineering_hours = excluded.total_equivalent_engineering_hours,
        total_merged_prs_unverified = excluded.total_merged_prs_unverified,
        total_merged_prs_ci_verified = excluded.total_merged_prs_ci_verified,
        total_merged_prs = excluded.total_merged_prs,
        total_commits_per_day = excluded.total_commits_per_day,
        total_active_coding_hours = excluded.total_active_coding_hours,
        total_off_hours_ratio = excluded.total_off_hours_ratio,
        total_velocity_acceleration = excluded.total_velocity_acceleration,
        attribution_mode = excluded.attribution_mode,
        attribution_source = excluded.attribution_source,
        attribution_target_handle = excluded.attribution_target_handle,
        attribution_strict = excluded.attribution_strict,
        updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      userId,
      rank,
      entry.scannedRepos,
      entry.featuredRepo ?? null,
      entry.aiReadyScore ?? null,
      entry.scanInsight ?? null,
      entry.totals.equivalentEngineeringHours,
      entry.totals.mergedPrsUnverified,
      entry.totals.mergedPrsCiVerified,
      entry.totals.mergedPrs,
      entry.totals.commitsPerDay,
      entry.totals.activeCodingHours,
      entry.totals.offHoursRatio,
      entry.totals.velocityAcceleration,
      attributionModeToRowValue(attribution.mode),
      attribution.source,
      attribution.targetHandle ?? normalizeHandle(entry.handle),
      attribution.strict ? 1 : 0,
    )
    .run();
}

async function recomputeLeaderboardRanks(db: D1Database): Promise<void> {
  await db
    .prepare(
      `WITH ranked AS (
         SELECT
           lr.user_id,
           ROW_NUMBER() OVER (
             ORDER BY
               lr.total_equivalent_engineering_hours DESC,
               lr.total_merged_prs_ci_verified DESC,
               lr.total_merged_prs DESC,
               lower(u.handle) ASC
           ) AS computed_rank
         FROM leaderboard_rows lr
         INNER JOIN users u ON u.id = lr.user_id
       )
       UPDATE leaderboard_rows
       SET rank = (
             SELECT computed_rank
             FROM ranked
             WHERE ranked.user_id = leaderboard_rows.user_id
           ),
           updated_at = CURRENT_TIMESTAMP
       WHERE user_id IN (SELECT user_id FROM ranked)`,
    )
    .run();
}

interface AggregatedScanMetricsRow {
  scanned_repos: number;
  featured_repo: string | null;
  attribution_mode: string;
  attribution_source: string;
  attribution_target_handle: string | null;
  attribution_strict: number;
  total_equivalent_engineering_hours: number;
  total_merged_prs_unverified: number;
  total_merged_prs_ci_verified: number;
  total_merged_prs: number;
  total_commits_per_day: number;
  total_active_coding_hours: number;
  total_off_hours_ratio: number;
  total_velocity_acceleration: number;
}

async function aggregateLatestScanMetricsForUser(
  db: D1Database,
  userId: number,
): Promise<AggregatedScanMetricsRow | null> {
  return db
    .prepare(
      `WITH latest_repo_scans AS (
         SELECT
           s.repo_id,
           s.commits_per_day,
           s.merged_prs_unverified,
           s.merged_prs_ci_verified,
           s.merged_prs,
           s.active_coding_hours,
           s.off_hours_ratio,
           s.velocity_acceleration,
           s.equivalent_engineering_hours,
           ROW_NUMBER() OVER (
             PARTITION BY s.repo_id
             ORDER BY datetime(s.scanned_at) DESC, s.id DESC
           ) AS repo_rank
         FROM snapshots s
         WHERE s.user_id = ?
           AND s.snapshot_type = 'scan'
           AND s.repo_id IS NOT NULL
       ),
       latest_user_scan AS (
         SELECT
           s.attribution_mode,
           s.attribution_source,
           s.attributed_handle,
           s.attribution_strict
         FROM snapshots s
         WHERE s.user_id = ?
           AND s.snapshot_type = 'scan'
         ORDER BY datetime(s.scanned_at) DESC, s.id DESC
         LIMIT 1
       ),
       latest_featured_repo AS (
         SELECT r.url AS featured_repo
         FROM snapshots s
         INNER JOIN repos r ON r.id = s.repo_id
         WHERE s.user_id = ?
           AND s.snapshot_type = 'scan'
           AND s.repo_id IS NOT NULL
         ORDER BY datetime(s.scanned_at) DESC, s.id DESC
         LIMIT 1
       )
       SELECT
         COALESCE(COUNT(*), 0) AS scanned_repos,
         (SELECT featured_repo FROM latest_featured_repo) AS featured_repo,
         COALESCE((SELECT attribution_mode FROM latest_user_scan), 'repo-wide') AS attribution_mode,
         COALESCE((SELECT attribution_source FROM latest_user_scan), 'github-author-login-match') AS attribution_source,
         (SELECT attributed_handle FROM latest_user_scan) AS attribution_target_handle,
         COALESCE((SELECT attribution_strict FROM latest_user_scan), 0) AS attribution_strict,
         COALESCE(SUM(lrs.equivalent_engineering_hours), 0) AS total_equivalent_engineering_hours,
         COALESCE(SUM(lrs.merged_prs_unverified), 0) AS total_merged_prs_unverified,
         COALESCE(SUM(lrs.merged_prs_ci_verified), 0) AS total_merged_prs_ci_verified,
         COALESCE(SUM(lrs.merged_prs), 0) AS total_merged_prs,
         COALESCE(AVG(lrs.commits_per_day), 0) AS total_commits_per_day,
         COALESCE(AVG(lrs.active_coding_hours), 0) AS total_active_coding_hours,
         COALESCE(AVG(lrs.off_hours_ratio), 0) AS total_off_hours_ratio,
         COALESCE(AVG(lrs.velocity_acceleration), 0) AS total_velocity_acceleration
       FROM latest_repo_scans lrs
       WHERE lrs.repo_rank = 1`,
    )
    .bind(userId, userId, userId)
    .first<AggregatedScanMetricsRow>();
}

async function getCurrentRankAndTotalRows(
  db: D1Database,
  userId: number,
): Promise<{ rank: number; totalRows: number }> {
  const row = await db
    .prepare(
      `SELECT
         rank,
         (SELECT COUNT(*) FROM leaderboard_rows) AS total_rows
       FROM leaderboard_rows
       WHERE user_id = ?
       LIMIT 1`,
    )
    .bind(userId)
    .first<{ rank: number; total_rows: number }>();

  return {
    rank: Math.max(1, toNumber(row?.rank, 1)),
    totalRows: Math.max(1, toNumber(row?.total_rows, 1)),
  };
}

async function insertCrown(db: D1Database, userId: number, key: string, label: string, awardedAt: string): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO crowns (user_id, crown_key, label, awarded_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(userId, key, label, awardedAt)
    .run();
}

async function insertHistoryPoint(
  db: D1Database,
  userId: number,
  capturedAt: string,
  rank: number,
  percentile: number,
  equivalentEngineeringHours: number,
  mergedPrs: number,
  commitsPerDay: number,
  activeCodingHours: number,
  refreshRunId?: number,
): Promise<void> {
  const stackTier = inferOperatingStackTier({
    commitsPerDay,
    offHoursRatio: 0,
    activeCodingHours,
  });
  await db
    .prepare(
      `INSERT INTO profile_metrics_history (
        user_id,
        captured_at,
        rank,
        percentile,
        stack_tier,
        equivalent_engineering_hours,
        merged_prs,
        commits_per_day,
        active_coding_hours,
        refresh_run_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, captured_at) DO UPDATE SET
        rank = excluded.rank,
        percentile = excluded.percentile,
        stack_tier = excluded.stack_tier,
        equivalent_engineering_hours = excluded.equivalent_engineering_hours,
        merged_prs = excluded.merged_prs,
        commits_per_day = excluded.commits_per_day,
        active_coding_hours = excluded.active_coding_hours,
        refresh_run_id = excluded.refresh_run_id`,
    )
    .bind(
      userId,
      capturedAt,
      rank,
      percentile,
      stackTier,
      equivalentEngineeringHours,
      mergedPrs,
      commitsPerDay,
      activeCodingHours,
      refreshRunId ?? null,
    )
    .run();
}

interface PersistArtifactOptions {
  refreshRunId?: number;
  ownershipSource?: string;
  pruneRowsOutsideArtifact?: boolean;
}

export async function persistLeaderboardArtifact(
  db: D1Database,
  artifact: LeaderboardArtifact,
  options?: PersistArtifactOptions,
): Promise<void> {
  const totalRows = artifact.entries.length;
  const persistedUserIds: number[] = [];
  const ownershipSource = options?.ownershipSource ?? 'seed-artifact';

  for (const entry of artifact.entries) {
    const userId = await upsertUser(db, entry.handle);
    persistedUserIds.push(userId);
    await upsertLeaderboardRow(db, userId, entry);

    for (const crown of detectInitialStackCrowns(entry)) {
      await insertCrown(db, userId, crown.key, crown.label, artifact.generatedAt);
    }

    await insertHistoryPoint(
      db,
      userId,
      artifact.generatedAt,
      entry.rank,
      computePercentile(entry.rank, totalRows),
      entry.totals.equivalentEngineeringHours,
      entry.totals.mergedPrs,
      entry.totals.commitsPerDay,
      entry.totals.activeCodingHours,
      options?.refreshRunId,
    );

    for (const report of entry.repos) {
      const repoId = await upsertRepo(db, report.repo.owner, report.repo.name, report.repo.url);
      await upsertRepoOwnership(db, userId, repoId, report.attribution, ownershipSource);
      const snapshotId = await insertSnapshot(db, userId, repoId, report.scannedAt, report.metrics, report.attribution);
      if (snapshotId > 0) {
        await insertScanDetails(db, snapshotId, report);
      }
    }
  }

  if (!options?.pruneRowsOutsideArtifact) {
    await recomputeLeaderboardRanks(db);
    return;
  }

  const placeholders = persistedUserIds.map(() => '?').join(', ');
  const staleSeedFilter =
    persistedUserIds.length > 0
      ? `lr.user_id NOT IN (${placeholders}) AND`
      : '';
  await db
    .prepare(
      `DELETE FROM leaderboard_rows
       WHERE user_id IN (
         SELECT lr.user_id
         FROM leaderboard_rows lr
         WHERE ${staleSeedFilter}
           EXISTS (
             SELECT 1
             FROM repo_ownership ro
             WHERE ro.user_id = lr.user_id
               AND ro.ownership_source LIKE 'seed-%'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM repo_ownership ro
             WHERE ro.user_id = lr.user_id
               AND ro.ownership_source NOT LIKE 'seed-%'
           )
       )`,
    )
    .bind(...persistedUserIds)
    .run();

  await recomputeLeaderboardRanks(db);
}

export async function ensureSeedData(db: D1Database, artifact: LeaderboardArtifact): Promise<void> {
  const countRow = await db.prepare('SELECT COUNT(*) AS count FROM leaderboard_rows').first<{ count: number }>();
  const count = toNumber(countRow?.count);
  if (count > 0) {
    return;
  }
  await persistLeaderboardArtifact(db, artifact);
}

async function upsertGitHubOAuthAccount(db: D1Database, userId: number, account: GitHubOAuthAccountInput): Promise<number> {
  await db
    .prepare(
      `INSERT INTO oauth_accounts (
        user_id,
        provider,
        provider_user_id,
        provider_login,
        access_token,
        token_type,
        scope,
        avatar_url,
        profile_url,
        updated_at,
        last_refreshed_at
      ) VALUES (?, 'github', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(provider, provider_user_id) DO UPDATE SET
        user_id = excluded.user_id,
        provider_login = excluded.provider_login,
        access_token = excluded.access_token,
        token_type = excluded.token_type,
        scope = excluded.scope,
        avatar_url = excluded.avatar_url,
        profile_url = excluded.profile_url,
        updated_at = CURRENT_TIMESTAMP,
        last_refreshed_at = CURRENT_TIMESTAMP`,
    )
    .bind(
      userId,
      account.providerUserId,
      normalizeHandle(account.providerLogin),
      account.encryptedAccessToken,
      account.tokenType,
      account.scope,
      account.avatarUrl,
      account.profileUrl,
    )
    .run();

  const row = await db
    .prepare(
      `SELECT id
       FROM oauth_accounts
       WHERE provider = 'github' AND provider_user_id = ?
       LIMIT 1`,
    )
    .bind(account.providerUserId)
    .first<{ id: number }>();
  return toNumber(row?.id);
}

export async function upsertGitHubOAuthIdentity(
  db: D1Database,
  handle: string,
  account: GitHubOAuthAccountInput,
): Promise<{ userId: number; handle: string; oauthAccountId: number }> {
  const normalizedHandle = normalizeHandle(handle);
  const userId = await upsertUser(db, normalizedHandle);
  const oauthAccountId = await upsertGitHubOAuthAccount(db, userId, account);

  return {
    userId,
    handle: normalizedHandle,
    oauthAccountId,
  };
}

export async function createSessionRecord(
  db: D1Database,
  input: {
    sessionId: string;
    userId: number;
    tokenHash: string;
    expiresAt: string;
    userAgent?: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO sessions (
        id,
        user_id,
        token_hash,
        expires_at,
        user_agent,
        last_seen_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    )
    .bind(input.sessionId, input.userId, input.tokenHash, input.expiresAt, input.userAgent ?? null)
    .run();
}

export async function revokeSessionByTokenHash(db: D1Database, tokenHash: string): Promise<void> {
  await db
    .prepare(
      `UPDATE sessions
       SET revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .bind(tokenHash)
    .run();
}

interface SessionLookupRow {
  session_id: string;
  user_id: number;
  handle: string;
  expires_at: string;
  provider_login: string | null;
  provider_user_id: string | null;
  avatar_url: string | null;
  profile_url: string | null;
}

export async function getSessionIdentityByTokenHash(db: D1Database, tokenHash: string): Promise<AuthSessionIdentity | null> {
  const row = await db
    .prepare(
      `SELECT
        s.id AS session_id,
        s.user_id,
        s.expires_at,
        u.handle,
        oa.provider_login,
        oa.provider_user_id,
        oa.avatar_url,
        oa.profile_url
      FROM sessions s
      INNER JOIN users u ON u.id = s.user_id
      LEFT JOIN oauth_accounts oa ON oa.user_id = s.user_id AND oa.provider = 'github'
      WHERE s.token_hash = ?
        AND s.revoked_at IS NULL
        AND datetime(s.expires_at) > datetime('now')
      LIMIT 1`,
    )
    .bind(tokenHash)
    .first<SessionLookupRow>();

  if (!row) {
    return null;
  }

  await db
    .prepare('UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(row.session_id)
    .run();

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    handle: toStringValue(row.handle),
    expiresAt: row.expires_at,
    provider: 'github',
    providerLogin: toStringValue(row.provider_login, toStringValue(row.handle)),
    providerUserId: toStringValue(row.provider_user_id),
    avatarUrl: row.avatar_url,
    profileUrl: row.profile_url,
  };
}

async function startRefreshRun(
  db: D1Database,
  trigger: RefreshSeedResult['trigger'],
  sourceSeedPath: string,
): Promise<{ runId: number; startedAt: string }> {
  const startedAt = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT INTO refresh_runs (
        trigger_type,
        source_seed_path,
        status,
        started_at
      ) VALUES (?, ?, 'running', ?)`,
    )
    .bind(trigger, sourceSeedPath, startedAt)
    .run();

  return {
    runId: toNumber(result.meta.last_row_id),
    startedAt,
  };
}

async function markRefreshRunSuccess(
  db: D1Database,
  runId: number,
  artifact: LeaderboardArtifact,
): Promise<{ finishedAt: string }> {
  const finishedAt = new Date().toISOString();
  await db
    .prepare(
      `UPDATE refresh_runs
       SET status = 'success',
           generated_at = ?,
           entries_processed = ?,
           finished_at = ?,
           error_message = NULL
       WHERE id = ?`,
    )
    .bind(artifact.generatedAt, artifact.entries.length, finishedAt, runId)
    .run();

  return { finishedAt };
}

async function markRefreshRunFailure(db: D1Database, runId: number, errorMessage: string): Promise<void> {
  await db
    .prepare(
      `UPDATE refresh_runs
       SET status = 'failed',
           finished_at = CURRENT_TIMESTAMP,
           error_message = ?
       WHERE id = ?`,
    )
    .bind(errorMessage.slice(0, 600), runId)
    .run();
}

interface LeaderboardRowSnapshot {
  user_id: number;
  rank: number;
  scanned_repos: number;
  featured_repo: string | null;
  ai_ready_score: number | null;
  scan_insight: string | null;
  total_equivalent_engineering_hours: number;
  total_merged_prs_unverified: number;
  total_merged_prs_ci_verified: number;
  total_merged_prs: number;
  total_commits_per_day: number;
  total_active_coding_hours: number;
  total_off_hours_ratio: number;
  total_velocity_acceleration: number;
  attribution_mode: string;
  attribution_source: string;
  attribution_target_handle: string | null;
  attribution_strict: number;
  updated_at: string;
}

async function snapshotLeaderboardRows(db: D1Database): Promise<LeaderboardRowSnapshot[]> {
  const result = await db
    .prepare(
      `SELECT
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
         total_velocity_acceleration,
         attribution_mode,
         attribution_source,
         attribution_target_handle,
         attribution_strict,
         updated_at
       FROM leaderboard_rows`,
    )
    .all<LeaderboardRowSnapshot>();

  return result.results ?? [];
}

async function restoreLeaderboardRows(db: D1Database, snapshot: LeaderboardRowSnapshot[]): Promise<void> {
  await db.prepare('DELETE FROM leaderboard_rows').run();
  for (const row of snapshot) {
    await db
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
           total_velocity_acceleration,
           attribution_mode,
           attribution_source,
           attribution_target_handle,
           attribution_strict,
           updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        row.user_id,
        row.rank,
        row.scanned_repos,
        row.featured_repo,
        row.ai_ready_score,
        row.scan_insight,
        row.total_equivalent_engineering_hours,
        row.total_merged_prs_unverified,
        row.total_merged_prs_ci_verified,
        row.total_merged_prs,
        row.total_commits_per_day,
        row.total_active_coding_hours,
        row.total_off_hours_ratio,
        row.total_velocity_acceleration,
        row.attribution_mode,
        row.attribution_source,
        row.attribution_target_handle,
        row.attribution_strict,
        row.updated_at,
      )
      .run();
  }
}

export async function refreshLeaderboardFromSeed(
  db: D1Database,
  seed: SeedCreator[],
  token: string | undefined,
  trigger: RefreshSeedResult['trigger'],
): Promise<RefreshSeedResult> {
  const sourceSeedPath = 'data/seed-creators.json';
  const { runId } = await startRefreshRun(db, trigger, sourceSeedPath);
  const leaderboardBeforeRefresh = await snapshotLeaderboardRows(db);
  let persistenceAttempted = false;

  try {
    const artifact = await buildLeaderboard(seed, token);
    persistenceAttempted = true;
    await persistLeaderboardArtifact(db, artifact, {
      refreshRunId: runId,
      ownershipSource: `seed-refresh:${trigger}`,
      pruneRowsOutsideArtifact: true,
    });
    await markRefreshRunSuccess(db, runId, artifact);

    return {
      runId,
      generatedAt: artifact.generatedAt,
      entriesProcessed: artifact.entries.length,
      sourceSeedPath: artifact.sourceSeedPath,
      trigger,
    };
  } catch (error) {
    if (persistenceAttempted) {
      try {
        await restoreLeaderboardRows(db, leaderboardBeforeRefresh);
        await db.prepare('DELETE FROM profile_metrics_history WHERE refresh_run_id = ?').bind(runId).run();
      } catch (restoreError) {
        const restoreMessage = restoreError instanceof Error ? restoreError.message : String(restoreError);
        const originalMessage = error instanceof Error ? error.message : String(error);
        await markRefreshRunFailure(db, runId, `${originalMessage} | rollback-failed: ${restoreMessage}`);
        throw error;
      }
    }
    const message = error instanceof Error ? error.message : 'Unknown seed refresh failure';
    await markRefreshRunFailure(db, runId, message);
    throw error;
  }
}

export async function persistScanReport(db: D1Database, report: RepoReportCard): Promise<void> {
  const userId = await upsertUser(db, report.repo.owner);
  const repoId = await upsertRepo(db, report.repo.owner, report.repo.name, report.repo.url);
  await upsertRepoOwnership(db, userId, repoId, report.attribution, 'manual-scan');
  const snapshotId = await insertSnapshot(db, userId, repoId, report.scannedAt, report.metrics, report.attribution);
  if (snapshotId > 0) {
    await insertScanDetails(db, snapshotId, report);
  }

  const aggregate = await aggregateLatestScanMetricsForUser(db, userId);
  if (!aggregate) {
    return;
  }

  const handleRow = await db.prepare('SELECT handle FROM users WHERE id = ?').bind(userId).first<{ handle: string }>();
  const inferredEntry: LeaderboardEntry = {
    rank: 1,
    handle: toStringValue(handleRow?.handle, report.repo.owner),
    scannedRepos: Math.max(1, Math.round(toNumber(aggregate.scanned_repos, 1))),
    featuredRepo: aggregate.featured_repo ?? report.repo.url,
    scanInsight: buildScanActionInsightFromTotals({
      mergedPrsUnverified: Math.round(toNumber(aggregate.total_merged_prs_unverified)),
      mergedPrsCiVerified: Math.round(toNumber(aggregate.total_merged_prs_ci_verified)),
      offHoursRatio: round2(toNumber(aggregate.total_off_hours_ratio)),
      velocityAcceleration: round2(toNumber(aggregate.total_velocity_acceleration)),
      commitsPerDay: round2(toNumber(aggregate.total_commits_per_day)),
    }),
    attribution: parseAttributionFromRow(aggregate),
    totals: {
      equivalentEngineeringHours: round2(toNumber(aggregate.total_equivalent_engineering_hours)),
      mergedPrsUnverified: Math.round(toNumber(aggregate.total_merged_prs_unverified)),
      mergedPrsCiVerified: Math.round(toNumber(aggregate.total_merged_prs_ci_verified)),
      mergedPrs: Math.round(toNumber(aggregate.total_merged_prs)),
      commitsPerDay: round2(toNumber(aggregate.total_commits_per_day)),
      activeCodingHours: round2(toNumber(aggregate.total_active_coding_hours)),
      offHoursRatio: round2(toNumber(aggregate.total_off_hours_ratio)),
      velocityAcceleration: round2(toNumber(aggregate.total_velocity_acceleration)),
    },
    repos: [],
  };

  await upsertLeaderboardRow(db, userId, inferredEntry);
  await recomputeLeaderboardRanks(db);

  const { rank, totalRows } = await getCurrentRankAndTotalRows(db, userId);
  await insertHistoryPoint(
    db,
    userId,
    report.scannedAt,
    rank,
    computePercentile(rank, totalRows),
    inferredEntry.totals.equivalentEngineeringHours,
    inferredEntry.totals.mergedPrs,
    inferredEntry.totals.commitsPerDay,
    inferredEntry.totals.activeCodingHours,
    undefined,
  );
}

interface LeaderboardSqlRow {
  user_id: number;
  handle: string;
  rank: number;
  leaderboard_updated_at: string;
  scanned_repos: number;
  featured_repo: string | null;
  ai_ready_score: number | null;
  scan_insight: string | null;
  total_equivalent_engineering_hours: number;
  total_merged_prs_unverified: number;
  total_merged_prs_ci_verified: number;
  total_merged_prs: number;
  total_commits_per_day: number;
  total_active_coding_hours: number;
  total_off_hours_ratio: number;
  total_velocity_acceleration: number;
  attribution_mode: string;
  attribution_source: string;
  attribution_target_handle: string | null;
  attribution_strict: number;
  t30_equivalent_engineering_hours: number;
  t30_merged_prs: number;
  t30_commits_per_day: number;
  t30_active_coding_hours: number;
}

interface CrownRow {
  handle: string;
  crown_key: string;
}

async function loadCrownsByHandle(db: D1Database): Promise<Map<string, string[]>> {
  const result = await db
    .prepare(
      `SELECT u.handle, c.crown_key
       FROM crowns c
       INNER JOIN users u ON u.id = c.user_id`,
    )
    .all<CrownRow>();

  const map = new Map<string, string[]>();
  for (const row of result.results ?? []) {
    const handle = toStringValue(row.handle).toLowerCase();
    const existing = map.get(handle) ?? [];
    existing.push(toStringValue(row.crown_key));
    map.set(handle, existing);
  }
  return map;
}

export async function getLeaderboardArtifact(db: D1Database): Promise<LeaderboardArtifact> {
  const rowsResult = await db
    .prepare(
      `SELECT
        lr.user_id,
        u.handle,
        lr.rank,
        lr.updated_at AS leaderboard_updated_at,
        lr.scanned_repos,
        lr.featured_repo,
        lr.ai_ready_score,
        lr.scan_insight,
        lr.total_equivalent_engineering_hours,
        lr.total_merged_prs_unverified,
        lr.total_merged_prs_ci_verified,
        lr.total_merged_prs,
        lr.total_commits_per_day,
        lr.total_active_coding_hours,
        lr.total_off_hours_ratio,
        lr.total_velocity_acceleration,
        lr.attribution_mode,
        lr.attribution_source,
        lr.attribution_target_handle,
        lr.attribution_strict,
        COALESCE(t30.equivalent_engineering_hours, 0) AS t30_equivalent_engineering_hours,
        COALESCE(t30.merged_prs, 0) AS t30_merged_prs,
        COALESCE(t30.commits_per_day, 0) AS t30_commits_per_day,
        COALESCE(t30.active_coding_hours, 0) AS t30_active_coding_hours
      FROM leaderboard_rows lr
      INNER JOIN users u ON u.id = lr.user_id
      LEFT JOIN (
        SELECT
          latest.user_id,
          SUM(latest.equivalent_engineering_hours) AS equivalent_engineering_hours,
          SUM(latest.merged_prs) AS merged_prs,
          AVG(latest.commits_per_day) AS commits_per_day,
          AVG(latest.active_coding_hours) AS active_coding_hours
        FROM (
          SELECT
            s.user_id,
            s.repo_id,
            s.equivalent_engineering_hours,
            s.merged_prs,
            s.commits_per_day,
            s.active_coding_hours,
            ROW_NUMBER() OVER (
              PARTITION BY s.user_id, s.repo_id
              ORDER BY datetime(s.scanned_at) DESC, s.id DESC
            ) AS repo_rank
          FROM snapshots s
          WHERE s.snapshot_type = 'scan'
            AND s.repo_id IS NOT NULL
            AND datetime(s.scanned_at) >= datetime('now', '-30 day')
        ) latest
        WHERE latest.repo_rank = 1
        GROUP BY latest.user_id
      ) t30 ON t30.user_id = lr.user_id
      ORDER BY lr.rank ASC, lr.total_equivalent_engineering_hours DESC`,
    )
    .all<LeaderboardSqlRow>();

  const rows = rowsResult.results ?? [];
  const userIds = rows.map((row) => toNumber(row.user_id)).filter((userId) => userId > 0);
  const [crownsByHandle, trendPayloadByUserId, heatmapPayloadByUserId, repoCardsByUserId] = await Promise.all([
    loadCrownsByHandle(db),
    loadTrendPayloadByUserId(db, userIds),
    loadHeatmapPayloadByUserId(db, userIds),
    loadLatestRepoCardsByUserId(db, userIds, 3),
  ]);

  const entries: LeaderboardEntry[] = rows.map((row, index) => {
    const fallbackRank = index + 1;
    const rank = Math.min(Math.max(1, Math.round(toNumber(row.rank, fallbackRank))), rows.length || fallbackRank);
    const totalEeh = toNumber(row.total_equivalent_engineering_hours);
    const handle = toStringValue(row.handle);
    const normalizedHandle = handle.toLowerCase();
    const percentile = computePercentile(rank, rows.length);
    const totalsCapturedAt = isIsoTimestamp(row.leaderboard_updated_at) ? row.leaderboard_updated_at : undefined;
    const trendPayload = trendPayloadByUserId.get(row.user_id) ?? { reason: 'no-profile-history' };
    const heatmapPayload = heatmapPayloadByUserId.get(row.user_id) ?? { reason: 'no-scan-history' };

    const totals = {
      equivalentEngineeringHours: round2(totalEeh),
      mergedPrsUnverified: Math.round(toNumber(row.total_merged_prs_unverified)),
      mergedPrsCiVerified: Math.round(toNumber(row.total_merged_prs_ci_verified)),
      mergedPrs: Math.round(toNumber(row.total_merged_prs)),
      commitsPerDay: round2(toNumber(row.total_commits_per_day)),
      activeCodingHours: round2(toNumber(row.total_active_coding_hours)),
      offHoursRatio: round2(toNumber(row.total_off_hours_ratio)),
      velocityAcceleration: round2(toNumber(row.total_velocity_acceleration)),
    };
    const scanInsight = normalizeScanInsight(row.scan_insight, {
      mergedPrsUnverified: totals.mergedPrsUnverified,
      mergedPrsCiVerified: totals.mergedPrsCiVerified,
      offHoursRatio: totals.offHoursRatio,
      velocityAcceleration: totals.velocityAcceleration,
      commitsPerDay: totals.commitsPerDay,
    });
    const rotatingInsights = buildRotatingInsights({ rank, totals }, percentile, trendPayload.trendPoints ?? []);
    const provenance = buildProfileProvenance({
      totalsCapturedAt,
      trendPayload,
      heatmapPayload,
      hasRotatingInsights: rotatingInsights.length > 0,
    });

    return {
      rank,
      handle,
      scannedRepos: toNumber(row.scanned_repos),
      featuredRepo: row.featured_repo ?? undefined,
      aiReadyScore: row.ai_ready_score === null ? undefined : toNumber(row.ai_ready_score),
      scanInsight,
      percentile,
      stackTier: inferOperatingStackTier({
        commitsPerDay: toNumber(row.total_commits_per_day),
        offHoursRatio: toNumber(row.total_off_hours_ratio),
        activeCodingHours: toNumber(row.total_active_coding_hours),
      }),
      attribution: parseAttributionFromRow(row),
      provenance,
      crowns: crownsByHandle.get(normalizedHandle) ?? [],
      thirtyDay: {
        equivalentEngineeringHours: round2(toNumber(row.t30_equivalent_engineering_hours)),
        mergedPrs: Math.round(toNumber(row.t30_merged_prs)),
        commitsPerDay: round2(toNumber(row.t30_commits_per_day)),
        activeCodingHours: round2(toNumber(row.t30_active_coding_hours)),
      },
      profile: {
        globalRank: rank,
        trendPoints: trendPayload.trendPoints,
        throughputHeatmap: heatmapPayload.throughputHeatmap,
        rotatingInsights,
      },
      totals,
      repos: repoCardsByUserId.get(row.user_id) ?? [],
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    sourceSeedPath: 'd1://leaderboard_rows',
    entries,
  };
}

interface ProfileRow extends LeaderboardSqlRow {
  total_rows: number;
}

export async function getProfileByHandle(db: D1Database, handle: string): Promise<ProfileResponse | null> {
  const normalizedHandle = normalizeHandle(handle);
  const row = await db
    .prepare(
      `SELECT
        lr.user_id,
        u.handle,
        lr.rank,
        lr.updated_at AS leaderboard_updated_at,
        lr.scanned_repos,
        lr.featured_repo,
        lr.ai_ready_score,
        lr.scan_insight,
        lr.total_equivalent_engineering_hours,
        lr.total_merged_prs_unverified,
        lr.total_merged_prs_ci_verified,
        lr.total_merged_prs,
        lr.total_commits_per_day,
        lr.total_active_coding_hours,
        lr.total_off_hours_ratio,
        lr.total_velocity_acceleration,
        lr.attribution_mode,
        lr.attribution_source,
        lr.attribution_target_handle,
        lr.attribution_strict,
        COALESCE(t30.equivalent_engineering_hours, 0) AS t30_equivalent_engineering_hours,
        COALESCE(t30.merged_prs, 0) AS t30_merged_prs,
        COALESCE(t30.commits_per_day, 0) AS t30_commits_per_day,
        COALESCE(t30.active_coding_hours, 0) AS t30_active_coding_hours,
        (SELECT COUNT(*) FROM leaderboard_rows) AS total_rows
      FROM users u
      INNER JOIN leaderboard_rows lr ON lr.user_id = u.id
      LEFT JOIN (
        SELECT
          latest.user_id,
          SUM(latest.equivalent_engineering_hours) AS equivalent_engineering_hours,
          SUM(latest.merged_prs) AS merged_prs,
          AVG(latest.commits_per_day) AS commits_per_day,
          AVG(latest.active_coding_hours) AS active_coding_hours
        FROM (
          SELECT
            s.user_id,
            s.repo_id,
            s.equivalent_engineering_hours,
            s.merged_prs,
            s.commits_per_day,
            s.active_coding_hours,
            ROW_NUMBER() OVER (
              PARTITION BY s.user_id, s.repo_id
              ORDER BY datetime(s.scanned_at) DESC, s.id DESC
            ) AS repo_rank
          FROM snapshots s
          WHERE s.snapshot_type = 'scan'
            AND s.repo_id IS NOT NULL
            AND datetime(s.scanned_at) >= datetime('now', '-30 day')
        ) latest
        WHERE latest.repo_rank = 1
        GROUP BY latest.user_id
      ) t30 ON t30.user_id = u.id
      WHERE lower(u.handle) = ?
      LIMIT 1`,
    )
    .bind(normalizedHandle)
    .first<ProfileRow>();

  if (!row) {
    return null;
  }

  const crownsResult = await db
    .prepare('SELECT crown_key, label, awarded_at FROM crowns WHERE user_id = ? ORDER BY awarded_at DESC')
    .bind(row.user_id)
    .all<{ crown_key: string; label: string; awarded_at: string }>();

  const historyResult = await db
    .prepare(
      `SELECT captured_at, rank, percentile, stack_tier, equivalent_engineering_hours, merged_prs, commits_per_day, active_coding_hours
      FROM profile_metrics_history
      WHERE user_id = ?
      ORDER BY captured_at DESC
      LIMIT 30`,
    )
    .bind(row.user_id)
    .all<{
      captured_at: string;
      rank: number;
      percentile: number;
      stack_tier: number;
      equivalent_engineering_hours: number;
      merged_prs: number;
      commits_per_day: number;
      active_coding_hours: number;
    }>();

  const [heatmapPayloadByUserId, repoCardsByUserId] = await Promise.all([
    loadHeatmapPayloadByUserId(db, [row.user_id]),
    loadLatestRepoCardsByUserId(db, [row.user_id], 5),
  ]);
  const heatmapPayload = heatmapPayloadByUserId.get(row.user_id) ?? { reason: 'no-scan-history' };

  const totalRows = Math.max(1, toNumber(row.total_rows, 1));
  const rank = Math.min(Math.max(1, Math.round(toNumber(row.rank, 1))), totalRows);
  const totalEeh = toNumber(row.total_equivalent_engineering_hours);
  const percentile = computePercentile(rank, totalRows);
  const stackTier = inferOperatingStackTier({
    commitsPerDay: toNumber(row.total_commits_per_day),
    offHoursRatio: toNumber(row.total_off_hours_ratio),
    activeCodingHours: toNumber(row.total_active_coding_hours),
  });

  const crowns: ProfileCrown[] = (crownsResult.results ?? []).map((crownRow) => ({
    key: crownRow.crown_key,
    label: crownRow.label,
    awardedAt: crownRow.awarded_at,
  }));

  const history: ProfileMetricsHistoryPoint[] = (historyResult.results ?? []).map((historyRow) => ({
    capturedAt: historyRow.captured_at,
    rank: toNumber(historyRow.rank),
    percentile: round2(toNumber(historyRow.percentile)),
    stackTier: inferOperatingStackTier({
      commitsPerDay: toNumber(historyRow.commits_per_day),
      offHoursRatio: 0,
      activeCodingHours: toNumber(historyRow.active_coding_hours),
    }),
    equivalentEngineeringHours: round2(toNumber(historyRow.equivalent_engineering_hours)),
    mergedPrs: Math.round(toNumber(historyRow.merged_prs)),
    commitsPerDay: round2(toNumber(historyRow.commits_per_day)),
    activeCodingHours: round2(toNumber(historyRow.active_coding_hours)),
  }));

  const trendPoints = buildTrendPointsFromHistory(history);
  const trendPayload: TrendPayload =
    trendPoints.length >= 2
      ? {
          trendPoints,
          capturedAt: history[0]?.capturedAt,
        }
      : {
          capturedAt: history[0]?.capturedAt,
          reason: history.length === 0 ? 'no-profile-history' : 'insufficient-history-points',
        };

  const totals = {
    equivalentEngineeringHours: round2(totalEeh),
    mergedPrsUnverified: Math.round(toNumber(row.total_merged_prs_unverified)),
    mergedPrsCiVerified: Math.round(toNumber(row.total_merged_prs_ci_verified)),
    mergedPrs: Math.round(toNumber(row.total_merged_prs)),
    commitsPerDay: round2(toNumber(row.total_commits_per_day)),
    activeCodingHours: round2(toNumber(row.total_active_coding_hours)),
    offHoursRatio: round2(toNumber(row.total_off_hours_ratio)),
    velocityAcceleration: round2(toNumber(row.total_velocity_acceleration)),
  };
  const scanInsight = normalizeScanInsight(row.scan_insight, {
    mergedPrsUnverified: totals.mergedPrsUnverified,
    mergedPrsCiVerified: totals.mergedPrsCiVerified,
    offHoursRatio: totals.offHoursRatio,
    velocityAcceleration: totals.velocityAcceleration,
    commitsPerDay: totals.commitsPerDay,
  });
  const rotatingInsights = buildRotatingInsights({ rank, totals }, percentile, trendPayload.trendPoints ?? []);
  const totalsCapturedAt = isIsoTimestamp(row.leaderboard_updated_at) ? row.leaderboard_updated_at : undefined;
  const provenance = buildProfileProvenance({
    totalsCapturedAt,
    trendPayload,
    heatmapPayload,
    hasRotatingInsights: rotatingInsights.length > 0,
  });

  const leaderboard: LeaderboardEntry = {
    rank,
    handle: toStringValue(row.handle),
    scannedRepos: toNumber(row.scanned_repos),
    featuredRepo: row.featured_repo ?? undefined,
    aiReadyScore: row.ai_ready_score === null ? undefined : toNumber(row.ai_ready_score),
    scanInsight,
    percentile,
    stackTier,
    attribution: parseAttributionFromRow(row),
    provenance,
    crowns: crowns.map((crown) => crown.key),
    thirtyDay: {
      equivalentEngineeringHours: round2(toNumber(row.t30_equivalent_engineering_hours)),
      mergedPrs: Math.round(toNumber(row.t30_merged_prs)),
      commitsPerDay: round2(toNumber(row.t30_commits_per_day)),
      activeCodingHours: round2(toNumber(row.t30_active_coding_hours)),
    },
    profile: {
      globalRank: rank,
      trendPoints: trendPayload.trendPoints,
      throughputHeatmap: heatmapPayload.throughputHeatmap,
      rotatingInsights,
    },
    totals,
    repos: repoCardsByUserId.get(row.user_id) ?? [],
  };

  return {
    handle: toStringValue(row.handle),
    stackTier,
    crowns,
    leaderboard,
    history,
  };
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function buildBadgeSvg(profile: ProfileResponse): string {
  const width = 420;
  const height = 120;
  const handle = `@${profile.handle}`;
  const percentile = `${round2(profile.leaderboard.percentile ?? 0)}th pct`;
  const tier = stackTierLabel(profile.stackTier);
  const eeh = `${round2(profile.leaderboard.totals.equivalentEngineeringHours)} EEH`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Velocity badge for ${escapeXml(handle)}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1220"/>
      <stop offset="100%" stop-color="#1f3b66"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)" rx="14"/>
  <text x="20" y="34" font-family="ui-monospace, Menlo, Consolas" font-size="16" fill="#8fd3ff">Mentat Velocity</text>
  <text x="20" y="64" font-family="ui-sans-serif, system-ui" font-size="22" font-weight="700" fill="#ffffff">${escapeXml(handle)}</text>
  <text x="20" y="92" font-family="ui-monospace, Menlo, Consolas" font-size="14" fill="#d7e9ff">${escapeXml(tier)} • ${escapeXml(percentile)} • ${escapeXml(eeh)}</text>
  <text x="400" y="104" text-anchor="end" font-family="ui-monospace, Menlo, Consolas" font-size="12" fill="#9abce0">crowns ${profile.crowns.length}</text>
</svg>`;
}

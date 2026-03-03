export interface ScanRequest {
  repoUrl: string;
}

export interface ScanWindowSummary {
  label: 'current30d' | 'previous30d';
  commitCount: number;
  mergedPrCountUnverified: number;
  mergedPrCountCiVerified: number;
  mergedPrCount: number;
  activeCodingHours: number;
  offHoursRatio: number;
  equivalentEngineeringHours: number;
  throughputHeatmap?: number[][];
}

export interface VelocityMetrics {
  commitsPerDay: number;
  mergedPrsUnverified: number;
  mergedPrsCiVerified: number;
  mergedPrs: number;
  activeCodingHours: number;
  offHoursRatio: number;
  velocityAcceleration: number;
  equivalentEngineeringHours: number;
}

export interface RepoReportCard {
  repo: {
    owner: string;
    name: string;
    url: string;
  };
  scannedAt: string;
  attribution: AttributionTransparency;
  assumptions: {
    offHoursDefinitionUtc: string;
    equivalentEngineeringHoursFormula: string;
    defaultBranchScope: string;
    ciVerification: string;
  };
  metadata?: {
    repoIdentity: {
      requestedOwner: string;
      requestedRepo: string;
      canonicalOwner: string;
      canonicalRepo: string;
      canonicalUrl: string;
      canonicalOwnerResolved: boolean;
    };
    commitIngestion: {
      current30d: {
        pagesFetched: number;
        maxPages: number;
        truncated: boolean;
        coverage: 'window-complete' | 'window-truncated';
        confidence: 'high' | 'medium';
      };
      previous30d: {
        pagesFetched: number;
        maxPages: number;
        truncated: boolean;
        coverage: 'window-complete' | 'window-truncated';
        confidence: 'high' | 'medium';
      };
    };
    mergedPrIngestion: {
      current30d: {
        pagesFetched: number;
        maxPages: number;
        truncated: boolean;
      };
      previous30d: {
        pagesFetched: number;
        maxPages: number;
        truncated: boolean;
      };
    };
    ciVerification: {
      current30d: {
        evaluatedPrs: number;
        totalMergedPrs: number;
        coverageRatio: number;
        cap: number;
        capped: boolean;
        confidence: 'high' | 'medium' | 'low';
      };
      previous30d: {
        evaluatedPrs: number;
        totalMergedPrs: number;
        coverageRatio: number;
        cap: number;
        capped: boolean;
        confidence: 'high' | 'medium' | 'low';
      };
    };
  };
  persistence?: {
    canonicalLeaderboardWrite: boolean;
    rankingEligible: boolean;
    reason:
      | 'db-unavailable'
      | 'unauthenticated'
      | 'owner-mismatch'
      | 'owner-unresolved'
      | 'non-canonical-attribution'
      | 'persisted';
    ownerHandle: string;
    requestedOwnerHandle?: string;
    actorHandle?: string;
    attributionMode: AttributionMode;
    attributionStrict: boolean;
    canonicalOwnerResolved: boolean;
  };
  metrics: VelocityMetrics;
  windows: ScanWindowSummary[];
}

export interface SeedCreator {
  handle: string;
  featuredRepos?: string[];
}

export type AttributionMode = 'repo-wide' | 'handle-authored';
export type AttributionPolicy = 'strict-login-match-only' | 'repo-wide-non-bot-default-branch';
export type AttributionConfidence = 'high' | 'contextual';
export type AttributionAmbiguity = 'low' | 'elevated';

export interface AttributionTransparency {
  mode: AttributionMode;
  source: 'github-author-login-match';
  targetHandle?: string;
  strict: boolean;
  productionReady: boolean;
  notes: string;
  policy?: AttributionPolicy;
  confidence?: AttributionConfidence;
  ambiguity?: AttributionAmbiguity;
  repoWideImplications?: string;
  fallbackReason?: string;
}

export type OperatingStackTier = 0 | 1 | 2 | 3;

export interface LeaderboardThirtyDayMetrics {
  equivalentEngineeringHours: number;
  mergedPrs: number;
  commitsPerDay: number;
  activeCodingHours: number;
}

export interface MetricBlockProvenance {
  state: 'authoritative' | 'unavailable';
  source: string;
  capturedAt?: string;
  reason?: string;
}

export interface LeaderboardEntryProvenance {
  totals: MetricBlockProvenance;
  thirtyDay: MetricBlockProvenance;
  profile: {
    trendPoints: MetricBlockProvenance;
    throughputHeatmap: MetricBlockProvenance;
    rotatingInsights: MetricBlockProvenance;
  };
}

export type TrustAnomalySeverity = 'low' | 'medium' | 'high';

export type TrustAnomalyKey = 'ci-coverage-low' | 'off-hours-dominant' | 'commit-throughput-outlier';

export interface TrustAnomalyFlag {
  key: TrustAnomalyKey;
  label: string;
  severity: TrustAnomalySeverity;
  reason: string;
}

export type VerifiedAgentOutputState = 'verified' | 'pending' | 'unknown';

export type VerifiedAgentOutputReasonCode =
  | 'eligible'
  | 'readiness-missing'
  | 'readiness-below-threshold'
  | 'ci-coverage-unavailable'
  | 'ci-coverage-below-threshold'
  | 'freshness-stale';

export interface VerifiedAgentOutputStatus {
  state: VerifiedAgentOutputState;
  label: string;
  reason: string;
  reasonCodes?: VerifiedAgentOutputReasonCode[];
  readinessScore?: number;
  readinessThreshold?: number;
  ciCoverageRatio?: number;
  ciCoverageThreshold?: number;
  threshold?: number;
}

export interface LeaderboardEntryTrustSignals {
  anomalies: TrustAnomalyFlag[];
  verification: VerifiedAgentOutputStatus;
}

export type PayloadFreshnessStaleReasonCode =
  | 'missing-snapshot-timestamp'
  | 'snapshot-too-old'
  | 'cache-version-fallback';

export interface PayloadFreshness {
  schemaVersion?: string;
  source: 'server' | 'static-fallback';
  cacheVersion: string;
  latestSuccessfulRefreshRunId: number;
  latestSnapshotId: number;
  latestSuccessfulRefreshGeneratedAt?: string;
  latestSuccessfulRefreshFinishedAt?: string;
  latestSnapshotScannedAt?: string;
  isStale?: boolean;
  staleReasons?: PayloadFreshnessStaleReasonCode[];
  computedAt?: string;
  note?: string;
}

export interface LeaderboardEntry {
  rank: number;
  handle: string;
  scannedRepos: number;
  featuredRepo?: string;
  aiReadyScore?: number;
  scanInsight?: string;
  percentile?: number;
  stackTier?: OperatingStackTier;
  crowns?: string[];
  attribution?: AttributionTransparency;
  provenance?: LeaderboardEntryProvenance;
  trust?: LeaderboardEntryTrustSignals;
  thirtyDay?: LeaderboardThirtyDayMetrics;
  profile?: {
    tier?: string;
    percentile?: number;
    globalRank?: number;
    crowns?: string[];
    trendPoints?: number[];
    throughputHeatmap?: number[][];
    rotatingInsights?: string[];
  };
  totals: {
    equivalentEngineeringHours: number;
    mergedPrsUnverified: number;
    mergedPrsCiVerified: number;
    mergedPrs: number;
    commitsPerDay: number;
    activeCodingHours: number;
    offHoursRatio: number;
    velocityAcceleration: number;
  };
  repos: RepoReportCard[];
}

export interface LeaderboardArtifact {
  generatedAt: string;
  sourceSeedPath: string;
  freshness?: PayloadFreshness;
  dataSource?: {
    kind: 'd1' | 'static-artifact';
    fallback: boolean;
    healthy: boolean;
    reason?: string;
    message?: string;
  };
  attributionPolicy?: {
    seededLeaderboardDefaultMode: 'handle-authored';
    seededLeaderboardStrict: true;
    seededLeaderboardPolicy: AttributionPolicy;
    manualScanDefaultMode: 'repo-wide';
    manualScanFallbackPolicy: AttributionPolicy;
    notes: string;
  };
  entries: LeaderboardEntry[];
}

export interface ProfileMetricsHistoryPoint {
  capturedAt: string;
  rank: number;
  percentile: number;
  stackTier: OperatingStackTier;
  equivalentEngineeringHours: number;
  mergedPrs: number;
  commitsPerDay: number;
  activeCodingHours: number;
}

export interface ProfileCrown {
  key: string;
  label: string;
  awardedAt: string;
}

export type RivalryProgressionSource = 'server' | 'history-derived';
export type RivalryProgressionTrend = 'closing' | 'widening' | 'stable';

export interface ProfileRivalryProgression {
  rivalHandle: string;
  source: RivalryProgressionSource;
  capturedAt: string;
  trend: RivalryProgressionTrend;
  rankDelta: number;
  equivalentEngineeringHoursDelta: number;
  currentGapEquivalentEngineeringHours: number;
  currentGapRank: number;
}

export interface ProfileResponse {
  handle: string;
  stackTier: OperatingStackTier;
  crowns: ProfileCrown[];
  leaderboard: LeaderboardEntry;
  history: ProfileMetricsHistoryPoint[];
  rivalry?: ProfileRivalryProgression;
  freshness?: PayloadFreshness;
}

export interface GitHubCommit {
  sha: string;
  parents: { sha: string }[];
  commit: {
    author: {
      name: string;
      date: string;
    };
    committer: {
      name: string;
      date: string;
    };
  };
  author: {
    login: string;
    type: string;
  } | null;
}

export interface GitHubPullRequest {
  id: number;
  user: {
    login: string;
    type: string;
  } | null;
  merged_at: string | null;
  updated_at?: string;
  base: {
    ref: string;
  };
  html_url: string;
  merge_commit_sha?: string | null;
}

export interface GitHubRepo {
  full_name: string;
  html_url: string;
  fork: boolean;
  pushed_at: string;
  default_branch?: string;
}

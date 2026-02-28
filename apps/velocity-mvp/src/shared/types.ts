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

export interface ProfileResponse {
  handle: string;
  stackTier: OperatingStackTier;
  crowns: ProfileCrown[];
  leaderboard: LeaderboardEntry;
  history: ProfileMetricsHistoryPoint[];
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

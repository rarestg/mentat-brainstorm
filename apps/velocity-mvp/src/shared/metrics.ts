import type { GitHubCommit, GitHubPullRequest, ScanWindowSummary, VelocityMetrics } from './types';

interface WindowInput {
  commits: GitHubCommit[];
  mergedPrs: GitHubPullRequest[];
  ciVerifiedMergedPrs?: GitHubPullRequest[];
  now: Date;
  start: Date;
  end: Date;
  label: 'current30d' | 'previous30d';
}

const HOURS_PER_DAY_CAP = 12;
const HEATMAP_DAYS = 7;
const HEATMAP_HOURS = 24;

function toHourBucket(date: Date): string {
  const d = new Date(date);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function toDayBucket(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round(value: number, decimals = 2): number {
  const base = 10 ** decimals;
  return Math.round(value * base) / base;
}

function createEmptyHeatmapCounts(): number[][] {
  return Array.from({ length: HEATMAP_DAYS }, () => Array.from({ length: HEATMAP_HOURS }, () => 0));
}

export function computeWindowSummary(input: WindowInput): ScanWindowSummary {
  const hourBuckets = new Set<string>();
  const offHourBuckets = new Set<string>();
  const dailyCommitCounts = new Map<string, number>();
  const dailyHours = new Map<string, Set<string>>();
  const dailyMergedPrs = new Map<string, number>();
  const throughputHeatmap = createEmptyHeatmapCounts();

  for (const commit of input.commits) {
    const commitDate = new Date(commit.commit.author.date);
    if (!Number.isFinite(commitDate.getTime())) {
      continue;
    }

    const hourBucket = toHourBucket(commitDate);
    const dayBucket = toDayBucket(commitDate);
    hourBuckets.add(hourBucket);

    const dayOfWeek = commitDate.getUTCDay();
    const hourOfDay = commitDate.getUTCHours();
    const existing = throughputHeatmap[dayOfWeek]?.[hourOfDay] ?? 0;
    throughputHeatmap[dayOfWeek][hourOfDay] = existing + 1;

    if (hourOfDay < 9 || hourOfDay >= 18) {
      offHourBuckets.add(hourBucket);
    }

    dailyCommitCounts.set(dayBucket, (dailyCommitCounts.get(dayBucket) ?? 0) + 1);
    if (!dailyHours.has(dayBucket)) {
      dailyHours.set(dayBucket, new Set<string>());
    }
    dailyHours.get(dayBucket)?.add(hourBucket);
  }

  const mergedPrsForEeh = input.ciVerifiedMergedPrs ?? input.mergedPrs;

  for (const pr of mergedPrsForEeh) {
    if (!pr.merged_at) {
      continue;
    }
    const mergedAt = new Date(pr.merged_at);
    if (!Number.isFinite(mergedAt.getTime())) {
      continue;
    }
    const dayBucket = toDayBucket(mergedAt);
    dailyMergedPrs.set(dayBucket, (dailyMergedPrs.get(dayBucket) ?? 0) + 1);
  }

  // Equivalent Engineering Hours heuristic (MVP proxy metric):
  // eeh_day = min(12, 0.8 * uniqueActiveHours + 0.3 * min(commitCount, 2*hours+1) + 1.5 * min(mergedPrCount, 3))
  // eeh_30d = sum(eeh_day over 30 UTC days)
  let equivalentEngineeringHours = 0;
  const dayMs = 24 * 60 * 60 * 1000;
  for (let cursor = input.start.getTime(); cursor < input.end.getTime(); cursor += dayMs) {
    const day = new Date(cursor).toISOString().slice(0, 10);
    const uniqueHours = dailyHours.get(day)?.size ?? 0;
    const commits = dailyCommitCounts.get(day) ?? 0;
    const mergedPrs = dailyMergedPrs.get(day) ?? 0;
    const boundedCommits = Math.min(commits, 2 * uniqueHours + 1);
    const boundedPrs = Math.min(mergedPrs, 3);
    const eehDay = Math.min(HOURS_PER_DAY_CAP, 0.8 * uniqueHours + 0.3 * boundedCommits + 1.5 * boundedPrs);
    equivalentEngineeringHours += eehDay;
  }

  return {
    label: input.label,
    commitCount: input.commits.length,
    mergedPrCountUnverified: input.mergedPrs.length,
    mergedPrCountCiVerified: mergedPrsForEeh.length,
    mergedPrCount: mergedPrsForEeh.length,
    activeCodingHours: hourBuckets.size,
    offHoursRatio: hourBuckets.size === 0 ? 0 : round(offHourBuckets.size / hourBuckets.size),
    equivalentEngineeringHours: round(equivalentEngineeringHours),
    throughputHeatmap,
  };
}

export function buildMetrics(current: ScanWindowSummary, previous: ScanWindowSummary): VelocityMetrics {
  const currentPerDay = current.commitCount / 30;
  const previousEehPerDay = previous.equivalentEngineeringHours / 30;
  const currentEehPerDay = current.equivalentEngineeringHours / 30;

  const acceleration =
    previousEehPerDay === 0
      ? currentEehPerDay === 0
        ? 0
        : 1
      : (currentEehPerDay - previousEehPerDay) / previousEehPerDay;

  return {
    commitsPerDay: round(currentPerDay),
    mergedPrsUnverified: current.mergedPrCountUnverified,
    mergedPrsCiVerified: current.mergedPrCountCiVerified,
    mergedPrs: current.mergedPrCount,
    activeCodingHours: current.activeCodingHours,
    offHoursRatio: current.offHoursRatio,
    velocityAcceleration: round(acceleration),
    equivalentEngineeringHours: current.equivalentEngineeringHours,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchAuthIdentity, fetchLeaderboard, fetchProfile, logoutAuthSession, scanRepository } from './api';
import type { AuthIdentity } from './api';
import type { LeaderboardArtifact, LeaderboardEntry, ProfileResponse, RepoReportCard } from '../shared/types';

type View = 'leaderboard' | 'scan';

type Route =
  | { kind: 'home' }
  | { kind: 'profile'; handle: string };

type TelemetryValue = string | number | boolean | null;

interface ProfileVisitSnapshot {
  capturedAt: string;
  rank: number;
  percentile: number;
  equivalentEngineeringHours: number;
  mergedPrsCiVerified: number;
  weeklyStreak: number;
}

const TREND_CHART_WIDTH = 440;
const TREND_CHART_HEIGHT = 144;
const TREND_CHART_PADDING = 14;
const UX_EVENT_STORAGE_KEY = 'mentat.velocity.ux.events';
const PROFILE_VISIT_STORAGE_KEY_PREFIX = 'mentat.velocity.profile.lastVisit.';

function formatPercent(v: number): string {
  return `${(v * 100).toFixed(0)}%`;
}

function formatAcceleration(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(0)}%`;
}

function formatNumber(v: number, maxFractionDigits = 2): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: maxFractionDigits });
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizeTelemetryValue(value: unknown): TelemetryValue {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

function trackUxEvent(event: string, payload: Record<string, unknown> = {}): void {
  const detail = {
    event,
    at: new Date().toISOString(),
    payload: Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, sanitizeTelemetryValue(value)])),
  };

  const globalScope = window as Window & {
    dataLayer?: unknown[];
    __MENTAT_VELOCITY_EVENTS__?: unknown[];
  };

  if (Array.isArray(globalScope.dataLayer)) {
    globalScope.dataLayer.push({
      event: `mentat_velocity_${event}`,
      ...detail.payload,
    });
  }

  if (!Array.isArray(globalScope.__MENTAT_VELOCITY_EVENTS__)) {
    globalScope.__MENTAT_VELOCITY_EVENTS__ = [];
  }
  globalScope.__MENTAT_VELOCITY_EVENTS__.push(detail);

  try {
    const existingRaw = window.localStorage.getItem(UX_EVENT_STORAGE_KEY);
    const existing = existingRaw ? (JSON.parse(existingRaw) as unknown) : [];
    const normalized = Array.isArray(existing) ? existing.slice(-119) : [];
    normalized.push(detail);
    window.localStorage.setItem(UX_EVENT_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Storage failures should not interrupt user actions.
  }

  window.dispatchEvent(new CustomEvent('mentat:velocity:ux-event', { detail }));
}

function toProfileVisitStorageKey(handle: string): string {
  return `${PROFILE_VISIT_STORAGE_KEY_PREFIX}${handle.toLowerCase()}`;
}

function getStoredProfileVisit(handle: string): ProfileVisitSnapshot | null {
  try {
    const raw = window.localStorage.getItem(toProfileVisitStorageKey(handle));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<ProfileVisitSnapshot>;
    if (
      typeof parsed.capturedAt !== 'string' ||
      typeof parsed.rank !== 'number' ||
      typeof parsed.percentile !== 'number' ||
      typeof parsed.equivalentEngineeringHours !== 'number' ||
      typeof parsed.mergedPrsCiVerified !== 'number' ||
      typeof parsed.weeklyStreak !== 'number'
    ) {
      return null;
    }
    return parsed as ProfileVisitSnapshot;
  } catch {
    return null;
  }
}

function setStoredProfileVisit(handle: string, snapshot: ProfileVisitSnapshot): void {
  try {
    window.localStorage.setItem(toProfileVisitStorageKey(handle), JSON.stringify(snapshot));
  } catch {
    // Storage failures should not block profile rendering.
  }
}

function daysBetweenTimestamps(fromIso: string, toIso: string): number | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return null;
  }
  return Math.floor(Math.abs(to - from) / (1000 * 60 * 60 * 24));
}

function computeWeeklyStreak(previous: ProfileVisitSnapshot | null, nowIso: string): number {
  if (!previous) {
    return 1;
  }
  const daysSince = daysBetweenTimestamps(previous.capturedAt, nowIso);
  if (daysSince === null) {
    return 1;
  }
  if (daysSince >= 5 && daysSince <= 9) {
    return previous.weeklyStreak + 1;
  }
  if (daysSince < 5) {
    return previous.weeklyStreak;
  }
  return 1;
}

function buildProfileUrl(origin: string, handle: string): string {
  return `${origin}/v/${encodeURIComponent(handle.toLowerCase())}`;
}

function buildChallengeLink(origin: string, challengerHandle: string, targetHandle: string): string {
  return `${buildProfileUrl(origin, challengerHandle)}?challenge=${encodeURIComponent(targetHandle.toLowerCase())}`;
}

function buildTweetIntentUrl(text: string, url: string): string {
  const params = new URLSearchParams({ text, url });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

function buildInviteIntentUrl(origin: string): string {
  return buildTweetIntentUrl('Track AI-verified throughput and challenge me on Mentat Velocity.', `${origin}/`);
}

function formatSignedDelta(value: number, maxFractionDigits = 1): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatNumber(value, maxFractionDigits)}`;
}

function formatRankDelta(previousRank: number, currentRank: number): string {
  const movement = previousRank - currentRank;
  if (movement > 0) {
    return `+${movement}`;
  }
  if (movement < 0) {
    return `${movement}`;
  }
  return '0';
}

function parseRoute(pathname: string): Route {
  const profileMatch = pathname.match(/^\/v\/([A-Za-z0-9_.-]+)\/?$/);
  if (profileMatch) {
    return { kind: 'profile', handle: profileMatch[1].toLowerCase() };
  }
  return { kind: 'home' };
}

function routeToPath(route: Route): string {
  if (route.kind === 'profile') {
    return `/v/${route.handle}`;
  }
  return '/';
}

function getPercentile(entry: LeaderboardEntry, totalEntries: number): number {
  if (typeof entry.profile?.percentile === 'number' && Number.isFinite(entry.profile.percentile)) {
    return clamp(entry.profile.percentile, 0, 1);
  }
  if (totalEntries <= 0) {
    return 0;
  }
  return clamp((totalEntries - entry.rank + 1) / totalEntries, 0, 1);
}

function getTier(entry: LeaderboardEntry, percentile: number): string {
  if (typeof entry.stackTier === 'number') {
    return `Operating Stack Tier ${entry.stackTier}`;
  }
  if (entry.profile?.tier) {
    return entry.profile.tier;
  }
  if (percentile >= 0.98) {
    return 'Mythic';
  }
  if (percentile >= 0.9) {
    return 'Titan';
  }
  if (percentile >= 0.75) {
    return 'Accelerator';
  }
  if (percentile >= 0.5) {
    return 'Builder';
  }
  return 'Contender';
}

function buildTrendPoints(entry: LeaderboardEntry): number[] {
  const profileTrend = entry.profile?.trendPoints;
  if (Array.isArray(profileTrend) && profileTrend.length >= 2) {
    return profileTrend.map((value) => Math.max(0, value));
  }
  return [];
}

function buildTrendPointsFromHistory(profile: ProfileResponse): number[] {
  if (profile.history.length < 2) {
    return [];
  }
  return [...profile.history]
    .reverse()
    .slice(-10)
    .map((point) => Math.max(0, point.equivalentEngineeringHours));
}

function isValidHeatmapMatrix(matrix: unknown): matrix is number[][] {
  return (
    Array.isArray(matrix) &&
    matrix.length > 0 &&
    matrix.every((row) => Array.isArray(row) && row.length > 0 && row.every((value) => typeof value === 'number' && Number.isFinite(value)))
  );
}

function buildThroughputHeatmap(entry: LeaderboardEntry): number[][] {
  const existing = entry.profile?.throughputHeatmap;
  if (isValidHeatmapMatrix(existing)) {
    return existing.map((row) => row.map((value) => clamp(Math.round(value), 0, 4)));
  }
  return [];
}

function deriveCrowns(entry: LeaderboardEntry): string[] {
  if (Array.isArray(entry.profile?.crowns) && entry.profile.crowns.length > 0) {
    return entry.profile.crowns;
  }

  const crowns: string[] = [];
  if (entry.rank === 1) {
    crowns.push('Velocity Monarch');
  }
  if (entry.totals.velocityAcceleration > 0) {
    crowns.push('Momentum Crown');
  }
  if (entry.totals.mergedPrsCiVerified >= 5) {
    crowns.push('CI Reliabilist');
  }
  if (entry.totals.offHoursRatio <= 0.2) {
    crowns.push('Daylight Operator');
  }
  if (crowns.length === 0) {
    crowns.push('Factory Floor Active');
  }
  return crowns;
}

function resolveInsightFeed(entry: LeaderboardEntry): string[] {
  if (entry.profile?.rotatingInsights?.length) {
    return entry.profile.rotatingInsights;
  }
  return [];
}

function buildTrendPath(points: number[]): { path: string; fillPath: string } {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const drawableWidth = TREND_CHART_WIDTH - TREND_CHART_PADDING * 2;
  const drawableHeight = TREND_CHART_HEIGHT - TREND_CHART_PADDING * 2;

  const coords = points.map((point, index) => {
    const x = TREND_CHART_PADDING + (index / Math.max(points.length - 1, 1)) * drawableWidth;
    const normalized = max === min ? 0.5 : (point - min) / (max - min);
    const y = TREND_CHART_HEIGHT - TREND_CHART_PADDING - normalized * drawableHeight;
    return { x, y };
  });

  const path = coords
    .map((coord, index) => `${index === 0 ? 'M' : 'L'} ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`)
    .join(' ');
  const fillPath = `${path} L ${(TREND_CHART_WIDTH - TREND_CHART_PADDING).toFixed(1)} ${(TREND_CHART_HEIGHT - TREND_CHART_PADDING).toFixed(1)} L ${TREND_CHART_PADDING.toFixed(1)} ${(TREND_CHART_HEIGHT - TREND_CHART_PADDING).toFixed(1)} Z`;

  return { path, fillPath };
}

function sortByRank(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort((a, b) => a.rank - b.rank);
}

function findNearestRival(entry: LeaderboardEntry, entries: LeaderboardEntry[]): LeaderboardEntry | null {
  if (entries.length <= 1) {
    return null;
  }
  const higher = entries.find((candidate) => candidate.rank === entry.rank - 1);
  if (higher) {
    return higher;
  }
  const lower = entries.find((candidate) => candidate.rank === entry.rank + 1);
  return lower ?? null;
}

export function App() {
  const [view, setView] = useState<View>('leaderboard');
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [leaderboard, setLeaderboard] = useState<LeaderboardArtifact | null>(null);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [profileData, setProfileData] = useState<ProfileResponse | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [repoInput, setRepoInput] = useState('https://github.com/honojs/hono');
  const [scanResult, setScanResult] = useState<RepoReportCard | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanCompareHandle, setScanCompareHandle] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [insightIndex, setInsightIndex] = useState(0);
  const [lastProfileVisit, setLastProfileVisit] = useState<ProfileVisitSnapshot | null>(null);
  const [profileWeeklyStreak, setProfileWeeklyStreak] = useState(1);
  const [authIdentity, setAuthIdentity] = useState<AuthIdentity | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const profileVisitSignatureRef = useRef<string>('');

  const loadAuthState = useCallback(async () => {
    setIsAuthLoading(true);
    try {
      const identity = await fetchAuthIdentity();
      setAuthIdentity(identity);
      setAuthError(null);
    } catch (error) {
      setAuthIdentity(null);
      setAuthError((error as Error).message);
    } finally {
      setIsAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAuthState();
  }, [loadAuthState]);

  useEffect(() => {
    fetchLeaderboard()
      .then((result) => {
        setLeaderboard(result);
        setLeaderboardError(null);
      })
      .catch((error) => {
        setLeaderboardError((error as Error).message);
      });
  }, []);

  useEffect(() => {
    if (route.kind !== 'profile') {
      setProfileData(null);
      setProfileError(null);
      setIsProfileLoading(false);
      setLastProfileVisit(null);
      setProfileWeeklyStreak(1);
      return;
    }

    let cancelled = false;
    setIsProfileLoading(true);
    setProfileError(null);
    setProfileData(null);

    fetchProfile(route.handle)
      .then((profile) => {
        if (cancelled) {
          return;
        }
        setProfileData(profile);
        setProfileError(null);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setProfileData(null);
        setProfileError((error as Error).message);
      })
      .finally(() => {
        if (cancelled) {
          return;
        }
        setIsProfileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [route]);

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseRoute(window.location.pathname));
    };

    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  useEffect(() => {
    const onPageShow = () => {
      void loadAuthState();
    };

    window.addEventListener('pageshow', onPageShow);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [loadAuthState]);

  const sortedEntries = useMemo(() => sortByRank(leaderboard?.entries ?? []), [leaderboard]);

  useEffect(() => {
    if (sortedEntries.length === 0) {
      setScanCompareHandle('');
      return;
    }
    setScanCompareHandle((current) => {
      if (current.length > 0 && sortedEntries.some((entry) => entry.handle === current)) {
        return current;
      }
      return sortedEntries[0].handle;
    });
  }, [sortedEntries]);

  const profileEntry = useMemo(() => {
    if (route.kind !== 'profile') {
      return null;
    }
    if (profileData?.leaderboard) {
      return profileData.leaderboard;
    }
    return sortedEntries.find((entry) => entry.handle.toLowerCase() === route.handle) ?? null;
  }, [profileData, route, sortedEntries]);

  const kpis = useMemo(() => {
    if (!leaderboard || leaderboard.entries.length === 0) {
      return {
        creators: 0,
        repos: 0,
        avgEeh: 0,
      };
    }

    const creators = leaderboard.entries.length;
    const repos = leaderboard.entries.reduce((sum, entry) => sum + entry.scannedRepos, 0);
    const avgEeh =
      leaderboard.entries.reduce((sum, entry) => sum + entry.totals.equivalentEngineeringHours, 0) /
      creators;

    return {
      creators,
      repos,
      avgEeh: Math.round(avgEeh * 10) / 10,
    };
  }, [leaderboard]);

  const profilePercentile = useMemo(() => {
    if (!profileEntry) {
      return 0;
    }
    return getPercentile(profileEntry, sortedEntries.length);
  }, [profileEntry, sortedEntries.length]);

  const profileTier = useMemo(() => {
    if (!profileEntry) {
      return 'Contender';
    }
    return getTier(profileEntry, profilePercentile);
  }, [profileEntry, profilePercentile]);
  const profileAttributionSummary = useMemo(() => {
    if (!profileEntry?.attribution) {
      return `Attribution: profile metrics currently aggregate seeded repository activity around @${profileEntry?.handle ?? 'creator'} and may include repo-wide signal.`;
    }
    if (profileEntry.attribution.mode === 'handle-authored' && profileEntry.attribution.targetHandle) {
      return `Attribution: strict authored mode is active. Commits and merged PRs are counted only when GitHub author login matches @${profileEntry.attribution.targetHandle}.`;
    }
    return `Attribution: repo-wide mode is active for @${profileEntry.handle}. Metrics include non-bot default-branch activity and may not reflect strict per-author ownership.`;
  }, [profileEntry]);

  const trendPoints = useMemo(() => {
    if (!profileEntry) {
      return [];
    }
    if (profileData) {
      const historyPoints = buildTrendPointsFromHistory(profileData);
      if (historyPoints.length >= 2) {
        return historyPoints;
      }
    }
    return buildTrendPoints(profileEntry);
  }, [profileData, profileEntry]);
  const hasProfileTrend = trendPoints.length >= 2;
  const throughputHeatmap = useMemo(() => (profileEntry ? buildThroughputHeatmap(profileEntry) : []), [profileEntry]);
  const hasProfileHeatmap = useMemo(() => isValidHeatmapMatrix(profileEntry?.profile?.throughputHeatmap), [profileEntry]);
  const hasProfileInsights = useMemo(() => Boolean(profileEntry?.profile?.rotatingInsights?.length), [profileEntry]);
  const crowns = useMemo(() => {
    if (profileData?.crowns.length) {
      return profileData.crowns.map((crown) => crown.label);
    }
    return profileEntry ? deriveCrowns(profileEntry) : [];
  }, [profileData, profileEntry]);
  const crownsAttribution = profileData?.crowns.length
    ? 'Attribution: crowns are supplied by backend profile metadata.'
    : 'Attribution: crowns are provisional client-side derivations from leaderboard totals.';
  const insightFeed = useMemo(() => (profileEntry ? resolveInsightFeed(profileEntry) : []), [profileEntry]);
  const trendAttribution = useMemo(() => {
    if (!profileEntry) {
      return '';
    }
    if (profileData) {
      const historyPoints = buildTrendPointsFromHistory(profileData);
      if (historyPoints.length >= 2) {
        return 'Attribution: trend uses profile history snapshots captured from leaderboard artifacts.';
      }
    }
    if (Array.isArray(profileEntry.profile?.trendPoints) && profileEntry.profile.trendPoints.length >= 2) {
      return 'Attribution: trend uses precomputed points from leaderboard profile payload.';
    }
    return 'Attribution: trend data unavailable. Backend profile history points are required before this chart is shown.';
  }, [profileData, profileEntry]);
  const heatmapAttribution = hasProfileHeatmap
    ? 'Attribution: heatmap bins come from profile throughput data in leaderboard payload.'
    : 'Attribution: heatmap unavailable. Backend hourly/weekday bins are not present in this profile payload.';
  const insightAttribution = hasProfileInsights
    ? 'Attribution: insight text is supplied by backend profile metadata.'
    : 'Attribution: insight unavailable. Backend rotating insights are required for this module.';
  const profileMetricProvenance = profileEntry?.attribution?.notes
    ? `Provenance: ${profileEntry.attribution.notes}`
    : 'Provenance: totals come from leaderboard artifact defaults and can include repo-wide signal when strict authored attribution is unavailable.';
  const profileRival = useMemo(() => (profileEntry ? findNearestRival(profileEntry, sortedEntries) : null), [profileEntry, sortedEntries]);

  useEffect(() => {
    setInsightIndex(0);
  }, [route.kind, profileEntry?.handle]);

  useEffect(() => {
    if (route.kind !== 'profile' || insightFeed.length <= 1) {
      return;
    }

    const interval = window.setInterval(() => {
      setInsightIndex((current) => (current + 1) % insightFeed.length);
    }, 3500);

    return () => {
      window.clearInterval(interval);
    };
  }, [route.kind, insightFeed]);

  useEffect(() => {
    if (route.kind !== 'profile' || !profileEntry) {
      profileVisitSignatureRef.current = '';
      return;
    }

    const signature = `${profileEntry.handle}:${profileEntry.rank}:${profileEntry.totals.equivalentEngineeringHours}:${profileEntry.totals.mergedPrsCiVerified}`;
    if (profileVisitSignatureRef.current === signature) {
      return;
    }
    profileVisitSignatureRef.current = signature;

    const previousVisit = getStoredProfileVisit(profileEntry.handle);
    setLastProfileVisit(previousVisit);

    const nowIso = new Date().toISOString();
    const weeklyStreak = computeWeeklyStreak(previousVisit, nowIso);
    setProfileWeeklyStreak(weeklyStreak);

    setStoredProfileVisit(profileEntry.handle, {
      capturedAt: nowIso,
      rank: profileEntry.rank,
      percentile: profilePercentile,
      equivalentEngineeringHours: profileEntry.totals.equivalentEngineeringHours,
      mergedPrsCiVerified: profileEntry.totals.mergedPrsCiVerified,
      weeklyStreak,
    });

    trackUxEvent('profile_viewed', {
      handle: profileEntry.handle,
      rank: profileEntry.rank,
      weeklyStreak,
      hasPreviousVisit: Boolean(previousVisit),
    });
  }, [profileEntry, profilePercentile, route.kind]);

  function navigate(nextRoute: Route, options: { replace?: boolean } = {}) {
    const nextPath = routeToPath(nextRoute);
    if (nextPath !== window.location.pathname) {
      if (options.replace) {
        window.history.replaceState(null, '', nextPath);
      } else {
        window.history.pushState(null, '', nextPath);
      }
    }
    setRoute(nextRoute);
  }

  function goHome(nextView?: View) {
    if (nextView) {
      setView(nextView);
    }
    navigate({ kind: 'home' });
  }

  function openProfile(handle: string) {
    navigate({ kind: 'profile', handle: handle.toLowerCase() });
  }

  async function onSignOut() {
    setIsSigningOut(true);
    setAuthError(null);
    try {
      await logoutAuthSession();
    } catch (error) {
      setAuthError((error as Error).message);
    } finally {
      setIsSigningOut(false);
      await loadAuthState();
    }
  }

  async function onScanSubmit(event: React.FormEvent) {
    event.preventDefault();
    setIsScanning(true);
    setScanError(null);
    trackUxEvent('scan_submitted', {
      repoUrl: repoInput,
      signedIn: Boolean(authIdentity),
    });

    try {
      const result = await scanRepository(repoInput);
      setScanResult(result);
      trackUxEvent('scan_completed', {
        repo: `${result.repo.owner}/${result.repo.name}`,
        equivalentEngineeringHours: result.metrics.equivalentEngineeringHours,
        mergedPrsCiVerified: result.metrics.mergedPrs,
      });
    } catch (error) {
      setScanError((error as Error).message);
      setScanResult(null);
      trackUxEvent('scan_failed', {
        repoUrl: repoInput,
        reason: (error as Error).message,
      });
    } finally {
      setIsScanning(false);
    }
  }

  const profileTrendPath = trendPoints.length > 1 ? buildTrendPath(trendPoints) : null;
  const globalRank = profileEntry
    ? (profileData?.leaderboard?.profile?.globalRank ?? profileEntry.profile?.globalRank ?? profileEntry.rank)
    : null;
  const normalizedAuthHandle = authIdentity?.handle.toLowerCase() ?? null;
  const normalizedAuthLogin = authIdentity?.githubLogin.toLowerCase() ?? null;
  const isViewingSignedInProfile =
    route.kind === 'profile' &&
    ((normalizedAuthHandle !== null && route.handle === normalizedAuthHandle) ||
      (normalizedAuthLogin !== null && route.handle === normalizedAuthLogin));
  const appOrigin = window.location.origin;
  const currentActorHandle = authIdentity?.handle ?? profileEntry?.handle ?? 'open-challenge';
  const inviteIntentUrl = buildInviteIntentUrl(appOrigin);
  const profileShareIntentUrl = profileEntry
    ? buildTweetIntentUrl(
        `My Mentat Velocity snapshot: #${globalRank ?? profileEntry.rank}, ${formatNumber(profileEntry.totals.equivalentEngineeringHours, 1)} EEH in 30d.`,
        buildProfileUrl(appOrigin, profileEntry.handle),
      )
    : null;
  const profileChallengeIntentUrl =
    profileEntry && profileRival
      ? buildTweetIntentUrl(
          `I challenge @${profileRival.handle} on Mentat Velocity. Compare our trusted throughput.`,
          buildChallengeLink(appOrigin, currentActorHandle, profileRival.handle),
        )
      : null;
  const profileRivalEehDelta =
    profileEntry && profileRival ? profileEntry.totals.equivalentEngineeringHours - profileRival.totals.equivalentEngineeringHours : null;
  const scanComparisonEntry = useMemo(
    () => sortedEntries.find((entry) => entry.handle === scanCompareHandle) ?? null,
    [scanCompareHandle, sortedEntries],
  );
  const scanRankPreview = useMemo(() => {
    if (!scanResult || sortedEntries.length === 0) {
      return null;
    }
    const score = scanResult.metrics.equivalentEngineeringHours;
    const insertIndex = sortedEntries.findIndex((entry) => score >= entry.totals.equivalentEngineeringHours);
    const estimatedRank = insertIndex === -1 ? sortedEntries.length + 1 : insertIndex + 1;
    const estimatedPercentile = clamp((sortedEntries.length + 2 - estimatedRank) / (sortedEntries.length + 1), 0, 1);
    return {
      estimatedRank,
      estimatedPercentile,
      sampleSize: sortedEntries.length,
    };
  }, [scanResult, sortedEntries]);
  const scanComparison = useMemo(() => {
    if (!scanResult || !scanComparisonEntry) {
      return null;
    }
    return {
      eehDelta: scanResult.metrics.equivalentEngineeringHours - scanComparisonEntry.totals.equivalentEngineeringHours,
      ciPrDelta: scanResult.metrics.mergedPrs - scanComparisonEntry.totals.mergedPrsCiVerified,
      accelerationDelta: scanResult.metrics.velocityAcceleration - scanComparisonEntry.totals.velocityAcceleration,
    };
  }, [scanComparisonEntry, scanResult]);
  const scanChallengeIntentUrl =
    scanResult && scanComparisonEntry
      ? buildTweetIntentUrl(
          `Scan challenge: can your throughput beat @${scanComparisonEntry.handle}?`,
          buildChallengeLink(appOrigin, currentActorHandle, scanComparisonEntry.handle),
        )
      : null;
  const profileVisitDelta = useMemo(() => {
    if (!profileEntry || !lastProfileVisit) {
      return null;
    }
    return {
      previousRank: lastProfileVisit.rank,
      daysSince: daysBetweenTimestamps(lastProfileVisit.capturedAt, new Date().toISOString()),
      rankDelta: lastProfileVisit.rank - profileEntry.rank,
      eehDelta: profileEntry.totals.equivalentEngineeringHours - lastProfileVisit.equivalentEngineeringHours,
      ciPrDelta: profileEntry.totals.mergedPrsCiVerified - lastProfileVisit.mergedPrsCiVerified,
      previousCapturedAt: lastProfileVisit.capturedAt,
    };
  }, [lastProfileVisit, profileEntry]);
  const nextWeeklyCheckInDays = useMemo(() => {
    if (!lastProfileVisit) {
      return 7;
    }
    const daysSince = daysBetweenTimestamps(lastProfileVisit.capturedAt, new Date().toISOString());
    if (daysSince === null) {
      return 7;
    }
    return clamp(7 - daysSince, 0, 7);
  }, [lastProfileVisit]);
  const normalizedActorHandle = currentActorHandle.toLowerCase();
  const defaultChallengeTarget = sortedEntries.find((entry) => entry.handle !== normalizedActorHandle) ?? null;
  const myProfileShareIntentUrl = authIdentity
    ? buildTweetIntentUrl(
        `My Mentat Velocity profile is live. Benchmark my AI-verified throughput.`,
        buildProfileUrl(appOrigin, authIdentity.handle),
      )
    : null;
  const leaderboardChallengeIntentUrl = defaultChallengeTarget
    ? buildTweetIntentUrl(
        `Open challenge: @${defaultChallengeTarget.handle}, let's compare AI-verified throughput on Mentat Velocity.`,
        buildChallengeLink(appOrigin, currentActorHandle, defaultChallengeTarget.handle),
      )
    : null;

  return (
    <div className="min-h-screen bg-app text-ink-1 font-sans">
      <header className="border-b border-slate-800/80 bg-surface-0/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 md:px-6 lg:px-8">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-accent-2">Mentat</p>
            <h1 className="font-display text-xl">Velocity MVP</h1>
          </div>
          <div className="flex max-w-full flex-col items-end gap-2">
            <div className="flex flex-wrap items-center justify-end gap-2">
              {route.kind === 'profile' ? (
                <button
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-mono text-ink-2 hover:border-cyan-400 hover:text-ink-1"
                  onClick={() => goHome('leaderboard')}
                  type="button"
                >
                  Back to Leaderboard
                </button>
              ) : null}
              {authIdentity && !isViewingSignedInProfile ? (
                <button
                  className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-mono text-ink-2 hover:border-cyan-400 hover:text-ink-1"
                  onClick={() => openProfile(authIdentity.handle)}
                  type="button"
                >
                  My Profile
                </button>
              ) : null}
              <div className="rounded-full border border-slate-700 px-3 py-1 font-mono text-xs text-ink-2">Public GitHub Data</div>
              <div className="auth-panel">
                {authIdentity?.avatarUrl ? (
                  <img
                    alt={`GitHub avatar for ${authIdentity.githubLogin}`}
                    className="h-7 w-7 rounded-full border border-slate-600 object-cover"
                    src={authIdentity.avatarUrl}
                  />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-600 bg-slate-900/80 font-mono text-xs text-ink-2">
                    {authIdentity ? authIdentity.githubLogin.slice(0, 1).toUpperCase() : '?'}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
                    {isAuthLoading ? 'Checking Auth' : authIdentity ? 'Signed In' : 'Signed Out'}
                  </p>
                  <p className="truncate font-mono text-xs text-ink-1">
                    {authIdentity ? `@${authIdentity.handle} / ${authIdentity.githubLogin}` : 'GitHub session unavailable'}
                  </p>
                </div>
                {authIdentity ? (
                  <button
                    className="auth-cta"
                    disabled={isSigningOut || isAuthLoading}
                    onClick={() => {
                      void onSignOut();
                    }}
                    type="button"
                  >
                    {isSigningOut ? 'Signing out...' : 'Sign out'}
                  </button>
                ) : (
                  <a className="auth-cta" href="/api/auth/github/start">
                    Sign in
                  </a>
                )}
              </div>
            </div>
            {authError ? <p className="max-w-[20rem] text-right font-mono text-xs text-state-warning">{authError}</p> : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        {route.kind === 'profile' ? (
          isProfileLoading && !profileEntry ? (
            <section className="rounded-xl border border-slate-700/80 bg-surface-1 p-5 shadow-soft">
              <h2 className="font-display text-2xl">Loading Profile</h2>
              <p className="mt-2 text-sm text-ink-2">Fetching trusted profile data for @{route.handle}.</p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="h-20 animate-pulse rounded-lg border border-slate-700 bg-surface-2" />
                <div className="h-20 animate-pulse rounded-lg border border-slate-700 bg-surface-2" />
                <div className="h-20 animate-pulse rounded-lg border border-slate-700 bg-surface-2" />
              </div>
            </section>
          ) : profileEntry ? (
            <section className="space-y-6">
              <div className="rounded-xl border border-slate-700/80 bg-surface-1 p-5 shadow-soft">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-[0.2em] text-ink-3">Creator Profile</p>
                    <h2 className="mt-2 font-display text-2xl leading-tight sm:text-3xl">@{profileEntry.handle}</h2>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="max-w-full break-words rounded-full border border-cyan-400/40 bg-cyan-500/10 px-3 py-1 font-mono text-xs text-cyan-200">
                        {profileTier} Tier
                      </span>
                      <span className="max-w-full break-words rounded-full border border-slate-600 px-3 py-1 font-mono text-xs text-ink-2">
                        Global Rank #{globalRank}
                      </span>
                      <span className="max-w-full break-words rounded-full border border-slate-600 px-3 py-1 font-mono text-xs text-ink-2">
                        Percentile {formatPercent(profilePercentile)}
                      </span>
                      {isViewingSignedInProfile ? (
                        <span className="max-w-full break-words rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 font-mono text-xs text-emerald-200">
                          Signed-in profile
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {profileShareIntentUrl ? (
                    <a
                      className="rounded-lg border border-cyan-400/60 bg-cyan-500/10 px-3 py-2 text-xs font-mono text-cyan-100 hover:bg-cyan-500/20"
                      href={profileShareIntentUrl}
                      onClick={() =>
                        trackUxEvent('profile_share_clicked', {
                          handle: profileEntry.handle,
                          source: 'profile_header',
                        })
                      }
                      rel="noreferrer"
                      target="_blank"
                    >
                      Share Profile
                    </a>
                  ) : null}
                  {profileChallengeIntentUrl && profileRival ? (
                    <a
                      className="rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-xs font-mono text-amber-100 hover:bg-amber-400/20"
                      href={profileChallengeIntentUrl}
                      onClick={() =>
                        trackUxEvent('challenge_link_clicked', {
                          challenger: currentActorHandle,
                          target: profileRival.handle,
                          source: 'profile_header',
                        })
                      }
                      rel="noreferrer"
                      target="_blank"
                    >
                      Challenge @{profileRival.handle}
                    </a>
                  ) : (
                    <span className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-mono text-ink-3">Challenge link unavailable: no comparable rival yet.</span>
                  )}
                  <a
                    className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-mono text-ink-2 hover:border-cyan-400 hover:text-ink-1"
                    href={inviteIntentUrl}
                    onClick={() =>
                      trackUxEvent('invite_link_clicked', {
                        source: 'profile_header',
                        handle: profileEntry.handle,
                      })
                    }
                    rel="noreferrer"
                    target="_blank"
                  >
                    Invite Peer
                  </a>
                </div>
                <p className="mt-4 max-w-4xl rounded-lg border border-slate-700 bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">{profileAttributionSummary}</p>

                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-lg border border-slate-700 bg-surface-2 p-3">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">EEH (30d)</p>
                    <p className="mt-1 font-mono text-xl">{formatNumber(profileEntry.totals.equivalentEngineeringHours, 1)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-surface-2 p-3">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">CI Merged PRs</p>
                    <p className="mt-1 font-mono text-xl">{formatNumber(profileEntry.totals.mergedPrsCiVerified, 0)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-surface-2 p-3">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">Commits/Day</p>
                    <p className="mt-1 font-mono text-xl">{formatNumber(profileEntry.totals.commitsPerDay)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-surface-2 p-3">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">Off-Hours</p>
                    <p className="mt-1 font-mono text-xl">{formatPercent(profileEntry.totals.offHoursRatio)}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-surface-2 p-3">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">EEH Accel</p>
                    <p
                      className={`mt-1 font-mono text-xl ${
                        profileEntry.totals.velocityAcceleration >= 0 ? 'text-state-success' : 'text-state-warning'
                      }`}
                    >
                      {formatAcceleration(profileEntry.totals.velocityAcceleration)}
                    </p>
                  </div>
                </div>
                <p className="mt-3 rounded-md border border-slate-700 bg-surface-2/80 px-3 py-2 text-xs leading-relaxed text-ink-2">{profileMetricProvenance}</p>
                <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
                  <div className="rounded-lg border border-emerald-400/35 bg-emerald-500/10 p-3">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-emerald-100">Weekly Streak</p>
                    <p className="mt-1 font-mono text-xl text-emerald-100">{profileWeeklyStreak} week(s)</p>
                    <p className="mt-1 text-xs text-emerald-200/90">Next weekly checkpoint in {nextWeeklyCheckInDays} day(s).</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-surface-2 p-3 lg:col-span-2">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">What Changed Since Last Visit</p>
                    {profileVisitDelta ? (
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <div className="rounded border border-slate-700 p-2">
                          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">Rank Delta</p>
                          <p className={`font-mono text-sm ${profileVisitDelta.rankDelta >= 0 ? 'text-state-success' : 'text-state-warning'}`}>
                            {formatRankDelta(profileVisitDelta.previousRank, profileEntry.rank)}
                          </p>
                        </div>
                        <div className="rounded border border-slate-700 p-2">
                          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">EEH Delta</p>
                          <p className={`font-mono text-sm ${profileVisitDelta.eehDelta >= 0 ? 'text-state-success' : 'text-state-warning'}`}>
                            {formatSignedDelta(profileVisitDelta.eehDelta, 1)}
                          </p>
                        </div>
                        <div className="rounded border border-slate-700 p-2">
                          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">CI PR Delta</p>
                          <p className={`font-mono text-sm ${profileVisitDelta.ciPrDelta >= 0 ? 'text-state-success' : 'text-state-warning'}`}>
                            {formatSignedDelta(profileVisitDelta.ciPrDelta, 0)}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-sm text-ink-2">First profile visit recorded. Return next week to unlock trend deltas.</p>
                    )}
                    {profileRival && profileRivalEehDelta !== null ? (
                      <p className="mt-2 text-xs text-ink-2">
                        Weekly compare snapshot: vs @{profileRival.handle}, EEH delta is {formatSignedDelta(profileRivalEehDelta, 1)}.
                      </p>
                    ) : null}
                    {profileVisitDelta && profileVisitDelta.daysSince !== null ? (
                      <p className="mt-2 font-mono text-xs text-ink-3">
                        Last visit snapshot: {new Date(profileVisitDelta.previousCapturedAt).toLocaleString()} ({profileVisitDelta.daysSince} day(s) ago)
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <section className="rounded-xl border border-slate-700/80 bg-surface-1 p-4 shadow-soft lg:col-span-8">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-display text-xl">Trend</h3>
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">30d velocity arc</p>
                  </div>
                  <p className="mb-3 rounded-md border border-slate-700 bg-surface-2/80 px-3 py-2 text-xs leading-relaxed text-ink-2">{trendAttribution}</p>
                  {hasProfileTrend && profileTrendPath ? (
                    <svg
                      className="w-full overflow-visible rounded-lg border border-slate-700 bg-slate-950/35 p-2"
                      viewBox={`0 0 ${TREND_CHART_WIDTH} ${TREND_CHART_HEIGHT}`}
                      role="img"
                      aria-label="Velocity trend chart"
                    >
                      <defs>
                        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="rgba(34,211,238,0.38)" />
                          <stop offset="100%" stopColor="rgba(34,211,238,0.03)" />
                        </linearGradient>
                      </defs>
                      <rect x="0" y="0" width={TREND_CHART_WIDTH} height={TREND_CHART_HEIGHT} fill="transparent" />
                      <path d={profileTrendPath.fillPath} fill="url(#trendFill)" />
                      <path d={profileTrendPath.path} fill="none" stroke="#22d3ee" strokeWidth="2.6" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-ink-2">Trend data unavailable.</p>
                  )}
                </section>

                <section className="rounded-xl border border-slate-700/80 bg-surface-1 p-4 shadow-soft lg:col-span-4">
                  <h3 className="font-display text-xl">Throughput Heatmap</h3>
                  <p className="mt-1 font-mono text-xs uppercase tracking-[0.08em] text-ink-3">Compact weekly throughput bins</p>
                  <p className="mt-3 rounded-md border border-slate-700 bg-surface-2/80 px-3 py-2 text-xs leading-relaxed text-ink-2">{heatmapAttribution}</p>
                  {throughputHeatmap.length > 0 ? (
                    <div className="mt-4 space-y-1">
                      {throughputHeatmap.map((row, rowIndex) => (
                        <div key={`row-${rowIndex}`} className="flex gap-1">
                          {row.map((value, colIndex) => {
                            const color =
                              value === 0
                                ? 'bg-slate-800'
                                : value === 1
                                  ? 'bg-cyan-900/60'
                                  : value === 2
                                    ? 'bg-cyan-700/70'
                                    : value === 3
                                      ? 'bg-cyan-500/80'
                                      : 'bg-cyan-300';
                            return <div key={`cell-${rowIndex}-${colIndex}`} className={`h-4 w-4 rounded-[3px] border border-slate-700 ${color}`} title={`Load level ${value}`} />;
                          })}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-4 rounded-lg border border-dashed border-slate-700 p-4 text-sm text-ink-2">Heatmap data unavailable for this profile.</p>
                  )}
                  <div className="mt-4 flex flex-wrap items-start gap-2">
                    {crowns.map((crown) => (
                      <span
                        key={crown}
                        className="max-w-full break-words whitespace-normal rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-1 font-mono text-xs leading-relaxed text-amber-200"
                      >
                        {crown}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 rounded-md border border-slate-700 bg-surface-2/80 px-3 py-2 text-xs leading-relaxed text-ink-2">{crownsAttribution}</p>
                </section>
              </div>

              <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <div className="rounded-xl border border-slate-700/80 bg-surface-1 p-4 shadow-soft lg:col-span-8">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-display text-xl">Repositories</h3>
                    <p className="font-mono text-xs text-ink-3">Latest repository snapshots</p>
                  </div>
                  <div className="space-y-3">
                    {profileEntry.repos.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-ink-2">No repository snapshots available for this handle.</p>
                    ) : (
                      profileEntry.repos.map((repoCard) => {
                        // TODO(api): expose repo-level AI readiness + pipeline stage in leaderboard/profile payload.
                        const repoAiReady = null as number | null;
                        return (
                          <div key={repoCard.repo.url} className="rounded-lg border border-slate-700 bg-surface-2 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <a className="font-mono text-sm text-accent-2 hover:underline" href={repoCard.repo.url} rel="noreferrer" target="_blank">
                                {repoCard.repo.owner}/{repoCard.repo.name}
                              </a>
                              <span className="font-mono text-xs text-ink-3">Scanned {new Date(repoCard.scannedAt).toLocaleString()}</span>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                              <div className="rounded border border-slate-700 p-2">
                                <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">EEH</p>
                                <p className="font-mono text-sm">{formatNumber(repoCard.metrics.equivalentEngineeringHours, 1)}</p>
                              </div>
                              <div className="rounded border border-slate-700 p-2">
                                <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">Commits/Day</p>
                                <p className="font-mono text-sm">{formatNumber(repoCard.metrics.commitsPerDay)}</p>
                              </div>
                              <div className="rounded border border-slate-700 p-2">
                                <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">CI Merged PRs</p>
                                <p className="font-mono text-sm">{formatNumber(repoCard.metrics.mergedPrsCiVerified, 0)}</p>
                              </div>
                              <div className="rounded border border-slate-700 p-2">
                                <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">AI-Ready</p>
                                <p className="font-mono text-sm text-ink-2">{repoAiReady === null ? 'Data unavailable in MVP' : `${repoAiReady}%`}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                <aside className="rounded-xl border border-slate-700/80 bg-surface-1 p-4 shadow-soft lg:col-span-4">
                  <h3 className="font-display text-lg">Latest Insight</h3>
                  <p className="mt-3 rounded-md border border-slate-700 bg-surface-2/80 px-3 py-2 text-xs leading-relaxed text-ink-2">{insightAttribution}</p>
                  <div className="mt-3 rounded-lg border border-slate-700 bg-surface-2 p-3">
                    {insightFeed.length > 0 ? (
                      <p className="text-sm text-ink-2">{insightFeed[insightIndex] ?? insightFeed[0]}</p>
                    ) : (
                      <p className="text-sm text-ink-2">No backend insight is available for this profile yet.</p>
                    )}
                  </div>
                </aside>
              </section>
            </section>
          ) : (
            <section className="rounded-xl border border-slate-700/80 bg-surface-1 p-5 shadow-soft">
              <h2 className="font-display text-2xl">Profile Not Found</h2>
              <p className="mt-2 text-sm text-ink-2">
                No seeded profile matched @{route.handle}. Choose a handle from the leaderboard.
              </p>
              {profileError ? <p className="mt-2 text-sm text-state-warning">Profile API: {profileError}</p> : null}
              <button
                className="mt-4 rounded-lg border border-slate-700 px-3 py-2 text-sm text-ink-2 hover:border-cyan-400 hover:text-ink-1"
                onClick={() => goHome('leaderboard')}
                type="button"
              >
                Return to leaderboard
              </button>
            </section>
          )
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <section className="space-y-6 lg:col-span-8">
              <div className="rounded-xl border border-slate-700/80 bg-surface-1 p-5 shadow-soft">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-display text-3xl leading-tight">Mentat Velocity Snapshot</h2>
                    <p className="mt-1 text-sm text-ink-2">
                      30-day snapshots for seeded handles. Leaderboard refresh prefers strict handle-authored attribution; manual scans may remain repo-wide.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-surface-2 p-1">
                    <button
                      className={`rounded-md px-3 py-2 text-sm ${
                        view === 'leaderboard' ? 'bg-gradient-to-r from-cyan-400 to-sky-500 text-slate-950' : 'text-ink-2'
                      }`}
                      onClick={() => setView('leaderboard')}
                      type="button"
                    >
                      Leaderboard
                    </button>
                    <button
                      className={`rounded-md px-3 py-2 text-sm ${
                        view === 'scan' ? 'bg-gradient-to-r from-cyan-400 to-sky-500 text-slate-950' : 'text-ink-2'
                      }`}
                      onClick={() => setView('scan')}
                      type="button"
                    >
                      Scan Repo
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {myProfileShareIntentUrl ? (
                    <a
                      className="rounded-lg border border-cyan-400/60 bg-cyan-500/10 px-3 py-2 text-xs font-mono text-cyan-100 hover:bg-cyan-500/20"
                      href={myProfileShareIntentUrl}
                      onClick={() =>
                        trackUxEvent('profile_share_clicked', {
                          source: 'home_hero',
                          handle: authIdentity?.handle ?? 'signed-out',
                        })
                      }
                      rel="noreferrer"
                      target="_blank"
                    >
                      Share My Profile
                    </a>
                  ) : (
                    <a
                      className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-mono text-ink-2 hover:border-cyan-400 hover:text-ink-1"
                      href="/api/auth/github/start"
                      onClick={() => trackUxEvent('claim_profile_clicked', { source: 'home_hero', signedIn: false })}
                    >
                      Sign in to Claim Profile
                    </a>
                  )}
                  {leaderboardChallengeIntentUrl && defaultChallengeTarget ? (
                    <a
                      className="rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-xs font-mono text-amber-100 hover:bg-amber-400/20"
                      href={leaderboardChallengeIntentUrl}
                      onClick={() =>
                        trackUxEvent('challenge_link_clicked', {
                          source: 'home_hero',
                          challenger: currentActorHandle,
                          target: defaultChallengeTarget.handle,
                        })
                      }
                      rel="noreferrer"
                      target="_blank"
                    >
                      Challenge @{defaultChallengeTarget.handle}
                    </a>
                  ) : null}
                  <a
                    className="rounded-lg border border-slate-600 px-3 py-2 text-xs font-mono text-ink-2 hover:border-cyan-400 hover:text-ink-1"
                    href={inviteIntentUrl}
                    onClick={() => trackUxEvent('invite_link_clicked', { source: 'home_hero' })}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Invite Peer
                  </a>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-700 bg-surface-2 p-3">
                    <p className="font-mono text-xs uppercase tracking-wide text-ink-3">Seed Handles</p>
                    <p className="mt-1 text-2xl font-semibold">{kpis.creators}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-surface-2 p-3">
                    <p className="font-mono text-xs uppercase tracking-wide text-ink-3">Repos Scanned</p>
                    <p className="mt-1 text-2xl font-semibold">{kpis.repos}</p>
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-surface-2 p-3">
                    <p className="font-mono text-xs uppercase tracking-wide text-ink-3">Avg EEH (30d)</p>
                    <p className="mt-1 text-2xl font-semibold">{kpis.avgEeh}</p>
                  </div>
                </div>
              </div>

              {view === 'leaderboard' ? (
                <section className="rounded-xl border border-slate-700/80 bg-surface-1 p-4 shadow-soft md:p-5">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-display text-xl">Rankings</h3>
                    <p className="font-mono text-xs text-ink-3">
                      {leaderboard?.generatedAt
                        ? `Static bootstrap snapshot: ${new Date(leaderboard.generatedAt).toLocaleString()}`
                        : 'No artifact generated yet'}
                    </p>
                  </div>
                  <p className="mb-4 rounded-md border border-slate-700 bg-surface-2 px-3 py-2 text-xs text-ink-2">
                    Methodology: EEH and ranking use CI-verified merged PRs on the default branch; unverified merged PR totals are shown for transparency.
                  </p>
                  {leaderboardError ? <p className="text-sm text-state-danger">{leaderboardError}</p> : null}
                  <div className="mb-3 grid gap-3 sm:hidden">
                    {!leaderboardError && !leaderboard ? (
                      <p className="rounded-lg border border-slate-700 bg-surface-2 px-3 py-4 text-sm text-ink-2">Loading leaderboard artifact...</p>
                    ) : null}
                    {!leaderboardError && leaderboard && leaderboard.entries.length === 0 ? (
                      <p className="rounded-lg border border-slate-700 bg-surface-2 px-3 py-4 text-sm text-ink-2">
                        No leaderboard entries available yet. Run bootstrap to generate data.
                      </p>
                    ) : null}
                    {sortedEntries.map((entry) => {
                      const percentile = getPercentile(entry, sortedEntries.length);
                      const nextHigher = sortedEntries.find((candidate) => candidate.rank === entry.rank - 1) ?? null;
                      const eehGapToNext = nextHigher ? nextHigher.totals.equivalentEngineeringHours - entry.totals.equivalentEngineeringHours : null;
                      const shareEntryIntentUrl = buildTweetIntentUrl(
                        `Mentat Velocity profile check: @${entry.handle} is currently #${entry.rank}.`,
                        buildProfileUrl(appOrigin, entry.handle),
                      );
                      const challengeEntryIntentUrl = buildTweetIntentUrl(
                        `I challenge @${entry.handle} on Mentat Velocity.`,
                        buildChallengeLink(appOrigin, currentActorHandle, entry.handle),
                      );
                      return (
                        <div key={`${entry.handle}-mobile`} className="rounded-lg border border-slate-700 bg-slate-950/35 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <button className="font-mono text-xs text-accent-2 hover:underline" onClick={() => openProfile(entry.handle)} type="button">
                              #{entry.rank} @{entry.handle}
                            </button>
                            <p className="font-mono text-xs text-ink-3">{entry.scannedRepos} repo(s)</p>
                          </div>
                          <div className="mt-2 flex items-center justify-between">
                            <p className="text-sm text-ink-2">Percentile</p>
                            <p className="font-mono text-sm">{formatPercent(percentile)}</p>
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <p className="text-sm text-ink-2">EEH</p>
                            <p className="font-mono text-sm">{formatNumber(entry.totals.equivalentEngineeringHours, 1)}</p>
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <p className="text-sm text-ink-2">CI Merged PRs</p>
                            <p className="font-mono text-sm">{formatNumber(entry.totals.mergedPrsCiVerified, 0)}</p>
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <p className="text-sm text-ink-2">EEH Accel</p>
                            <p className={`font-mono text-sm ${entry.totals.velocityAcceleration >= 0 ? 'text-state-success' : 'text-state-warning'}`}>
                              {formatAcceleration(entry.totals.velocityAcceleration)}
                            </p>
                          </div>
                          {eehGapToNext !== null ? (
                            <div className="mt-1 flex items-center justify-between">
                              <p className="text-sm text-ink-2">Gap to #{nextHigher?.rank}</p>
                              <p className="font-mono text-sm text-ink-2">{formatNumber(Math.max(0, eehGapToNext), 1)} EEH</p>
                            </div>
                          ) : (
                            <div className="mt-1 flex items-center justify-between">
                              <p className="text-sm text-ink-2">Lead Position</p>
                              <p className="font-mono text-sm text-state-success">#1 pace</p>
                            </div>
                          )}
                          <div className="mt-3 flex items-center gap-2">
                            <a
                              className="rounded border border-cyan-400/50 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-mono text-cyan-100 hover:bg-cyan-500/20"
                              href={shareEntryIntentUrl}
                              onClick={() =>
                                trackUxEvent('profile_share_clicked', {
                                  source: 'leaderboard_mobile_row',
                                  handle: entry.handle,
                                })
                              }
                              rel="noreferrer"
                              target="_blank"
                            >
                              Share
                            </a>
                            <a
                              className="rounded border border-amber-400/50 bg-amber-400/10 px-2.5 py-1 text-[11px] font-mono text-amber-100 hover:bg-amber-400/20"
                              href={challengeEntryIntentUrl}
                              onClick={() =>
                                trackUxEvent('challenge_link_clicked', {
                                  source: 'leaderboard_mobile_row',
                                  challenger: currentActorHandle,
                                  target: entry.handle,
                                })
                              }
                              rel="noreferrer"
                              target="_blank"
                            >
                              Challenge
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-slate-800/80 bg-slate-950/35">
                    <table className="hidden w-full min-w-[720px] text-left text-sm sm:table">
                      <thead className="border-b border-slate-700 font-mono text-xs uppercase tracking-wide text-ink-3">
                        <tr>
                          <th className="px-2 py-2">Rank</th>
                          <th className="px-2 py-2">Seed Handle</th>
                          <th className="px-2 py-2">Top Repo</th>
                          <th className="px-2 py-2" title="Equivalent engineering hours heuristic for the current 30-day window.">
                            EEH (30d)
                          </th>
                          <th
                            className="px-2 py-2"
                            title="Merged pull requests in the current 30-day window targeting the default branch with successful CI at merge commit time."
                          >
                            Merged PRs (CI-verified)
                          </th>
                          <th
                            className="px-2 py-2"
                            title="Merged pull requests in the current 30-day window targeting the default branch before CI verification filtering."
                          >
                            Merged PRs (Unverified)
                          </th>
                          <th className="px-2 py-2">Commits/Day</th>
                          <th className="px-2 py-2">Active Hrs</th>
                          <th className="px-2 py-2">Off-Hours</th>
                          <th className="px-2 py-2">EEH Accel</th>
                        </tr>
                      </thead>
                      <tbody>
                        {!leaderboardError && !leaderboard ? (
                          <tr className="border-b border-slate-800/80">
                            <td className="px-2 py-6 text-center text-ink-2" colSpan={10}>
                              Loading leaderboard artifact...
                            </td>
                          </tr>
                        ) : null}
                        {!leaderboardError && leaderboard && leaderboard.entries.length === 0 ? (
                          <tr className="border-b border-slate-800/80">
                            <td className="px-2 py-6 text-center text-ink-2" colSpan={10}>
                              No leaderboard entries available yet. Run bootstrap to generate data.
                            </td>
                          </tr>
                        ) : null}
                        {sortedEntries.map((entry) => (
                          <tr key={entry.handle} className="border-b border-slate-800/80 transition-colors hover:bg-surface-2">
                            <td className="px-2 py-3 font-mono text-accent-2">#{entry.rank}</td>
                            <td className="px-2 py-3">
                              <button className="font-medium hover:text-accent-2" onClick={() => openProfile(entry.handle)} type="button">
                                @{entry.handle}
                              </button>
                              <p className="font-mono text-xs text-ink-3">{entry.scannedRepos} repo(s) scanned</p>
                              {entry.aiReadyScore === undefined ? (
                                <p className="font-mono text-xs text-ink-3">AI-Ready: pending</p>
                              ) : (
                                <p className="font-mono text-xs text-ink-3">AI-Ready: {entry.aiReadyScore}%</p>
                              )}
                              {entry.scanInsight ? <p className="font-mono text-xs text-ink-3">{entry.scanInsight}</p> : null}
                              <div className="mt-2 flex flex-wrap gap-2">
                                <a
                                  className="rounded border border-cyan-400/50 bg-cyan-500/10 px-2 py-1 font-mono text-[11px] text-cyan-100 hover:bg-cyan-500/20"
                                  href={buildTweetIntentUrl(
                                    `Mentat Velocity profile check: @${entry.handle} is currently #${entry.rank}.`,
                                    buildProfileUrl(appOrigin, entry.handle),
                                  )}
                                  onClick={() =>
                                    trackUxEvent('profile_share_clicked', {
                                      source: 'leaderboard_table_row',
                                      handle: entry.handle,
                                    })
                                  }
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  Share
                                </a>
                                <a
                                  className="rounded border border-amber-400/50 bg-amber-400/10 px-2 py-1 font-mono text-[11px] text-amber-100 hover:bg-amber-400/20"
                                  href={buildTweetIntentUrl(
                                    `I challenge @${entry.handle} on Mentat Velocity.`,
                                    buildChallengeLink(appOrigin, currentActorHandle, entry.handle),
                                  )}
                                  onClick={() =>
                                    trackUxEvent('challenge_link_clicked', {
                                      source: 'leaderboard_table_row',
                                      challenger: currentActorHandle,
                                      target: entry.handle,
                                    })
                                  }
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  Challenge
                                </a>
                              </div>
                            </td>
                            <td className="px-2 py-3">
                              {entry.featuredRepo ? (
                                <a href={entry.featuredRepo} className="text-xs text-ink-2 hover:text-accent-2 hover:underline" rel="noreferrer" target="_blank">
                                  {entry.featuredRepo.replace('https://github.com/', '')}
                                </a>
                              ) : (
                                <span className="text-xs text-ink-3">-</span>
                              )}
                            </td>
                            <td className="px-2 py-3 font-mono">{formatNumber(entry.totals.equivalentEngineeringHours, 1)}</td>
                            <td className="px-2 py-3 font-mono">{formatNumber(entry.totals.mergedPrsCiVerified, 0)}</td>
                            <td className="px-2 py-3 font-mono text-ink-3">{formatNumber(entry.totals.mergedPrsUnverified, 0)}</td>
                            <td className="px-2 py-3 font-mono">{formatNumber(entry.totals.commitsPerDay)}</td>
                            <td className="px-2 py-3 font-mono">{formatNumber(entry.totals.activeCodingHours, 0)}</td>
                            <td className="px-2 py-3 font-mono">{formatPercent(entry.totals.offHoursRatio)}</td>
                            <td className={`px-2 py-3 font-mono ${entry.totals.velocityAcceleration >= 0 ? 'text-state-success' : 'text-state-warning'}`}>
                              {formatAcceleration(entry.totals.velocityAcceleration)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ) : (
                <section className="rounded-xl border border-slate-700/80 bg-surface-1 p-4 shadow-soft md:p-5">
                  <h3 className="font-display text-xl">Scan Repository</h3>
                  <p className="mt-1 text-sm text-ink-2">Input a public GitHub repository URL to generate a 30-day report card.</p>
                  <form className="mt-4 space-y-3" onSubmit={onScanSubmit}>
                    <label className="block text-sm text-ink-2" htmlFor="repo-url-input">
                      Public GitHub repository URL
                    </label>
                    <input
                      id="repo-url-input"
                      className="w-full rounded-lg border border-slate-600 bg-surface-2 px-3 py-2 text-sm outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-300/30"
                      onChange={(event) => setRepoInput(event.target.value)}
                      placeholder="https://github.com/owner/repo"
                      required
                      value={repoInput}
                    />
                    <button
                      className="rounded-lg bg-gradient-to-r from-cyan-400 to-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={isScanning}
                      type="submit"
                    >
                      {isScanning ? 'Scanning...' : 'Scan Repo'}
                    </button>
                  </form>

                  {scanError ? <p className="mt-3 text-sm text-state-danger">{scanError}</p> : null}

                  {scanResult ? (
                    <div className="mt-5 rounded-lg border border-slate-700 bg-surface-2 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <p className="font-display text-lg">
                            {scanResult.repo.owner}/{scanResult.repo.name}
                          </p>
                          <p className="font-mono text-xs text-ink-3">Scanned {new Date(scanResult.scannedAt).toLocaleString()}</p>
                        </div>
                        <a className="text-sm text-accent-2 hover:underline" href={scanResult.repo.url} rel="noreferrer" target="_blank">
                          Open Repo
                        </a>
                      </div>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <div className="rounded-md border border-slate-700 p-2">
                          <p className="font-mono text-xs text-ink-3">Commits/Day</p>
                          <p className="mt-1 font-mono text-lg">{formatNumber(scanResult.metrics.commitsPerDay)}</p>
                        </div>
                        <div className="rounded-md border border-slate-700 p-2">
                          <p className="font-mono text-xs text-ink-3">Merged PRs (CI-verified)</p>
                          <p className="mt-1 font-mono text-lg">{formatNumber(scanResult.metrics.mergedPrs, 0)}</p>
                        </div>
                        <div className="rounded-md border border-slate-700 p-2">
                          <p className="font-mono text-xs text-ink-3">Merged PRs (Unverified)</p>
                          <p className="mt-1 font-mono text-lg text-ink-2">{formatNumber(scanResult.metrics.mergedPrsUnverified, 0)}</p>
                        </div>
                        <div className="rounded-md border border-slate-700 p-2">
                          <p className="font-mono text-xs text-ink-3">Active Coding Hours</p>
                          <p className="mt-1 font-mono text-lg">{formatNumber(scanResult.metrics.activeCodingHours, 0)}</p>
                        </div>
                        <div className="rounded-md border border-slate-700 p-2">
                          <p className="font-mono text-xs text-ink-3">Off-Hours Ratio</p>
                          <p className="mt-1 font-mono text-lg">{formatPercent(scanResult.metrics.offHoursRatio)}</p>
                        </div>
                        <div className="rounded-md border border-slate-700 p-2">
                          <p className="font-mono text-xs text-ink-3">Acceleration</p>
                          <p className={`mt-1 font-mono text-lg ${scanResult.metrics.velocityAcceleration >= 0 ? 'text-state-success' : 'text-state-warning'}`}>
                            {formatAcceleration(scanResult.metrics.velocityAcceleration)}
                          </p>
                        </div>
                        <div className="rounded-md border border-slate-700 p-2">
                          <p className="font-mono text-xs text-ink-3">Equivalent Eng Hours</p>
                          <p className="mt-1 font-mono text-lg">{formatNumber(scanResult.metrics.equivalentEngineeringHours, 1)}</p>
                        </div>
                      </div>
                      <p className="mt-3 rounded-md border border-slate-700 bg-surface-2/80 px-3 py-2 text-xs leading-relaxed text-ink-2">
                        Provenance: {scanResult.attribution.notes} Mode: {scanResult.attribution.mode}. Policy:{' '}
                        {scanResult.attribution.policy ?? 'repo-wide-non-bot-default-branch'}.
                      </p>

                      <div className="mt-4 rounded-lg border border-cyan-500/40 bg-cyan-500/10 p-3">
                        <p className="font-mono text-xs uppercase tracking-[0.08em] text-cyan-100">Post-Scan Leaderboard Lane</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {authIdentity ? (
                            <button
                              className="rounded-md border border-cyan-300/60 bg-cyan-500/20 px-3 py-2 text-xs font-mono text-cyan-100 hover:bg-cyan-500/30"
                              onClick={() => {
                                trackUxEvent('claim_profile_clicked', { source: 'scan_lane', signedIn: true, handle: authIdentity.handle });
                                openProfile(authIdentity.handle);
                              }}
                              type="button"
                            >
                              Claim/View My Profile
                            </button>
                          ) : (
                            <a
                              className="rounded-md border border-cyan-300/60 bg-cyan-500/20 px-3 py-2 text-xs font-mono text-cyan-100 hover:bg-cyan-500/30"
                              href="/api/auth/github/start"
                              onClick={() => trackUxEvent('claim_profile_clicked', { source: 'scan_lane', signedIn: false })}
                            >
                              Sign in to Claim Profile
                            </a>
                          )}
                          <button
                            className="rounded-md border border-slate-600 px-3 py-2 text-xs font-mono text-ink-1 hover:border-cyan-400"
                            onClick={() => {
                              setView('leaderboard');
                              trackUxEvent('scan_to_leaderboard_clicked', { source: 'scan_lane' });
                            }}
                            type="button"
                          >
                            View Ranking Impact
                          </button>
                          {scanChallengeIntentUrl && scanComparisonEntry ? (
                            <a
                              className="rounded-md border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-xs font-mono text-amber-100 hover:bg-amber-400/20"
                              href={scanChallengeIntentUrl}
                              onClick={() =>
                                trackUxEvent('challenge_link_clicked', {
                                  source: 'scan_lane',
                                  challenger: currentActorHandle,
                                  target: scanComparisonEntry.handle,
                                })
                              }
                              rel="noreferrer"
                              target="_blank"
                            >
                              Challenge @{scanComparisonEntry.handle}
                            </a>
                          ) : null}
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div className="rounded-md border border-slate-700 bg-surface-2 p-3">
                            <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">Ranking Impact Preview</p>
                            {scanRankPreview ? (
                              <>
                                <p className="mt-1 font-mono text-lg text-ink-1">Estimated rank #{scanRankPreview.estimatedRank}</p>
                                <p className="font-mono text-xs text-ink-2">Estimated percentile {formatPercent(scanRankPreview.estimatedPercentile)}</p>
                                <p className="mt-2 text-xs text-ink-3">
                                  Preview compares this scan’s EEH against {scanRankPreview.sampleSize} current leaderboard profiles and is non-authoritative until backend refresh.
                                </p>
                              </>
                            ) : (
                              <p className="mt-1 text-sm text-ink-2">Ranking preview unavailable until leaderboard data is loaded.</p>
                            )}
                          </div>
                          <div className="rounded-md border border-slate-700 bg-surface-2 p-3">
                            <label className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3" htmlFor="scan-compare-handle">
                              Compare Against Developer
                            </label>
                            <select
                              id="scan-compare-handle"
                              className="mt-2 w-full rounded-md border border-slate-600 bg-slate-950/60 px-2 py-2 text-sm text-ink-1 outline-none focus:border-cyan-400"
                              onChange={(event) => {
                                setScanCompareHandle(event.target.value);
                                trackUxEvent('scan_compare_target_selected', {
                                  source: 'scan_lane',
                                  target: event.target.value,
                                });
                              }}
                              value={scanCompareHandle}
                            >
                              {sortedEntries.length === 0 ? <option value="">No leaderboard entries</option> : null}
                              {sortedEntries.map((entry) => (
                                <option key={`scan-compare-${entry.handle}`} value={entry.handle}>
                                  @{entry.handle} (#{entry.rank})
                                </option>
                              ))}
                            </select>
                            {scanComparison && scanComparisonEntry ? (
                              <div className="mt-2 space-y-1 text-xs text-ink-2">
                                <p>
                                  EEH delta vs @{scanComparisonEntry.handle}: {formatSignedDelta(scanComparison.eehDelta, 1)}
                                </p>
                                <p>
                                  CI PR delta vs @{scanComparisonEntry.handle}: {formatSignedDelta(scanComparison.ciPrDelta, 0)}
                                </p>
                                <p>
                                  Acceleration delta vs @{scanComparisonEntry.handle}: {formatAcceleration(scanComparison.accelerationDelta)}
                                </p>
                              </div>
                            ) : (
                              <p className="mt-2 text-xs text-ink-3">Select a target to preview a head-to-head comparison.</p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 overflow-hidden rounded-md border border-slate-700">
                        <div className="border-b border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs uppercase tracking-wide text-ink-3">
                          Raw Report Card JSON
                        </div>
                        <pre className="overflow-auto bg-slate-950/80 p-3 text-xs text-ink-2">{JSON.stringify(scanResult, null, 2)}</pre>
                      </div>
                    </div>
                  ) : null}
                </section>
              )}
            </section>

            <aside className="space-y-4 lg:col-span-4">
              <section className="rounded-xl border border-slate-700/80 bg-surface-1 p-4 shadow-soft md:p-5 lg:sticky lg:top-6">
                <h3 className="font-display text-lg">Metric Notes</h3>
                <ul className="mt-3 space-y-3 text-sm text-ink-2">
                  <li>
                    <span className="text-ink-1">Off-hours ratio</span> uses unique UTC commit hours outside 09:00-18:00.
                  </li>
                  <li>
                    <span className="text-ink-1">Velocity acceleration</span> compares current 30d EEH/day against previous 30d.
                  </li>
                  <li>
                    <span className="text-ink-1">Merged PR scoring</span> is default-branch scoped and CI-verified via checks/status on the merge commit.
                  </li>
                  <li>
                    <span className="text-ink-1">Equivalent engineering hours</span> is a heuristic proxy, not a timesheet.
                  </li>
                </ul>
              </section>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

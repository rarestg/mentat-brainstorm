import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchAuthIdentity, fetchLeaderboard, fetchProfile, logoutAuthSession, scanRepository } from './api';
import type { AuthIdentity } from './api';
import type { LeaderboardArtifact, LeaderboardEntry, ProfileResponse, RepoReportCard } from '../shared/types';

type View = 'leaderboard' | 'scan';

type Route =
  | { kind: 'home' }
  | { kind: 'profile'; handle: string };

const TREND_CHART_WIDTH = 440;
const TREND_CHART_HEIGHT = 144;
const TREND_CHART_PADDING = 14;

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

function hashHandle(handle: string): number {
  return Array.from(handle).reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 1), 0);
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

  // TODO(api): replace this synthesized series with backend-provided per-day points for richer chart fidelity.
  const previousTotal = entry.repos.reduce((sum, repo) => {
    const window = repo.windows.find((item) => item.label === 'previous30d');
    return sum + (window?.equivalentEngineeringHours ?? 0);
  }, 0);
  const currentTotal = entry.repos.reduce((sum, repo) => {
    const window = repo.windows.find((item) => item.label === 'current30d');
    return sum + (window?.equivalentEngineeringHours ?? 0);
  }, 0);

  const baseline = previousTotal > 0 || currentTotal > 0 ? previousTotal : Math.max(entry.totals.equivalentEngineeringHours * 0.85, 0.5);
  const target = currentTotal > 0 || previousTotal > 0 ? currentTotal : Math.max(entry.totals.equivalentEngineeringHours, 0.9);
  const wobbleUnit = Math.max(target, baseline, 1) * 0.05;
  const seed = hashHandle(entry.handle);

  return Array.from({ length: 10 }, (_, index) => {
    const progress = index / 9;
    const trend = baseline + (target - baseline) * progress;
    const wobble = Math.sin(seed * 0.11 + index * 0.9) * wobbleUnit;
    return Math.max(0, Math.round((trend + wobble) * 10) / 10);
  });
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

  // TODO(api): replace with backend hourly/weekday throughput matrix once endpoint includes explicit heatmap bins.
  const hash = hashHandle(entry.handle);
  const baseLoad = clamp(Math.round(entry.totals.commitsPerDay / 2), 0, 4);
  return Array.from({ length: 4 }, (_, week) =>
    Array.from({ length: 7 }, (_, day) => {
      const cell = Math.sin(hash * 0.03 + week * 1.5 + day * 0.65) * 2 + baseLoad;
      return clamp(Math.round(cell), 0, 4);
    }),
  );
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

  // TODO(api): this placeholder rotation should be replaced by backend-generated profile insights.
  return [
    'AI insight pending: ingesting merge reliability and review latency to rank automation opportunities.',
    'Factory floor signal: orchestration opportunities likely in repetitive default-branch merge patterns.',
    'AI advisor mode: waiting for repo-level toolchain metadata to generate stack-specific recommendations.',
  ];
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

export function App() {
  const [view, setView] = useState<View>('leaderboard');
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [leaderboard, setLeaderboard] = useState<LeaderboardArtifact | null>(null);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [profileData, setProfileData] = useState<ProfileResponse | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [repoInput, setRepoInput] = useState('https://github.com/honojs/hono');
  const [scanResult, setScanResult] = useState<RepoReportCard | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [insightIndex, setInsightIndex] = useState(0);
  const [authIdentity, setAuthIdentity] = useState<AuthIdentity | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [isSigningOut, setIsSigningOut] = useState(false);

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
      return;
    }

    fetchProfile(route.handle)
      .then((profile) => {
        setProfileData(profile);
        setProfileError(null);
      })
      .catch((error) => {
        setProfileData(null);
        setProfileError((error as Error).message);
      });
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
  const throughputHeatmap = useMemo(() => (profileEntry ? buildThroughputHeatmap(profileEntry) : []), [profileEntry]);
  const hasProfileHeatmap = useMemo(() => isValidHeatmapMatrix(profileEntry?.profile?.throughputHeatmap), [profileEntry]);
  const hasProfileInsights = useMemo(() => Boolean(profileEntry?.profile?.rotatingInsights?.length), [profileEntry]);
  const crowns = useMemo(() => {
    if (profileData?.crowns.length) {
      return profileData.crowns.map((crown) => crown.label);
    }
    return profileEntry ? deriveCrowns(profileEntry) : [];
  }, [profileData, profileEntry]);
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
    return 'Attribution: trend is estimated from current/previous 30d EEH totals while historical points are unavailable.';
  }, [profileData, profileEntry]);
  const heatmapAttribution = hasProfileHeatmap
    ? 'Attribution: heatmap bins come from profile throughput data in leaderboard payload.'
    : 'Attribution: heatmap bins are estimated from aggregate commits/day until hourly bins are available.';
  const insightAttribution = hasProfileInsights
    ? 'Attribution: insight text is supplied by backend profile metadata.'
    : 'Attribution: insight text is client-side placeholder copy while backend insights are unavailable.';

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

    try {
      const result = await scanRepository(repoInput);
      setScanResult(result);
    } catch (error) {
      setScanError((error as Error).message);
      setScanResult(null);
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
          profileEntry ? (
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
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
                <section className="rounded-xl border border-slate-700/80 bg-surface-1 p-4 shadow-soft lg:col-span-8">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-display text-xl">Trend</h3>
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">30d velocity arc</p>
                  </div>
                  <p className="mb-3 rounded-md border border-slate-700 bg-surface-2/80 px-3 py-2 text-xs leading-relaxed text-ink-2">{trendAttribution}</p>
                  {profileTrendPath ? (
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
                    <p className="text-sm text-ink-2">{insightFeed[insightIndex] ?? 'Insight pipeline loading.'}</p>
                  </div>
                  <p className="mt-4 text-xs text-ink-3">
                    Placeholder mode is active when backend profile insights are unavailable.
                  </p>
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
                    {sortedEntries.map((entry) => (
                      <div key={`${entry.handle}-mobile`} className="rounded-lg border border-slate-700 bg-slate-950/35 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <button className="font-mono text-xs text-accent-2 hover:underline" onClick={() => openProfile(entry.handle)} type="button">
                            #{entry.rank} @{entry.handle}
                          </button>
                          <p className="font-mono text-xs text-ink-3">{entry.scannedRepos} repo(s)</p>
                        </div>
                        <div className="mt-2 flex items-center justify-between">
                          <p className="text-sm text-ink-2">EEH</p>
                          <p className="font-mono text-sm">{formatNumber(entry.totals.equivalentEngineeringHours, 1)}</p>
                        </div>
                        <div className="mt-1 flex items-center justify-between">
                          <p className="text-sm text-ink-2">EEH Accel</p>
                          <p className={`font-mono text-sm ${entry.totals.velocityAcceleration >= 0 ? 'text-state-success' : 'text-state-warning'}`}>
                            {formatAcceleration(entry.totals.velocityAcceleration)}
                          </p>
                        </div>
                      </div>
                    ))}
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

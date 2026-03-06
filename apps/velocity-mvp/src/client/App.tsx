import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchAuthIdentity, fetchLeaderboard, fetchProfile, logoutAuthSession, scanRepository } from './api';
import type { AuthIdentity } from './api';
import type {
  LeaderboardArtifact,
  LeaderboardEntry,
  PayloadFreshness,
  PayloadFreshnessStaleReasonCode,
  ProfileResponse,
  RepoReportCard,
  TrustAnomalyFlag,
  TrustAnomalySeverity,
  VerifiedAgentOutputReasonCode,
  VerifiedAgentOutputStatus,
} from '../shared/types';

type View = 'leaderboard' | 'scan';

export type Route =
  | { kind: 'home' }
  | { kind: 'profile'; handle: string; challengeTargetHandle: string | null; hasInvalidChallengeQuery: boolean };

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
const HANDLE_PATTERN = /^[A-Za-z0-9_.-]+$/;

export const HERO_SEARCH_PROMPT = 'Search your GitHub handle to see your Velocity.';
export const HERO_PRIMARY_CTA_LABEL = 'Connect GitHub to Claim Profile';
export const LEADERBOARD_DESKTOP_COLUMNS = [
  'Rank',
  'Dev',
  'Operating Stack',
  'EEH (30d)',
  'Merged PRs (CI-Verified)',
  'Velocity Accel',
] as const;

const OPERATING_STACK_LABELS = ['Human Level', 'Copilot User', 'Single Agent', 'Agent Swarm'] as const;

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

function normalizeHandle(handle: string): string | null {
  const normalized = handle.trim().toLowerCase();
  if (!HANDLE_PATTERN.test(normalized)) {
    return null;
  }
  return normalized;
}

export function buildChallengeLink(origin: string, challengerHandle: string, targetHandle: string): string | null {
  const normalizedChallenger = normalizeHandle(challengerHandle);
  const normalizedTarget = normalizeHandle(targetHandle);
  if (!normalizedChallenger || !normalizedTarget) {
    return null;
  }
  return `${buildProfileUrl(origin, normalizedChallenger)}?challenge=${encodeURIComponent(normalizedTarget)}`;
}

function buildTweetIntentUrl(text: string, url: string): string {
  const params = new URLSearchParams({ text, url });
  return `https://twitter.com/intent/tweet?${params.toString()}`;
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

export function parseChallengeQuery(search: string): { targetHandle: string | null; hasInvalidQuery: boolean } {
  const params = new URLSearchParams(search);
  const rawTarget = params.get('challenge');
  if (!rawTarget) {
    return { targetHandle: null, hasInvalidQuery: false };
  }
  const normalized = normalizeHandle(rawTarget);
  if (!normalized) {
    return { targetHandle: null, hasInvalidQuery: true };
  }
  return { targetHandle: normalized, hasInvalidQuery: false };
}

export function isDebugEnabled(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get('debug') === 'true';
}

export function parseRoute(pathname: string, search: string): Route {
  const profileMatch = pathname.match(/^\/v\/([A-Za-z0-9_.-]+)\/?$/);
  if (profileMatch) {
    const challengeQuery = parseChallengeQuery(search);
    return {
      kind: 'profile',
      handle: profileMatch[1].toLowerCase(),
      challengeTargetHandle: challengeQuery.targetHandle,
      hasInvalidChallengeQuery: challengeQuery.hasInvalidQuery,
    };
  }
  return { kind: 'home' };
}

export function routeToPath(route: Route): string {
  if (route.kind === 'profile') {
    const challengeQuery = route.challengeTargetHandle ? `?challenge=${encodeURIComponent(route.challengeTargetHandle)}` : '';
    return `/v/${route.handle}${challengeQuery}`;
  }
  return '/';
}

export type ChallengeDeepLinkResolution =
  | 'none'
  | 'invalid-query'
  | 'challenger-missing'
  | 'target-missing'
  | 'self-target'
  | 'compare-ready';

export function resolveChallengeDeepLinkResolution(params: {
  route: Route;
  challengerHandle: string | null;
  targetHandle: string | null;
}): ChallengeDeepLinkResolution {
  if (params.route.kind !== 'profile' || (!params.route.challengeTargetHandle && !params.route.hasInvalidChallengeQuery)) {
    return 'none';
  }
  if (params.route.hasInvalidChallengeQuery) {
    return 'invalid-query';
  }
  if (!params.challengerHandle) {
    return 'challenger-missing';
  }
  if (!params.targetHandle) {
    return 'target-missing';
  }
  if (params.targetHandle === params.challengerHandle) {
    return 'self-target';
  }
  return 'compare-ready';
}

interface FreshnessTimestampMarker {
  label: string;
  iso: string;
}

interface FreshnessPresentation {
  headline: string;
  detail: string;
  timestamps: FreshnessTimestampMarker[];
  note: string | null;
  staleReasonCodes: PayloadFreshnessStaleReasonCode[];
  staleReasonText: string[];
  debugAttribution: string | null;
  isStale: boolean;
  tone: 'server' | 'fallback' | 'missing' | 'stale';
}

interface VerificationPresentation {
  state: VerifiedAgentOutputStatus['state'];
  label: string;
  reason: string;
  detail: string | null;
  toneClass: string;
}

function isIsoTimestamp(value: string | undefined): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function formatFreshnessTimestamp(iso: string): string {
  if (!isIsoTimestamp(iso)) {
    return 'timestamp unavailable';
  }
  return new Date(iso).toLocaleString();
}

export function compactReasonText(reason: string, maxLength = 120): string {
  const normalized = reason.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return 'Reason unavailable.';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function summarizeAnomalies(
  anomalies: TrustAnomalyFlag[] | null | undefined,
  limit = 2,
): { visible: TrustAnomalyFlag[]; remaining: number } {
  if (!Array.isArray(anomalies) || anomalies.length === 0) {
    return { visible: [], remaining: 0 };
  }
  const normalizedLimit = Math.max(0, Math.floor(limit));
  const visible = anomalies.slice(0, normalizedLimit);
  const remaining = Math.max(0, anomalies.length - visible.length);
  return { visible, remaining };
}

function getAnomalySeverityToneClasses(severity: TrustAnomalySeverity): string {
  if (severity === 'high') {
    return 'border-rose-400/45 bg-rose-500/10 text-rose-100';
  }
  if (severity === 'medium') {
    return 'border-amber-400/45 bg-amber-400/10 text-amber-100';
  }
  return 'border-sky-400/40 bg-sky-500/10 text-sky-100';
}

export function mapFreshnessStaleReasonCode(code: PayloadFreshnessStaleReasonCode): string {
  if (code === 'missing-snapshot-timestamp') {
    return 'Snapshot timestamp is missing.';
  }
  if (code === 'snapshot-too-old') {
    return 'Snapshot age is outside the freshness window.';
  }
  return 'Cache version fallback is active.';
}

export function summarizeFreshnessStaleReasons(staleReasons: PayloadFreshnessStaleReasonCode[] | null | undefined): string[] {
  if (!Array.isArray(staleReasons) || staleReasons.length === 0) {
    return [];
  }
  const seen = new Set<PayloadFreshnessStaleReasonCode>();
  const normalized: PayloadFreshnessStaleReasonCode[] = [];
  for (const code of staleReasons) {
    if (seen.has(code)) {
      continue;
    }
    seen.add(code);
    normalized.push(code);
  }
  return normalized.map((code) => mapFreshnessStaleReasonCode(code));
}

export function mapVerificationReasonCode(code: VerifiedAgentOutputReasonCode): string {
  if (code === 'eligible') {
    return 'All verification gates passed.';
  }
  if (code === 'readiness-missing') {
    return 'Readiness score is missing.';
  }
  if (code === 'readiness-below-threshold') {
    return 'Readiness score is below threshold.';
  }
  if (code === 'ci-coverage-unavailable') {
    return 'CI coverage signal is unavailable.';
  }
  if (code === 'ci-coverage-below-threshold') {
    return 'CI coverage is below threshold.';
  }
  return 'Snapshot freshness is stale.';
}

export function summarizeVerificationReasonCodes(reasonCodes: VerifiedAgentOutputReasonCode[] | undefined, limit = 2): string | null {
  if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) {
    return null;
  }
  const seen = new Set<VerifiedAgentOutputReasonCode>();
  const normalized: VerifiedAgentOutputReasonCode[] = [];
  for (const code of reasonCodes) {
    if (seen.has(code)) {
      continue;
    }
    seen.add(code);
    normalized.push(code);
  }
  if (normalized.length === 0) {
    return null;
  }
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const visible = normalized.slice(0, normalizedLimit).map((code) => mapVerificationReasonCode(code));
  const remaining = normalized.length - visible.length;
  if (remaining > 0) {
    return `${visible.join(' | ')} | +${remaining} more reason code(s).`;
  }
  return visible.join(' | ');
}

export function buildFreshnessPresentation(scope: 'Leaderboard' | 'Profile', freshness?: PayloadFreshness | null): FreshnessPresentation {
  if (!freshness) {
    return {
      headline: `${scope} freshness unavailable`,
      detail: 'Cache version, snapshot ID, and refresh metadata have not arrived yet.',
      timestamps: [],
      note: null,
      staleReasonCodes: [],
      staleReasonText: [],
      debugAttribution: null,
      isStale: false,
      tone: 'missing',
    };
  }

  const timestamps: FreshnessTimestampMarker[] = [];
  if (isIsoTimestamp(freshness.latestSnapshotScannedAt)) {
    timestamps.push({ label: 'Snapshot', iso: freshness.latestSnapshotScannedAt });
  }
  if (isIsoTimestamp(freshness.latestSuccessfulRefreshFinishedAt)) {
    timestamps.push({ label: 'Refresh finished', iso: freshness.latestSuccessfulRefreshFinishedAt });
  } else if (isIsoTimestamp(freshness.latestSuccessfulRefreshGeneratedAt)) {
    timestamps.push({ label: 'Refresh generated', iso: freshness.latestSuccessfulRefreshGeneratedAt });
  }

  const sourceLabel = freshness.source === 'server' ? 'server-backed payload' : 'static fallback payload';
  const staleReasonCodes = Array.isArray(freshness.staleReasons) ? freshness.staleReasons : [];
  const staleReasonText = summarizeFreshnessStaleReasons(staleReasonCodes);
  const isStale = freshness.isStale === true;
  const schemaVersion = freshness.schemaVersion?.trim() ? freshness.schemaVersion : 'n/a';
  const computedAt = freshness.computedAt ? formatFreshnessTimestamp(freshness.computedAt) : 'timestamp unavailable';
  return {
    headline: `${scope} freshness: ${sourceLabel}`,
    detail: `cache ${freshness.cacheVersion} | snapshot #${freshness.latestSnapshotId} | refresh run #${freshness.latestSuccessfulRefreshRunId}`,
    timestamps,
    note: freshness.note ?? null,
    staleReasonCodes,
    staleReasonText,
    debugAttribution: `schema ${schemaVersion} | computed ${computedAt}`,
    isStale,
    tone: isStale ? 'stale' : freshness.source === 'static-fallback' ? 'fallback' : 'server',
  };
}

function getFreshnessToneClasses(tone: FreshnessPresentation['tone']): string {
  if (tone === 'stale') {
    return 'border-rose-400/45 bg-rose-500/10 text-rose-100';
  }
  if (tone === 'server') {
    return 'border-emerald-400/35 bg-emerald-500/10 text-emerald-100';
  }
  if (tone === 'fallback') {
    return 'border-amber-400/45 bg-amber-400/10 text-amber-100';
  }
  return 'border-slate-700 bg-surface-2 text-ink-2';
}

export function buildVerificationPresentation(verification?: VerifiedAgentOutputStatus | null): VerificationPresentation {
  if (!verification) {
    return {
      state: 'unknown',
      label: 'Verification Unknown',
      reason: 'Verification payload is unavailable for this snapshot.',
      detail: null,
      toneClass: 'border-slate-700 bg-surface-2 text-ink-2',
    };
  }

  const readinessThreshold =
    typeof verification.readinessThreshold === 'number'
      ? verification.readinessThreshold
      : typeof verification.threshold === 'number'
        ? verification.threshold
        : null;
  const readinessDetail =
    typeof verification.readinessScore === 'number' && typeof readinessThreshold === 'number'
      ? `Readiness ${formatNumber(verification.readinessScore, 1)} / ${formatNumber(readinessThreshold, 0)}+`
      : null;
  const coverageDetail =
    typeof verification.ciCoverageRatio === 'number' && typeof verification.ciCoverageThreshold === 'number'
      ? `CI coverage ${formatPercent(verification.ciCoverageRatio)} / ${formatPercent(verification.ciCoverageThreshold)}+`
      : null;
  const detail = [readinessDetail, coverageDetail].filter((value): value is string => Boolean(value)).join(' | ') || null;
  const reasonFromCodes = summarizeVerificationReasonCodes(verification.reasonCodes, 2);
  const reason = compactReasonText(reasonFromCodes ?? verification.reason, 132);

  if (verification.state === 'verified') {
    return {
      state: verification.state,
      label: verification.label,
      reason,
      detail,
      toneClass: 'border-emerald-400/45 bg-emerald-500/10 text-emerald-100',
    };
  }
  if (verification.state === 'pending') {
    return {
      state: verification.state,
      label: verification.label,
      reason,
      detail,
      toneClass: 'border-amber-400/45 bg-amber-400/10 text-amber-100',
    };
  }
  return {
    state: verification.state,
    label: verification.label,
    reason,
    detail,
    toneClass: 'border-slate-700 bg-surface-2 text-ink-2',
  };
}

function buildRivalrySourceLabel(source: NonNullable<ProfileResponse['rivalry']>['source']): string {
  if (source === 'server') {
    return 'Source: server-backed rivalry payload';
  }
  return 'Source: fallback derived from profile history';
}

function buildRivalryTrendNarrative(
  rivalHandle: string,
  trend: NonNullable<ProfileResponse['rivalry']>['trend'],
  hasChallengeLink: boolean,
): string {
  const challengeNudge = hasChallengeLink
    ? `Challenge @${rivalHandle} now to lock in this momentum.`
    : 'Sign in to generate a challenge link for this matchup.';
  if (trend === 'closing') {
    return `You are closing on @${rivalHandle}. ${challengeNudge}`;
  }
  if (trend === 'widening') {
    return `@${rivalHandle} widened the gap in the latest snapshot. Ship a verified streak and answer back.`;
  }
  return `Gap is stable versus @${rivalHandle}. One strong scan-and-merge cycle can swing this rivalry.`;
}

function buildScanActionRecommendation(entry: LeaderboardEntry): { headline: string; detail: string } {
  if (entry.totals.mergedPrsUnverified > 0) {
    const ciCoverage = entry.totals.mergedPrsCiVerified / Math.max(1, entry.totals.mergedPrsUnverified);
    if (ciCoverage < 0.7) {
      return {
        headline: 'Increase CI verification coverage',
        detail: `Only ${Math.round(ciCoverage * 100)}% of merged PRs are CI-verified. Start with flaky/default-branch checks on your featured repo.`,
      };
    }
  }
  if (entry.totals.offHoursRatio > 0.45) {
    return {
      headline: 'Reduce off-hours concentration',
      detail: `Off-hours ratio is ${formatPercent(entry.totals.offHoursRatio)}. Shift merge windows toward core collaboration hours.`,
    };
  }
  if (entry.totals.velocityAcceleration < 0) {
    return {
      headline: 'Recover velocity acceleration',
      detail: 'Acceleration is negative in the latest window. Prioritize a weekly merge cadence on your highest-impact repo.',
    };
  }
  if (entry.totals.commitsPerDay < 1.5) {
    return {
      headline: 'Increase daily commit cadence',
      detail: 'Current commit cadence is low for this tier. Run a focused scan after your next active coding block.',
    };
  }
  return {
    headline: 'Run Mentat Scan to unlock next fix',
    detail: 'Throughput looks stable. Trigger a fresh repo scan to surface AI-readiness actions and bottlenecks.',
  };
}

function formatNextFixDetail(detail: string): string {
  const trimmed = detail.trim();
  if (!trimmed) {
    return 'Next fix: run Mentat Scan to generate a concrete next step.';
  }
  if (/^next fix:/i.test(trimmed)) {
    return trimmed;
  }
  return `Next fix: ${trimmed}`;
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
    const normalizedTier = clamp(Math.round(entry.stackTier), 0, OPERATING_STACK_LABELS.length - 1);
    return OPERATING_STACK_LABELS[normalizedTier];
  }
  if (entry.profile?.tier) {
    const tierMatch = entry.profile.tier.match(/tier\s*([0-3])/i);
    if (tierMatch) {
      const normalizedTier = clamp(Number(tierMatch[1]), 0, OPERATING_STACK_LABELS.length - 1);
      return OPERATING_STACK_LABELS[normalizedTier];
    }
    return entry.profile.tier;
  }
  if (percentile >= 0.9) {
    return 'Agent Swarm';
  }
  if (percentile >= 0.65) {
    return 'Single Agent';
  }
  if (percentile >= 0.35) {
    return 'Copilot User';
  }
  return 'Human Level';
}

function getTierBadge(tier: string): { label: string; className: string } {
  const normalizedTier = tier.toLowerCase();
  if (normalizedTier.includes('agent swarm')) {
    return {
      label: 'Agent Swarm',
      className: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-100',
    };
  }
  if (normalizedTier.includes('single agent')) {
    return {
      label: 'Single Agent',
      className: 'border-cyan-400/50 bg-cyan-500/10 text-cyan-100',
    };
  }
  if (normalizedTier.includes('copilot')) {
    return {
      label: 'Copilot User',
      className: 'border-sky-400/50 bg-sky-500/10 text-sky-100',
    };
  }
  return {
    label: 'Human Level',
    className: 'border-slate-600/90 bg-slate-900/60 text-ink-2',
  };
}

function getTrustBadge(state?: VerifiedAgentOutputStatus['state']): { label: string; className: string } {
  if (state === 'verified') {
    return {
      label: 'CI Trusted',
      className: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-100',
    };
  }
  if (state === 'pending') {
    return {
      label: 'Trust Pending',
      className: 'border-amber-400/50 bg-amber-400/10 text-amber-100',
    };
  }
  return {
    label: 'Trust Unknown',
    className: 'border-slate-600/90 bg-slate-900/60 text-ink-2',
  };
}

function hasZeroLeaderboardMetrics(entry: LeaderboardEntry): boolean {
  return entry.totals.equivalentEngineeringHours <= 0 && entry.totals.mergedPrsCiVerified <= 0;
}

function getRankTone(rank: number): { textClassName: string; badgeClassName: string } {
  if (rank === 1) {
    return {
      textClassName: 'text-amber-200',
      badgeClassName: 'border-amber-300/60 bg-amber-400/15 text-amber-100',
    };
  }
  if (rank === 2) {
    return {
      textClassName: 'text-slate-100',
      badgeClassName: 'border-slate-300/50 bg-slate-300/10 text-slate-100',
    };
  }
  if (rank === 3) {
    return {
      textClassName: 'text-orange-200',
      badgeClassName: 'border-orange-300/60 bg-orange-400/15 text-orange-100',
    };
  }
  return {
    textClassName: 'text-accent-2',
    badgeClassName: 'border-slate-700 bg-slate-900/60 text-ink-2',
  };
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
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname, window.location.search));
  const [leaderboard, setLeaderboard] = useState<LeaderboardArtifact | null>(null);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  const [isLeaderboardRefreshing, setIsLeaderboardRefreshing] = useState(false);
  const [lastLeaderboardRefreshAt, setLastLeaderboardRefreshAt] = useState<string | null>(null);
  const [scanRefreshHint, setScanRefreshHint] = useState<string | null>(null);
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
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [leaderboardHandleSearch, setLeaderboardHandleSearch] = useState('');
  const [leaderboardHandleSearchError, setLeaderboardHandleSearchError] = useState<string | null>(null);
  const profileVisitSignatureRef = useRef<string>('');
  const challengeTelemetrySignatureRef = useRef<string>('');
  const rivalryTelemetrySignatureRef = useRef<string>('');
  const scanPersistenceSignatureRef = useRef<string>('');
  const profileRefreshRequestIdRef = useRef(0);
  const shareFeedbackTimerRef = useRef<number | null>(null);

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

  const refreshLeaderboardArtifact = useCallback(
    async (source: string) => {
      setIsLeaderboardRefreshing(true);
      trackUxEvent('leaderboard_refresh_requested', { source });
      try {
        const result = await fetchLeaderboard();
        setLeaderboard(result);
        setLeaderboardError(null);
        const refreshedAt = new Date().toISOString();
        setLastLeaderboardRefreshAt(refreshedAt);
        setScanRefreshHint(null);
        trackUxEvent('leaderboard_refresh_completed', {
          source,
          entries: result.entries.length,
        });
      } catch (error) {
        const message = (error as Error).message;
        setLeaderboardError(message);
        setScanRefreshHint(message);
        trackUxEvent('leaderboard_refresh_failed', {
          source,
          reason: message,
        });
      } finally {
        setIsLeaderboardRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    void refreshLeaderboardArtifact('initial-load');
  }, [refreshLeaderboardArtifact]);

  const routeProfileHandle = route.kind === 'profile' ? route.handle : null;
  const refreshProfilePayload = useCallback(
    async (handle: string, source: string, options: { clearExisting?: boolean } = {}) => {
      const requestId = profileRefreshRequestIdRef.current + 1;
      profileRefreshRequestIdRef.current = requestId;
      const clearExisting = options.clearExisting === true;

      setIsProfileLoading(true);
      setProfileError(null);
      if (clearExisting) {
        setProfileData(null);
      }

      trackUxEvent('profile_refresh_requested', { source, handle });
      try {
        const profile = await fetchProfile(handle);
        if (profileRefreshRequestIdRef.current !== requestId) {
          return;
        }
        setProfileData(profile);
        setProfileError(null);
        trackUxEvent('profile_refresh_completed', { source, handle });
      } catch (error) {
        if (profileRefreshRequestIdRef.current !== requestId) {
          return;
        }
        const message = (error as Error).message;
        if (clearExisting) {
          setProfileData(null);
        }
        setProfileError(message);
        trackUxEvent('profile_refresh_failed', {
          source,
          handle,
          reason: message,
        });
      } finally {
        if (profileRefreshRequestIdRef.current === requestId) {
          setIsProfileLoading(false);
        }
      }
    },
    [],
  );
  const recoverStaleProfileContext = useCallback(() => {
    if (!routeProfileHandle) {
      return;
    }
    void refreshProfilePayload(routeProfileHandle, 'profile-stale-recovery');
    void refreshLeaderboardArtifact('profile-stale-recovery');
  }, [refreshLeaderboardArtifact, refreshProfilePayload, routeProfileHandle]);

  useEffect(() => {
    if (!routeProfileHandle) {
      profileRefreshRequestIdRef.current += 1;
      setProfileData(null);
      setProfileError(null);
      setIsProfileLoading(false);
      setLastProfileVisit(null);
      setProfileWeeklyStreak(1);
      return;
    }
    void refreshProfilePayload(routeProfileHandle, 'route-profile-load', { clearExisting: true });
  }, [refreshProfilePayload, routeProfileHandle]);

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseRoute(window.location.pathname, window.location.search));
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

  const setTransientShareFeedback = useCallback((message: string | null) => {
    setShareFeedback(message);
    if (shareFeedbackTimerRef.current !== null) {
      window.clearTimeout(shareFeedbackTimerRef.current);
      shareFeedbackTimerRef.current = null;
    }
    if (message) {
      shareFeedbackTimerRef.current = window.setTimeout(() => {
        setShareFeedback(null);
        shareFeedbackTimerRef.current = null;
      }, 2400);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (shareFeedbackTimerRef.current !== null) {
        window.clearTimeout(shareFeedbackTimerRef.current);
      }
    };
  }, []);

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
  const profileScanAction = useMemo(() => (profileEntry ? buildScanActionRecommendation(profileEntry) : null), [profileEntry]);
  const profileScanTargetRepoUrl = profileEntry?.featuredRepo ?? profileEntry?.repos[0]?.repo.url ?? null;

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
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (nextPath !== currentPath) {
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

  function startScanFromRepo(repoUrl: string, source: string) {
    setRepoInput(repoUrl);
    setScanError(null);
    setView('scan');
    navigate({ kind: 'home' });
    trackUxEvent('scan_hook_clicked', {
      source,
      repoUrl,
      signedIn: Boolean(authIdentity),
    });
  }

  function openProfile(handle: string, options: { challengeTargetHandle?: string | null } = {}) {
    navigate({
      kind: 'profile',
      handle: handle.toLowerCase(),
      challengeTargetHandle: options.challengeTargetHandle ?? null,
      hasInvalidChallengeQuery: false,
    });
  }

  function onLeaderboardSearchSubmit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = normalizeHandle(leaderboardHandleSearch.trim().replace(/^@+/, ''));
    if (!normalized) {
      setLeaderboardHandleSearchError('Enter a valid GitHub handle.');
      trackUxEvent('leaderboard_handle_search_invalid', {
        source: 'home_hero',
      });
      return;
    }

    setLeaderboardHandleSearchError(null);
    trackUxEvent('leaderboard_handle_search_submitted', {
      source: 'home_hero',
      handle: normalized,
    });
    openProfile(normalized);
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
      const persistence = result.persistence;
      trackUxEvent('scan_completed', {
        repo: `${result.repo.owner}/${result.repo.name}`,
        equivalentEngineeringHours: result.metrics.equivalentEngineeringHours,
        mergedPrsCiVerified: result.metrics.mergedPrs,
        canonicalPersisted: Boolean(persistence?.canonicalLeaderboardWrite),
        persistenceReason: persistence?.reason ?? 'missing',
      });
      if (persistence?.canonicalLeaderboardWrite) {
        void refreshLeaderboardArtifact('scan-auto-refresh');
      }
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

  const copyLinkToClipboard = useCallback(async (url: string): Promise<boolean> => {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      return false;
    }
    try {
      await navigator.clipboard.writeText(url);
      return true;
    } catch {
      return false;
    }
  }, []);

  const triggerOutboundShare = useCallback(
    async (params: {
      event: string;
      source: string;
      title: string;
      text: string;
      url: string;
      handle?: string;
      challenger?: string;
      target?: string;
    }) => {
      if (typeof navigator.share === 'function') {
        try {
          await navigator.share({
            title: params.title,
            text: params.text,
            url: params.url,
          });
          trackUxEvent(params.event, {
            source: params.source,
            channel: 'native',
            handle: params.handle ?? null,
            challenger: params.challenger ?? null,
            target: params.target ?? null,
          });
          setTransientShareFeedback('Shared via native dialog.');
          return;
        } catch (error) {
          if ((error as Error).name === 'AbortError') {
            trackUxEvent(params.event, {
              source: params.source,
              channel: 'native-cancelled',
              handle: params.handle ?? null,
              challenger: params.challenger ?? null,
              target: params.target ?? null,
            });
            return;
          }
        }
      }

      const copied = await copyLinkToClipboard(params.url);
      if (copied) {
        trackUxEvent(params.event, {
          source: params.source,
          channel: 'copy-fallback',
          handle: params.handle ?? null,
          challenger: params.challenger ?? null,
          target: params.target ?? null,
        });
        setTransientShareFeedback('Link copied to clipboard.');
        return;
      }

      window.open(buildTweetIntentUrl(params.text, params.url), '_blank', 'noopener,noreferrer');
      trackUxEvent(params.event, {
        source: params.source,
        channel: 'x-fallback',
        handle: params.handle ?? null,
        challenger: params.challenger ?? null,
        target: params.target ?? null,
      });
      setTransientShareFeedback('Opened fallback share on X.');
    },
    [copyLinkToClipboard, setTransientShareFeedback],
  );

  const copyShareLink = useCallback(
    async (params: { event: string; source: string; url: string; handle?: string; challenger?: string; target?: string }) => {
      const copied = await copyLinkToClipboard(params.url);
      trackUxEvent(params.event, {
        source: params.source,
        channel: 'copy-link',
        success: copied,
        handle: params.handle ?? null,
        challenger: params.challenger ?? null,
        target: params.target ?? null,
      });
      setTransientShareFeedback(copied ? 'Link copied to clipboard.' : 'Clipboard unavailable on this device.');
    },
    [copyLinkToClipboard, setTransientShareFeedback],
  );

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
  const debugEnabled = isDebugEnabled(window.location.search);
  const challengeActorHandle = authIdentity?.handle ?? profileEntry?.handle ?? null;
  const currentActorHandleForTelemetry = challengeActorHandle ?? 'unclaimed';
  const inviteShareUrl = `${appOrigin}/`;
  const routeChallengeTargetHandle = route.kind === 'profile' ? route.challengeTargetHandle : null;
  const challengeTargetEntry = useMemo(() => {
    if (!routeChallengeTargetHandle) {
      return null;
    }
    return sortedEntries.find((entry) => entry.handle === routeChallengeTargetHandle) ?? null;
  }, [routeChallengeTargetHandle, sortedEntries]);
  const profileChallengeComparison = useMemo(() => {
    if (!profileEntry || !challengeTargetEntry) {
      return null;
    }
    return {
      eehDelta: profileEntry.totals.equivalentEngineeringHours - challengeTargetEntry.totals.equivalentEngineeringHours,
      ciPrDelta: profileEntry.totals.mergedPrsCiVerified - challengeTargetEntry.totals.mergedPrsCiVerified,
      accelerationDelta: profileEntry.totals.velocityAcceleration - challengeTargetEntry.totals.velocityAcceleration,
    };
  }, [challengeTargetEntry, profileEntry]);
  const profileShareUrl = profileEntry ? buildProfileUrl(appOrigin, profileEntry.handle) : null;
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
  const scanChallengeUrl =
    scanResult && scanComparisonEntry && challengeActorHandle
      ? buildChallengeLink(appOrigin, challengeActorHandle, scanComparisonEntry.handle)
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
  const scanPersistenceSummary = useMemo(() => {
    if (!scanResult) {
      return null;
    }
    const persistence = scanResult.persistence;
    if (!persistence) {
      return {
        tone: 'border-slate-700/80 bg-slate-900/50 text-ink-2',
        heading: 'Canonical persistence status unavailable',
        detail: 'This response did not include persistence metadata. Ranking impact remains unverified.',
      };
    }
    if (persistence.canonicalLeaderboardWrite && persistence.reason === 'persisted') {
      return {
        tone: 'border-emerald-400/45 bg-emerald-500/10 text-emerald-100',
        heading: `Canonical leaderboard write confirmed for @${persistence.ownerHandle}`,
        detail: 'This scan can influence trusted ranking once the leaderboard snapshot refreshes.',
      };
    }
    if (persistence.reason === 'unauthenticated') {
      return {
        tone: 'border-amber-400/50 bg-amber-400/10 text-amber-100',
        heading: 'Scan completed, but canonical write was skipped',
        detail: `Sign in as @${persistence.ownerHandle} to persist this repo owner into canonical leaderboard ranking.`,
      };
    }
    if (persistence.reason === 'owner-mismatch') {
      return {
        tone: 'border-amber-400/50 bg-amber-400/10 text-amber-100',
        heading: 'Scan completed under the wrong identity',
        detail: `Signed in as @${persistence.actorHandle ?? 'unknown'}, but canonical owner is @${persistence.ownerHandle}.`,
      };
    }
    return {
      tone: 'border-rose-400/45 bg-rose-500/10 text-rose-100',
      heading: 'Canonical write unavailable',
      detail: 'Persistence backend was unavailable, so ranking impact was not recorded.',
    };
  }, [scanResult]);
  const rivalryProgression = useMemo<NonNullable<ProfileResponse['rivalry']> | null>(() => {
    if (!profileEntry) {
      return null;
    }
    if (profileData?.rivalry) {
      return profileData.rivalry;
    }
    if (!profileRival || !profileData || profileData.history.length < 2) {
      return null;
    }
    const latest = profileData.history[0];
    const previous = profileData.history[1];
    const rankDelta = previous.rank - latest.rank;
    const eehDelta = latest.equivalentEngineeringHours - previous.equivalentEngineeringHours;
    const trend = rankDelta > 0 || eehDelta > 0 ? 'closing' : rankDelta < 0 || eehDelta < 0 ? 'widening' : 'stable';
    return {
      rivalHandle: profileRival.handle,
      source: 'history-derived',
      capturedAt: latest.capturedAt,
      trend,
      rankDelta,
      equivalentEngineeringHoursDelta: eehDelta,
      currentGapEquivalentEngineeringHours: profileEntry.totals.equivalentEngineeringHours - profileRival.totals.equivalentEngineeringHours,
      currentGapRank: profileRival.rank - profileEntry.rank,
    };
  }, [profileData, profileEntry, profileRival]);
  const rivalryTargetHandle = rivalryProgression?.rivalHandle ?? profileRival?.handle ?? null;
  const profileChallengeTargetHandle = rivalryTargetHandle;
  const profileChallengeUrl =
    profileEntry && challengeActorHandle && profileChallengeTargetHandle
      ? buildChallengeLink(appOrigin, challengeActorHandle, profileChallengeTargetHandle)
      : null;
  const profileRivalrySourceLabel = rivalryProgression ? buildRivalrySourceLabel(rivalryProgression.source) : null;
  const profileRivalryNarrative = rivalryProgression
    ? buildRivalryTrendNarrative(rivalryProgression.rivalHandle, rivalryProgression.trend, Boolean(profileChallengeUrl))
    : null;
  const leaderboardFreshness = leaderboard?.freshness ?? null;
  const leaderboardFreshnessPresentation = useMemo(
    () => buildFreshnessPresentation('Leaderboard', leaderboardFreshness),
    [leaderboardFreshness],
  );
  const profileFreshness = profileData?.freshness ?? leaderboardFreshness;
  const profileFreshnessPresentation = useMemo(
    () => buildFreshnessPresentation('Profile', profileFreshness),
    [profileFreshness],
  );
  const profileFreshnessIsStale = profileFreshnessPresentation.isStale;
  const profileFreshnessFallbackNote =
    profileData?.freshness || !profileFreshness
      ? null
      : 'Profile freshness is temporarily using the leaderboard payload fallback.';
  const profileVerificationPresentation = useMemo(
    () => buildVerificationPresentation(profileEntry?.trust?.verification),
    [profileEntry?.trust?.verification],
  );
  const profileAnomalySummary = useMemo(() => summarizeAnomalies(profileEntry?.trust?.anomalies, 4), [profileEntry?.trust?.anomalies]);

  useEffect(() => {
    if (route.kind !== 'profile') {
      challengeTelemetrySignatureRef.current = '';
      return;
    }
    const resolution = resolveChallengeDeepLinkResolution({
      route,
      challengerHandle: profileEntry?.handle ?? null,
      targetHandle: challengeTargetEntry?.handle ?? null,
    });
    if (resolution === 'none') {
      challengeTelemetrySignatureRef.current = '';
      return;
    }
    const signature = `${route.handle}:${route.challengeTargetHandle ?? 'none'}:${Number(route.hasInvalidChallengeQuery)}:${resolution}`;
    if (challengeTelemetrySignatureRef.current === signature) {
      return;
    }
    challengeTelemetrySignatureRef.current = signature;
    trackUxEvent('challenge_deep_link_resolved', {
      challenger: route.handle,
      target: route.challengeTargetHandle ?? null,
      resolution,
      signedIn: Boolean(authIdentity),
    });
  }, [authIdentity, challengeTargetEntry, profileEntry, route]);

  useEffect(() => {
    if (route.kind !== 'profile' || !rivalryProgression) {
      rivalryTelemetrySignatureRef.current = '';
      return;
    }
    const signature = `${profileEntry?.handle ?? 'none'}:${rivalryProgression.rivalHandle}:${rivalryProgression.capturedAt}:${rivalryProgression.trend}`;
    if (rivalryTelemetrySignatureRef.current === signature) {
      return;
    }
    rivalryTelemetrySignatureRef.current = signature;
    trackUxEvent('rivalry_progression_viewed', {
      handle: profileEntry?.handle ?? route.handle,
      rival: rivalryProgression.rivalHandle,
      source: rivalryProgression.source,
      trend: rivalryProgression.trend,
    });
  }, [profileEntry, route, rivalryProgression]);

  useEffect(() => {
    if (!scanResult || !scanPersistenceSummary) {
      scanPersistenceSignatureRef.current = '';
      return;
    }
    const signature = `${scanResult.scannedAt}:${scanResult.persistence?.reason ?? 'missing'}:${Number(scanResult.persistence?.canonicalLeaderboardWrite)}`;
    if (scanPersistenceSignatureRef.current === signature) {
      return;
    }
    scanPersistenceSignatureRef.current = signature;
    trackUxEvent('scan_persistence_status_viewed', {
      reason: scanResult.persistence?.reason ?? 'missing',
      canonicalPersisted: Boolean(scanResult.persistence?.canonicalLeaderboardWrite),
    });
  }, [scanPersistenceSummary, scanResult]);

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
        {shareFeedback ? (
          <p className="mb-4 rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-xs font-mono text-cyan-100">{shareFeedback}</p>
        ) : null}
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
                        Operating Stack: {profileTier}
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
                  {profileShareUrl ? (
                    <>
                      <button
                        className="min-h-11 rounded-lg border border-cyan-400/60 bg-cyan-500/10 px-3 py-2 text-xs font-mono text-cyan-100 hover:bg-cyan-500/20"
                        onClick={() =>
                          void triggerOutboundShare({
                            event: 'profile_share_clicked',
                            source: 'profile_header',
                            handle: profileEntry.handle,
                            title: 'Mentat Velocity Profile',
                            text: `My Mentat Velocity snapshot: #${globalRank ?? profileEntry.rank}, ${formatNumber(profileEntry.totals.equivalentEngineeringHours, 1)} EEH in 30d.`,
                            url: profileShareUrl,
                          })
                        }
                        type="button"
                      >
                        Share Profile
                      </button>
                      <button
                        className="min-h-11 rounded-lg border border-cyan-400/40 px-3 py-2 text-xs font-mono text-cyan-100 hover:bg-cyan-500/15"
                        onClick={() =>
                          void copyShareLink({
                            event: 'profile_share_clicked',
                            source: 'profile_header',
                            handle: profileEntry.handle,
                            url: profileShareUrl,
                          })
                        }
                        type="button"
                      >
                        Copy Link
                      </button>
                    </>
                  ) : null}
                  {profileChallengeUrl && profileChallengeTargetHandle ? (
                    <>
                      <button
                        className="min-h-11 rounded-lg border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-xs font-mono text-amber-100 hover:bg-amber-400/20"
                        onClick={() =>
                          void triggerOutboundShare({
                            event: 'challenge_link_clicked',
                            source: 'profile_header',
                            challenger: currentActorHandleForTelemetry,
                            target: profileChallengeTargetHandle,
                            title: 'Mentat Velocity Challenge',
                            text: `I challenge @${profileChallengeTargetHandle} on Mentat Velocity. Compare our trusted throughput.`,
                            url: profileChallengeUrl,
                          })
                        }
                        type="button"
                      >
                        Challenge @{profileChallengeTargetHandle}
                      </button>
                      <button
                        className="min-h-11 rounded-lg border border-amber-400/40 px-3 py-2 text-xs font-mono text-amber-100 hover:bg-amber-400/12"
                        onClick={() =>
                          void copyShareLink({
                            event: 'challenge_link_clicked',
                            source: 'profile_header',
                            challenger: currentActorHandleForTelemetry,
                            target: profileChallengeTargetHandle,
                            url: profileChallengeUrl,
                          })
                        }
                        type="button"
                      >
                        Copy Challenge
                      </button>
                    </>
                  ) : challengeActorHandle === null ? (
                    <a
                      className="min-h-11 inline-flex items-center rounded-lg border border-amber-400/40 px-3 py-2 text-xs font-mono text-amber-100 hover:bg-amber-400/10"
                      href="/api/auth/github/start"
                      onClick={() => trackUxEvent('claim_profile_clicked', { source: 'profile_header_challenge_gate', signedIn: false })}
                    >
                      Sign in to Challenge
                    </a>
                  ) : (
                    <span className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-mono text-ink-3">Challenge link unavailable: no comparable rival yet.</span>
                  )}
                  <button
                    className="min-h-11 rounded-lg border border-slate-600 px-3 py-2 text-xs font-mono text-ink-2 hover:border-cyan-400 hover:text-ink-1"
                    onClick={() =>
                      void triggerOutboundShare({
                        event: 'invite_link_clicked',
                        source: 'profile_header',
                        handle: profileEntry.handle,
                        title: 'Mentat Velocity',
                        text: 'Track AI-verified throughput and challenge me on Mentat Velocity.',
                        url: inviteShareUrl,
                      })
                    }
                    type="button"
                  >
                    Invite Peer
                  </button>
                  <button
                    className="min-h-11 rounded-lg border border-slate-600 px-3 py-2 text-xs font-mono text-ink-2 hover:border-cyan-400 hover:text-ink-1"
                    onClick={() =>
                      void copyShareLink({
                        event: 'invite_link_clicked',
                        source: 'profile_header',
                        handle: profileEntry.handle,
                        url: inviteShareUrl,
                      })
                    }
                    type="button"
                  >
                    Copy Invite Link
                  </button>
                </div>
                {route.hasInvalidChallengeQuery ? (
                  <p className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
                    Challenge link was invalid. Use “Copy Challenge” to generate a valid compare URL.
                  </p>
                ) : null}
                {route.challengeTargetHandle ? (
                  challengeTargetEntry && challengeTargetEntry.handle !== profileEntry.handle && profileChallengeComparison ? (
                    <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
                      <p className="font-mono text-xs uppercase tracking-[0.08em] text-amber-100">Challenge Matchup</p>
                      <p className="mt-1 text-sm text-amber-100">
                        @{profileEntry.handle} vs @{challengeTargetEntry.handle}
                      </p>
                      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                        <p className="rounded border border-amber-400/40 px-2 py-1 text-xs text-amber-100">
                          EEH delta {formatSignedDelta(profileChallengeComparison.eehDelta, 1)}
                        </p>
                        <p className="rounded border border-amber-400/40 px-2 py-1 text-xs text-amber-100">
                          CI PR delta {formatSignedDelta(profileChallengeComparison.ciPrDelta, 0)}
                        </p>
                        <p className="rounded border border-amber-400/40 px-2 py-1 text-xs text-amber-100">
                          Accel delta {formatAcceleration(profileChallengeComparison.accelerationDelta)}
                        </p>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          className="min-h-11 rounded-md border border-amber-300/60 bg-amber-400/20 px-3 py-2 text-xs font-mono text-amber-100 hover:bg-amber-400/30"
                          onClick={() => openProfile(challengeTargetEntry.handle)}
                          type="button"
                        >
                          Open @{challengeTargetEntry.handle}
                        </button>
                        {challengeActorHandle ? (
                          <button
                            className="min-h-11 rounded-md border border-amber-300/60 px-3 py-2 text-xs font-mono text-amber-100 hover:bg-amber-400/18"
                            onClick={() =>
                              void copyShareLink({
                                event: 'challenge_link_clicked',
                                source: 'challenge_deeplink_panel',
                                challenger: currentActorHandleForTelemetry,
                                target: challengeTargetEntry.handle,
                                url: buildChallengeLink(appOrigin, challengeActorHandle, challengeTargetEntry.handle) ?? buildProfileUrl(appOrigin, profileEntry.handle),
                              })
                            }
                            type="button"
                          >
                            Copy Challenge Link
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-100">
                      Challenge target @{route.challengeTargetHandle} is not available in the current leaderboard snapshot.
                    </p>
                  )
                ) : null}
                <p className="mt-4 max-w-4xl rounded-lg border border-slate-700 bg-surface-2 px-3 py-2 text-xs leading-relaxed text-ink-2">{profileAttributionSummary}</p>
                <div className={`mt-3 rounded-lg border p-3 text-xs ${getFreshnessToneClasses(profileFreshnessPresentation.tone)}`}>
                  <p className="font-mono uppercase tracking-[0.08em]">{profileFreshnessPresentation.headline}</p>
                  <p className="mt-1">{profileFreshnessPresentation.detail}</p>
                  {profileFreshnessPresentation.timestamps.length > 0 ? (
                    <p className="mt-1 font-mono">
                      Latest:{' '}
                      {profileFreshnessPresentation.timestamps
                        .map((marker) => `${marker.label} ${formatFreshnessTimestamp(marker.iso)}`)
                        .join(' | ')}
                    </p>
                  ) : (
                    <p className="mt-1">Latest snapshot and refresh timestamps are not available in this payload.</p>
                  )}
                  {profileFreshnessFallbackNote ? <p className="mt-1">{profileFreshnessFallbackNote}</p> : null}
                  {profileFreshnessPresentation.note ? <p className="mt-1">Note: {profileFreshnessPresentation.note}</p> : null}
                  {profileFreshnessPresentation.isStale ? (
                    <div className="mt-2 rounded-md border border-rose-300/60 bg-rose-500/15 p-2 text-rose-100">
                      <p className="font-mono uppercase tracking-[0.08em]">Stale Snapshot Warning</p>
                      <p className="mt-1">
                        Profile progression may lag the latest backend state until a fresh snapshot is loaded.
                      </p>
                      {profileFreshnessPresentation.staleReasonText.length > 0 ? (
                        <p className="mt-1">Reasons: {profileFreshnessPresentation.staleReasonText.join(' | ')}</p>
                      ) : (
                        <p className="mt-1">Reason codes were not provided by the payload.</p>
                      )}
                      <button
                        className="mt-2 min-h-11 rounded-md border border-rose-300/70 bg-rose-400/20 px-3 py-2 font-mono text-[11px] text-rose-100 hover:bg-rose-400/30 disabled:opacity-60"
                        disabled={isProfileLoading || isLeaderboardRefreshing}
                        onClick={() => recoverStaleProfileContext()}
                        type="button"
                      >
                        {isProfileLoading || isLeaderboardRefreshing ? 'Refreshing Context...' : 'Refresh Profile Context'}
                      </button>
                    </div>
                  ) : null}
                  {debugEnabled && profileFreshnessPresentation.debugAttribution ? (
                    <p className="mt-2 font-mono text-[11px] text-ink-2">Debug: {profileFreshnessPresentation.debugAttribution}</p>
                  ) : null}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <div className={`rounded-lg border p-3 ${profileVerificationPresentation.toneClass}`}>
                    <p className="font-mono text-xs uppercase tracking-[0.08em]">Verified Agent Output</p>
                    <p className="mt-1 text-sm">{profileVerificationPresentation.label}</p>
                    <p className="mt-1 text-xs">{profileVerificationPresentation.reason}</p>
                    {profileVerificationPresentation.detail ? (
                      <p className="mt-2 rounded border border-white/20 px-2 py-1 text-[11px]">{profileVerificationPresentation.detail}</p>
                    ) : null}
                  </div>
                  <div className="rounded-lg border border-slate-700 bg-surface-2 p-3">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-3">Anomaly Flags</p>
                    {profileAnomalySummary.visible.length > 0 ? (
                      <div className="mt-2 space-y-2">
                        {profileAnomalySummary.visible.map((flag) => (
                          <div key={`${flag.key}-${flag.reason}`} className={`rounded border px-2 py-1 text-xs ${getAnomalySeverityToneClasses(flag.severity)}`}>
                            <p className="font-mono uppercase tracking-[0.08em]">
                              Severity {flag.severity.toUpperCase()} | {flag.label}
                            </p>
                            <p className="mt-1">{compactReasonText(flag.reason, 116)}</p>
                          </div>
                        ))}
                        {profileAnomalySummary.remaining > 0 ? (
                          <p className="text-xs text-ink-3">+{profileAnomalySummary.remaining} more anomaly flag(s) in payload.</p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-ink-2">No anomaly flags in the latest trust payload.</p>
                    )}
                  </div>
                </div>
                {profileScanAction ? (
                  <div className="mt-3 rounded-lg border border-cyan-400/40 bg-cyan-500/10 p-3">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-cyan-100">Velocity to Scan Action Loop</p>
                    <p className="mt-1 text-sm text-cyan-100">{profileScanAction.headline}</p>
                    <p className="mt-1 text-xs text-cyan-100/90">{profileScanAction.detail}</p>
                    <p className="mt-2 text-xs text-cyan-100/85">
                      AI-readiness remains trust-labeled until repo-level Scan payloads are connected.
                    </p>
                    {profileScanTargetRepoUrl ? (
                      <button
                        className="mt-3 min-h-11 rounded-md border border-cyan-300/60 bg-cyan-500/20 px-3 py-2 text-xs font-mono text-cyan-100 hover:bg-cyan-500/30"
                        onClick={() => startScanFromRepo(profileScanTargetRepoUrl, 'profile_action_loop')}
                        type="button"
                      >
                        Scan Featured Repo For Next Fix
                      </button>
                    ) : (
                      <p className="mt-2 text-xs text-cyan-100/80">No featured repo URL is available yet for this profile.</p>
                    )}
                  </div>
                ) : null}

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
                  <div className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 p-3 lg:col-span-3">
                    <p className="font-mono text-xs uppercase tracking-[0.08em] text-cyan-100">Rivalry Progression</p>
                    {rivalryProgression ? (
                      <>
                        <p className="mt-1 text-sm text-cyan-100">{profileRivalryNarrative}</p>
                        {profileFreshnessIsStale ? (
                          <div className="mt-2 rounded border border-amber-300/60 bg-amber-400/20 px-2 py-2 text-xs text-amber-100">
                            <p className="font-mono uppercase tracking-[0.08em]">Potentially Stale Rivalry Context</p>
                            <p className="mt-1">Progression swing may be outdated. Refresh profile context to validate latest rank and EEH gaps.</p>
                            <button
                              className="mt-2 min-h-11 rounded-md border border-amber-300/70 bg-amber-400/20 px-3 py-2 font-mono text-[11px] text-amber-100 hover:bg-amber-400/30 disabled:opacity-60"
                              disabled={isProfileLoading || isLeaderboardRefreshing}
                              onClick={() => recoverStaleProfileContext()}
                              type="button"
                            >
                              {isProfileLoading || isLeaderboardRefreshing ? 'Refreshing Context...' : 'Refresh Rivalry Context'}
                            </button>
                          </div>
                        ) : null}
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <p className="rounded border border-cyan-300/40 px-2 py-1 text-xs text-cyan-100">
                            Rank swing {formatSignedDelta(rivalryProgression.rankDelta, 0)}
                          </p>
                          <p className="rounded border border-cyan-300/40 px-2 py-1 text-xs text-cyan-100">
                            EEH swing {formatSignedDelta(rivalryProgression.equivalentEngineeringHoursDelta, 1)}
                          </p>
                          <p className="rounded border border-cyan-300/40 px-2 py-1 text-xs text-cyan-100">
                            Current EEH gap {formatSignedDelta(rivalryProgression.currentGapEquivalentEngineeringHours, 1)}
                          </p>
                        </div>
                        <p className="mt-2 font-mono text-xs text-cyan-200">
                          {profileRivalrySourceLabel} | Captured {new Date(rivalryProgression.capturedAt).toLocaleString()}
                        </p>
                        {rivalryProgression.source === 'history-derived' ? (
                          <p className="mt-1 text-xs text-cyan-100/85">
                            Server rivalry data is missing, so this view is using a local history fallback.
                          </p>
                        ) : null}
                        {profileChallengeUrl && profileChallengeTargetHandle ? (
                          <p className="mt-1 text-xs text-cyan-100/85">
                            Challenge/share nudge: use the "Challenge @{profileChallengeTargetHandle}" action above to publish this matchup.
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <p className="mt-1 text-sm text-cyan-100">
                        Server rivalry payload is not available yet. Fallback needs at least two profile history snapshots to render progression.
                      </p>
                    )}
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
                        const repoAiReady = typeof profileEntry.aiReadyScore === 'number' ? profileEntry.aiReadyScore : null;
                        const repoActionInsight =
                          profileEntry.scanInsight ?? profileScanAction?.detail ?? 'Run Mentat Scan to generate a concrete next fix for this repo.';
                        const repoTrustLabel =
                          repoCard.attribution.mode === 'handle-authored'
                            ? `Strict attribution (@${repoCard.attribution.targetHandle ?? profileEntry.handle})`
                            : 'Repo-wide attribution (non-bot default-branch activity)';
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
                                <p className="font-mono text-sm text-ink-2">{repoAiReady === null ? 'Trust-labeled pending Scan payload' : `${repoAiReady}%`}</p>
                              </div>
                            </div>
                            <p className="mt-2 rounded border border-slate-700 px-2 py-1 text-xs text-ink-2">Trust context: {repoTrustLabel}</p>
                            <p className="mt-2 rounded border border-cyan-400/35 bg-cyan-500/10 px-2 py-1 text-xs text-cyan-100">
                              {formatNextFixDetail(repoActionInsight)}
                            </p>
                            <button
                              className="mt-2 min-h-11 rounded border border-cyan-400/50 bg-cyan-500/10 px-3 py-2 text-xs font-mono text-cyan-100 hover:bg-cyan-500/20"
                              onClick={() => startScanFromRepo(repoCard.repo.url, 'profile_repo_card')}
                              type="button"
                            >
                              Run Mentat Scan On This Repo
                            </button>
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
              {route.challengeTargetHandle && challengeTargetEntry ? (
                <p className="mt-2 text-sm text-ink-2">
                  Challenge link target @{challengeTargetEntry.handle} is valid, but challenger profile @{route.handle} is not claimable yet.
                </p>
              ) : (
                <p className="mt-2 text-sm text-ink-2">
                  No seeded profile matched @{route.handle}. Choose a handle from the leaderboard.
                </p>
              )}
              {route.hasInvalidChallengeQuery ? (
                <p className="mt-2 text-sm text-amber-200">Challenge query was invalid and could not be resolved.</p>
              ) : null}
              {profileError ? <p className="mt-2 text-sm text-state-warning">Profile API: {profileError}</p> : null}
              <div className="mt-4 flex flex-wrap gap-2">
                {route.challengeTargetHandle && challengeTargetEntry ? (
                  <button
                    className="min-h-11 rounded-lg border border-cyan-400/50 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20"
                    onClick={() => openProfile(challengeTargetEntry.handle)}
                    type="button"
                  >
                    Open @{challengeTargetEntry.handle}
                  </button>
                ) : null}
                {!authIdentity ? (
                  <a
                    className="min-h-11 inline-flex items-center rounded-lg border border-amber-400/40 px-3 py-2 text-sm text-amber-100 hover:bg-amber-400/10"
                    href="/api/auth/github/start"
                    onClick={() => trackUxEvent('claim_profile_clicked', { source: 'challenge_not_found_gate', signedIn: false })}
                  >
                    Claim Profile to Challenge
                  </a>
                ) : null}
                <button
                  className="min-h-11 rounded-lg border border-slate-700 px-3 py-2 text-sm text-ink-2 hover:border-cyan-400 hover:text-ink-1"
                  onClick={() => goHome('leaderboard')}
                  type="button"
                >
                  Return to leaderboard
                </button>
              </div>
            </section>
          )
        ) : (
          <div className="space-y-6">
            <section className="relative overflow-hidden rounded-xl border border-cyan-400/25 bg-slate-950/70 p-5 text-center shadow-soft md:p-8">
              <div className="pointer-events-none absolute left-1/2 top-0 h-40 w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/20 blur-3xl" />
              <div className="relative">
                <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-cyan-200/90">Public Velocity Arena</p>
                <div className="mx-auto mt-4 mb-5 flex w-fit items-center gap-2 rounded-lg border border-slate-700/80 bg-surface-2/90 p-1">
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
              <h2 className="relative font-display text-3xl leading-tight sm:text-5xl">Velocity Leaderboard</h2>
              <p className="relative mt-2 text-base text-ink-1">{HERO_SEARCH_PROMPT}</p>
              <form className="relative mx-auto mt-6 flex w-full max-w-2xl flex-col gap-3 sm:flex-row" onSubmit={onLeaderboardSearchSubmit}>
                <input
                  aria-label="GitHub handle search"
                  className="h-11 w-full rounded-lg border border-cyan-300/50 bg-slate-950/80 px-3 text-sm text-ink-1 outline-none transition focus:border-cyan-200 focus:ring-2 focus:ring-cyan-300/30"
                  onChange={(event) => {
                    setLeaderboardHandleSearch(event.target.value);
                    if (leaderboardHandleSearchError) {
                      setLeaderboardHandleSearchError(null);
                    }
                  }}
                  placeholder="@octocat"
                  value={leaderboardHandleSearch}
                />
                <button
                  className="h-11 rounded-lg bg-gradient-to-r from-cyan-400 to-sky-500 px-5 text-sm font-semibold text-slate-950 shadow-[0_8px_24px_rgba(34,211,238,0.35)] transition hover:brightness-105"
                  type="submit"
                >
                  Search Velocity
                </button>
              </form>
              {leaderboardHandleSearchError ? <p className="mt-2 text-sm text-state-warning">{leaderboardHandleSearchError}</p> : null}
              {!authIdentity ? (
                <a
                  className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg border border-cyan-300/70 bg-cyan-500/20 px-5 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/30"
                  href="/api/auth/github/start"
                  onClick={() => trackUxEvent('claim_profile_clicked', { source: 'home_hero', signedIn: false })}
                >
                  {HERO_PRIMARY_CTA_LABEL}
                </a>
              ) : (
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <button
                    className="min-h-11 rounded-lg border border-cyan-400/60 bg-cyan-500/15 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/25"
                    onClick={() => openProfile(authIdentity.handle)}
                    type="button"
                  >
                    Open @{authIdentity.handle}
                  </button>
                  <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 font-mono text-xs text-emerald-200">
                    GitHub connected
                  </span>
                </div>
              )}
            </section>

              {view === 'leaderboard' ? (
                <section className="rounded-xl border border-slate-700/80 bg-surface-1 p-4 shadow-soft md:p-6">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="font-display text-xl">Rankings</h3>
                      <p className="text-sm text-ink-2">CI-verified merged PR throughput across the current 30-day window.</p>
                      {lastLeaderboardRefreshAt ? (
                        <p className="mt-1 font-mono text-xs text-emerald-200">Refreshed {new Date(lastLeaderboardRefreshAt).toLocaleString()}</p>
                      ) : null}
                    </div>
                    <button
                      className="min-h-11 rounded-md border border-slate-600 px-3 py-2 text-xs font-mono text-ink-2 hover:border-cyan-400 hover:text-ink-1 disabled:opacity-60"
                      disabled={isLeaderboardRefreshing}
                      onClick={() => {
                        void refreshLeaderboardArtifact('leaderboard-manual');
                      }}
                      type="button"
                    >
                      {isLeaderboardRefreshing ? 'Refreshing...' : 'Refresh Leaderboard'}
                    </button>
                  </div>
                  <div className={`mb-4 rounded-md border px-3 py-2 text-xs ${getFreshnessToneClasses(leaderboardFreshnessPresentation.tone)}`}>
                    <p className="font-mono uppercase tracking-[0.08em]">
                      {leaderboardFreshnessPresentation.isStale ? 'Snapshot status: stale' : 'Snapshot status: healthy'}
                    </p>
                    <p className="mt-1">
                      {leaderboardFreshnessPresentation.timestamps.length > 0
                        ? leaderboardFreshnessPresentation.timestamps
                            .map((marker) => `${marker.label} ${formatFreshnessTimestamp(marker.iso)}`)
                            .join(' | ')
                        : 'Latest snapshot timestamp unavailable.'}
                    </p>
                    {leaderboardFreshnessPresentation.isStale ? (
                      <div className="mt-2 rounded-md border border-rose-300/60 bg-rose-500/15 p-2 text-rose-100">
                        <p className="font-mono uppercase tracking-[0.08em]">Stale Snapshot Warning</p>
                        <p className="mt-1">Leaderboard positions may lag until a fresh backend snapshot is fetched.</p>
                        <button
                          className="mt-2 min-h-11 rounded-md border border-rose-300/70 bg-rose-400/20 px-3 py-2 font-mono text-[11px] text-rose-100 hover:bg-rose-400/30 disabled:opacity-60"
                          disabled={isLeaderboardRefreshing}
                          onClick={() => {
                            void refreshLeaderboardArtifact('leaderboard-stale-recovery');
                          }}
                          type="button"
                        >
                          {isLeaderboardRefreshing ? 'Refreshing Snapshot...' : 'Refresh Snapshot Now'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {debugEnabled ? (
                    <div className={`mb-4 rounded-md border px-3 py-2 text-xs ${getFreshnessToneClasses(leaderboardFreshnessPresentation.tone)}`}>
                      <p className="font-mono uppercase tracking-[0.08em]">Debug Freshness Payload</p>
                      <p className="mt-1">{leaderboardFreshnessPresentation.headline}</p>
                      <p className="mt-1">{leaderboardFreshnessPresentation.detail}</p>
                      {leaderboardFreshnessPresentation.note ? <p className="mt-1">Note: {leaderboardFreshnessPresentation.note}</p> : null}
                      {leaderboardFreshnessPresentation.staleReasonText.length > 0 ? (
                        <p className="mt-1">Reasons: {leaderboardFreshnessPresentation.staleReasonText.join(' | ')}</p>
                      ) : null}
                      {leaderboardFreshnessPresentation.debugAttribution ? (
                        <p className="mt-1 font-mono text-[11px] text-ink-2">{leaderboardFreshnessPresentation.debugAttribution}</p>
                      ) : null}
                      {leaderboard?.generatedAt ? (
                        <p className="mt-1 font-mono text-[11px] text-ink-2">Artifact generated: {new Date(leaderboard.generatedAt).toLocaleString()}</p>
                      ) : null}
                    </div>
                  ) : null}
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
                      const tier = getTier(entry, percentile);
                      const tierBadge = getTierBadge(tier);
                      const trustBadge = getTrustBadge(entry.trust?.verification?.state);
                      const rankTone = getRankTone(entry.rank);
                      const isMuted = hasZeroLeaderboardMetrics(entry);
                      return (
                        <div
                          key={`${entry.handle}-mobile`}
                          className={`cursor-pointer rounded-lg border p-3 transition-colors hover:bg-slate-800/50 ${
                            entry.rank <= 3 ? 'border-amber-400/40 bg-amber-500/5' : 'border-slate-700 bg-slate-950/35'
                          }`}
                          onClick={() => openProfile(entry.handle)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openProfile(entry.handle);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <div className="flex items-center gap-2">
                                <span className={`rounded-full border px-2 py-0.5 font-mono text-xs ${rankTone.badgeClassName}`}>#{entry.rank}</span>
                                <div className="relative h-10 w-10 overflow-hidden rounded-full border border-slate-700 bg-slate-900/80">
                                  <span className="absolute inset-0 flex items-center justify-center font-mono text-xs text-ink-2">
                                    {entry.handle.slice(0, 1).toUpperCase()}
                                  </span>
                                  <img
                                    alt={`GitHub avatar for @${entry.handle}`}
                                    className="absolute inset-0 h-full w-full object-cover"
                                    onError={(event) => {
                                      event.currentTarget.style.visibility = 'hidden';
                                    }}
                                    src={`https://github.com/${encodeURIComponent(entry.handle)}.png?size=80`}
                                  />
                                </div>
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-ink-1">@{entry.handle}</p>
                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                  <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${tierBadge.className}`}>
                                    {tierBadge.label}
                                  </span>
                                  <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${trustBadge.className}`}>
                                    {trustBadge.label}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className={`font-mono text-xl ${isMuted ? 'text-ink-3' : 'text-cyan-100'}`}>
                                {formatNumber(entry.totals.equivalentEngineeringHours, 1)}
                              </p>
                              <p
                                className={`font-mono text-xs ${
                                  isMuted ? 'text-ink-3' : entry.totals.velocityAcceleration >= 0 ? 'text-state-success' : 'text-state-warning'
                                }`}
                              >
                                Accel {formatAcceleration(entry.totals.velocityAcceleration)}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-slate-800/80 bg-slate-950/35">
                    <table className="hidden w-full min-w-[780px] text-left text-sm sm:table">
                      <thead className="sticky top-0 z-10 border-b border-slate-700 bg-slate-950/95 font-mono text-xs uppercase tracking-wide text-ink-3 backdrop-blur">
                        <tr>
                          {LEADERBOARD_DESKTOP_COLUMNS.map((column) => (
                            <th key={column} className="px-3 py-2">
                              {column}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {!leaderboardError && !leaderboard ? (
                          <tr className="border-b border-slate-800/80">
                            <td className="px-3 py-6 text-center text-ink-2" colSpan={LEADERBOARD_DESKTOP_COLUMNS.length}>
                              Loading leaderboard artifact...
                            </td>
                          </tr>
                        ) : null}
                        {!leaderboardError && leaderboard && leaderboard.entries.length === 0 ? (
                          <tr className="border-b border-slate-800/80">
                            <td className="px-3 py-6 text-center text-ink-2" colSpan={LEADERBOARD_DESKTOP_COLUMNS.length}>
                              No leaderboard entries available yet. Run bootstrap to generate data.
                            </td>
                          </tr>
                        ) : null}
                        {sortedEntries.map((entry) => {
                          const percentile = getPercentile(entry, sortedEntries.length);
                          const tier = getTier(entry, percentile);
                          const tierBadge = getTierBadge(tier);
                          const trustBadge = getTrustBadge(entry.trust?.verification?.state);
                          const rankTone = getRankTone(entry.rank);
                          const isMuted = hasZeroLeaderboardMetrics(entry);
                          return (
                            <tr
                              key={entry.handle}
                              className={`cursor-pointer border-b border-slate-800/80 transition-colors hover:bg-slate-800/50 ${
                                entry.rank <= 3 ? 'bg-amber-500/[0.03]' : ''
                              }`}
                              onClick={() => openProfile(entry.handle)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault();
                                  openProfile(entry.handle);
                                }
                              }}
                              role="button"
                              tabIndex={0}
                            >
                              <td className="px-3 py-3">
                                <span className={`inline-flex rounded-full border px-2 py-0.5 font-mono text-xs ${rankTone.badgeClassName}`}>#{entry.rank}</span>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex items-center gap-3">
                                  <div className="relative h-9 w-9 overflow-hidden rounded-full border border-slate-700 bg-slate-900/80">
                                    <span className="absolute inset-0 flex items-center justify-center font-mono text-xs text-ink-2">
                                      {entry.handle.slice(0, 1).toUpperCase()}
                                    </span>
                                    <img
                                      alt={`GitHub avatar for @${entry.handle}`}
                                      className="absolute inset-0 h-full w-full object-cover"
                                      onError={(event) => {
                                        event.currentTarget.style.visibility = 'hidden';
                                      }}
                                      src={`https://github.com/${encodeURIComponent(entry.handle)}.png?size=72`}
                                    />
                                  </div>
                                  <p className={`font-medium ${entry.rank <= 3 ? rankTone.textClassName : 'text-ink-1'}`}>@{entry.handle}</p>
                                </div>
                              </td>
                              <td className="px-3 py-3">
                                <div className="flex flex-wrap items-center gap-1">
                                  <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${tierBadge.className}`}>
                                    {tierBadge.label}
                                  </span>
                                  <span className={`rounded-full border px-2 py-0.5 font-mono text-[11px] ${trustBadge.className}`}>
                                    {trustBadge.label}
                                  </span>
                                </div>
                              </td>
                              <td className={`px-3 py-3 font-mono text-lg font-semibold ${isMuted ? 'text-ink-3' : 'text-cyan-100'}`}>
                                {formatNumber(entry.totals.equivalentEngineeringHours, 1)}
                              </td>
                              <td className={`px-3 py-3 font-mono ${isMuted ? 'text-ink-3' : 'text-ink-1'}`}>
                                {formatNumber(entry.totals.mergedPrsCiVerified, 0)}
                              </td>
                              <td
                                className={`px-3 py-3 font-mono ${
                                  isMuted ? 'text-ink-3' : entry.totals.velocityAcceleration >= 0 ? 'text-state-success' : 'text-state-warning'
                                }`}
                              >
                                {formatAcceleration(entry.totals.velocityAcceleration)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-4 rounded-md border border-slate-700/80 bg-surface-2/80 px-3 py-2 text-xs text-ink-2">
                    Metric notes: EEH is a heuristic from CI-verified merged PR throughput. Velocity acceleration compares the current 30-day window against the previous 30 days. Detailed diagnostics live on each profile page.
                  </p>
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
                        {scanPersistenceSummary ? (
                          <div className={`mt-3 rounded-md border px-3 py-2 text-xs leading-relaxed ${scanPersistenceSummary.tone}`}>
                            <p className="font-mono uppercase tracking-[0.08em]">{scanPersistenceSummary.heading}</p>
                            <p className="mt-1">{scanPersistenceSummary.detail}</p>
                          </div>
                        ) : null}
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {scanResult.persistence?.canonicalLeaderboardWrite ? (
                            <button
                              className="min-h-11 rounded-md border border-cyan-300/60 bg-cyan-500/20 px-3 py-2 text-xs font-mono text-cyan-100 hover:bg-cyan-500/30"
                              onClick={() => {
                                const ownerHandle = scanResult.persistence?.ownerHandle ?? authIdentity?.handle;
                                if (!ownerHandle) {
                                  return;
                                }
                                trackUxEvent('claim_profile_clicked', { source: 'scan_lane_persisted', signedIn: Boolean(authIdentity), handle: ownerHandle });
                                openProfile(ownerHandle);
                              }}
                              type="button"
                            >
                              View Canonical Profile
                            </button>
                          ) : authIdentity ? (
                            <button
                              className="min-h-11 rounded-md border border-cyan-300/60 bg-cyan-500/20 px-3 py-2 text-xs font-mono text-cyan-100 hover:bg-cyan-500/30"
                              onClick={() => {
                                trackUxEvent('claim_profile_clicked', { source: 'scan_lane', signedIn: true, handle: authIdentity.handle });
                                openProfile(authIdentity.handle);
                              }}
                              type="button"
                            >
                              View My Profile
                            </button>
                          ) : (
                            <a
                              className="min-h-11 inline-flex items-center rounded-md border border-cyan-300/60 bg-cyan-500/20 px-3 py-2 text-xs font-mono text-cyan-100 hover:bg-cyan-500/30"
                              href="/api/auth/github/start"
                              onClick={() =>
                                trackUxEvent('claim_profile_clicked', {
                                  source: 'scan_lane',
                                  signedIn: false,
                                  ownerHandle: scanResult.persistence?.ownerHandle ?? null,
                                })
                              }
                            >
                              {scanResult.persistence?.reason === 'unauthenticated' && scanResult.persistence.ownerHandle
                                ? `Sign in as @${scanResult.persistence.ownerHandle}`
                                : 'Sign in to Claim Profile'}
                            </a>
                          )}
                          <button
                            className="min-h-11 rounded-md border border-slate-600 px-3 py-2 text-xs font-mono text-ink-1 hover:border-cyan-400"
                            onClick={() => {
                              void refreshLeaderboardArtifact('scan-lane-manual');
                              trackUxEvent('scan_lane_refresh_clicked', { source: 'scan_lane', canonicalPersisted: Boolean(scanResult.persistence?.canonicalLeaderboardWrite) });
                            }}
                            type="button"
                          >
                            {isLeaderboardRefreshing ? 'Refreshing...' : 'Refresh Leaderboard'}
                          </button>
                          <button
                            className="min-h-11 rounded-md border border-slate-600 px-3 py-2 text-xs font-mono text-ink-1 hover:border-cyan-400"
                            onClick={() => {
                              setView('leaderboard');
                              trackUxEvent('scan_to_leaderboard_clicked', { source: 'scan_lane' });
                            }}
                            type="button"
                          >
                            View Ranking Impact
                          </button>
                          {scanChallengeUrl && scanComparisonEntry ? (
                            <>
                              <button
                                className="min-h-11 rounded-md border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-xs font-mono text-amber-100 hover:bg-amber-400/20"
                                onClick={() =>
                                  void triggerOutboundShare({
                                    event: 'challenge_link_clicked',
                                    source: 'scan_lane',
                                    challenger: currentActorHandleForTelemetry,
                                    target: scanComparisonEntry.handle,
                                    title: 'Mentat Velocity Challenge',
                                    text: `Scan challenge: can your throughput beat @${scanComparisonEntry.handle}?`,
                                    url: scanChallengeUrl,
                                  })
                                }
                                type="button"
                              >
                                Challenge @{scanComparisonEntry.handle}
                              </button>
                              <button
                                className="min-h-11 rounded-md border border-amber-400/40 px-3 py-2 text-xs font-mono text-amber-100 hover:bg-amber-400/15"
                                onClick={() =>
                                  void copyShareLink({
                                    event: 'challenge_link_clicked',
                                    source: 'scan_lane',
                                    challenger: currentActorHandleForTelemetry,
                                    target: scanComparisonEntry.handle,
                                    url: scanChallengeUrl,
                                  })
                                }
                                type="button"
                              >
                                Copy Challenge
                              </button>
                            </>
                          ) : challengeActorHandle === null ? (
                            <a
                              className="min-h-11 inline-flex items-center rounded-md border border-amber-400/40 px-3 py-2 text-xs font-mono text-amber-100 hover:bg-amber-400/10"
                              href="/api/auth/github/start"
                              onClick={() =>
                                trackUxEvent('claim_profile_clicked', {
                                  source: 'scan_lane_challenge_gate',
                                  signedIn: false,
                                })
                              }
                            >
                              Claim Profile to Challenge
                            </a>
                          ) : null}
                        </div>
                        {scanRefreshHint ? <p className="mt-2 text-xs text-rose-200">Refresh failed: {scanRefreshHint}</p> : null}
                        {lastLeaderboardRefreshAt ? (
                          <p className="mt-2 font-mono text-xs text-cyan-200">Last refresh: {new Date(lastLeaderboardRefreshAt).toLocaleString()}</p>
                        ) : null}

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

                      {debugEnabled ? (
                        <div className="mt-4 overflow-hidden rounded-md border border-slate-700">
                          <div className="border-b border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs uppercase tracking-wide text-ink-3">
                            Raw Report Card JSON
                          </div>
                          <pre className="overflow-auto bg-slate-950/80 p-3 text-xs text-ink-2">{JSON.stringify(scanResult, null, 2)}</pre>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              )}
          </div>
        )}
      </main>
    </div>
  );
}

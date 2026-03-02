import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import leaderboardArtifact from '../../data/leaderboard.generated.json';
import seedCreators from '../../data/seed-creators.json';
import { deleteCachedByPrefix, getCached, setCached } from '../shared/cache';
import { exchangeGitHubOAuthCode, fetchGitHubAuthenticatedUser } from '../shared/github';
import { scanRepoByUrl } from '../shared/scanService';
import type { LeaderboardArtifact, ProfileResponse, ScanRequest, SeedCreator } from '../shared/types';
import {
  buildBadgeSvg,
  createSessionRecord,
  ensureSeedData,
  getLeaderboardArtifact,
  getProfileByHandle,
  getSessionIdentityByTokenHash,
  persistScanReport,
  refreshLeaderboardFromSeed,
  revokeSessionByTokenHash,
  upsertGitHubOAuthIdentity,
  type AuthSessionIdentity,
} from './data/db';

const scanSchema = z.object({
  repoUrl: z.string().url(),
});

const SESSION_COOKIE_NAME = 'velocity_session';
const OAUTH_STATE_COOKIE_NAME = 'velocity_oauth_state';
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const DEFAULT_SESSION_TTL_HOURS = 24 * 14;
const OAUTH_TOKEN_ENCRYPTION_KEY_ENV = 'OAUTH_TOKEN_ENCRYPTION_KEY';
const OAUTH_TOKEN_CIPHERTEXT_VERSION = 'v1';
const PUBLIC_CACHE_KEY_PREFIX = 'worker:public:';
const PUBLIC_CACHE_VERSION_KEY = `${PUBLIC_CACHE_KEY_PREFIX}version`;
const PUBLIC_CACHE_VERSION_TTL_MS = 15 * 1000;
const LEADERBOARD_LOCAL_CACHE_TTL_MS = 30 * 1000;
const PROFILE_LOCAL_CACHE_TTL_MS = 60 * 1000;
const LEADERBOARD_CACHE_CONTROL = 'public, max-age=30, s-maxage=60, stale-while-revalidate=300';
const PROFILE_CACHE_CONTROL = 'public, max-age=60, s-maxage=120, stale-while-revalidate=600';
const SHARE_CACHE_CONTROL = 'public, max-age=300, s-maxage=300, stale-while-revalidate=900';
const REFRESH_LOCK_NAME = 'seed-refresh';
const REFRESH_LOCK_TABLE_NAME = 'refresh_locks';
const REFRESH_LOCK_TTL_SECONDS_DEFAULT = 15 * 60;
const REFRESH_LOCK_TTL_SECONDS_MIN = 30;
const REFRESH_LOCK_HEARTBEAT_MS_DEFAULT = 30 * 1000;
const REFRESH_LOCK_HEARTBEAT_MS_MIN = 200;
const REFRESH_LOCK_HEARTBEAT_RATIO_MAX = 0.5;
const RETENTION_WINDOWS_DAYS = {
  scans: 180,
  snapshots: 180,
  profileMetricsHistory: 180,
  refreshRuns: 45,
  sessionsRevoked: 30,
  sessionsExpired: 7,
  refreshLocks: 1,
} as const;

type WorkerBindings = Env & {
  GITHUB_TOKEN?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  OAUTH_TOKEN_ENCRYPTION_KEY?: string;
  REFRESH_ADMIN_HANDLES?: string;
  SESSION_TTL_HOURS?: string;
  REFRESH_LOCK_TTL_SECONDS?: string;
  REFRESH_LOCK_HEARTBEAT_MS?: string;
  DB?: D1Database;
};

type SessionAuthResult =
  | { ok: true; identity: AuthSessionIdentity }
  | { ok: false; response: Response };

type WorkerContext = Context<{ Bindings: WorkerBindings }>;
type PublicCacheVersionToken = `${number}:${number}`;

export const app = new Hono<{ Bindings: WorkerBindings }>();

function isProd(env: WorkerBindings): boolean {
  return env.APP_ENV === 'production';
}

function sessionTtlSeconds(env: WorkerBindings): number {
  const configured = Number(env.SESSION_TTL_HOURS);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured * 60 * 60);
  }
  return DEFAULT_SESSION_TTL_HOURS * 60 * 60;
}

function refreshLockTtlSeconds(env: WorkerBindings): number {
  const configured = Number(env.REFRESH_LOCK_TTL_SECONDS);
  if (Number.isFinite(configured) && configured >= REFRESH_LOCK_TTL_SECONDS_MIN) {
    return Math.floor(configured);
  }
  return REFRESH_LOCK_TTL_SECONDS_DEFAULT;
}

function refreshLockHeartbeatMs(env: WorkerBindings, ttlSeconds: number): number {
  const configured = Number(env.REFRESH_LOCK_HEARTBEAT_MS);
  const upperBound = Math.max(
    REFRESH_LOCK_HEARTBEAT_MS_MIN,
    Math.floor(ttlSeconds * 1000 * REFRESH_LOCK_HEARTBEAT_RATIO_MAX),
  );
  if (Number.isFinite(configured) && configured >= REFRESH_LOCK_HEARTBEAT_MS_MIN) {
    return Math.min(Math.floor(configured), upperBound);
  }
  return Math.min(REFRESH_LOCK_HEARTBEAT_MS_DEFAULT, upperBound);
}

function baseCookieOptions(env: WorkerBindings): {
  httpOnly: true;
  sameSite: 'Lax';
  secure: boolean;
  path: '/';
} {
  return {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isProd(env),
    path: '/',
  };
}

function missingEnvResponse(missingKeys: string[]): {
  error: string;
  actionable: string;
  missing: string[];
} {
  const listed = missingKeys.join(', ');
  return {
    error: `Missing required environment variable(s): ${listed}`,
    actionable: `Set secrets with \`wrangler secret put <NAME>\` for ${listed} and redeploy.`,
    missing: missingKeys,
  };
}

function requireAuthEnv(env: WorkerBindings, includeClientSecret: boolean, extraRequired: string[] = []): string[] {
  const required = includeClientSecret
    ? ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET']
    : ['SESSION_SECRET'];
  required.push(...extraRequired);

  return required.filter((key) => {
    const value = env[key as keyof WorkerBindings];
    return typeof value !== 'string' || value.trim().length === 0;
  });
}

class ActionableConfigError extends Error {
  actionable: string;

  constructor(message: string, actionable: string) {
    super(message);
    this.name = 'ActionableConfigError';
    this.actionable = actionable;
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): string {
  const padded = value.padEnd(Math.ceil(value.length / 4) * 4, '=');
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return atob(base64);
}

function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeBase64Like(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const padded = trimmed.padEnd(Math.ceil(trimmed.length / 4) * 4, '=');
  const normalized = padded.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return binaryStringToBytes(atob(normalized));
  } catch {
    return null;
  }
}

function decodeHex(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (!/^[0-9a-fA-F]+$/.test(trimmed) || trimmed.length % 2 !== 0) {
    return null;
  }

  const bytes = new Uint8Array(trimmed.length / 2);
  for (let index = 0; index < trimmed.length; index += 2) {
    bytes[index / 2] = Number.parseInt(trimmed.slice(index, index + 2), 16);
  }
  return bytes;
}

function parseEncryptionKeyBytes(raw: string): Uint8Array | null {
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith('base64:')) {
    return decodeBase64Like(trimmed.slice('base64:'.length));
  }
  if (trimmed.toLowerCase().startsWith('hex:')) {
    return decodeHex(trimmed.slice('hex:'.length));
  }
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    return decodeHex(trimmed);
  }
  return decodeBase64Like(trimmed);
}

function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);

  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < maxLength; index += 1) {
    const leftByte = index < leftBytes.length ? leftBytes[index] : 0;
    const rightByte = index < rightBytes.length ? rightBytes[index] : 0;
    mismatch |= leftByte ^ rightByte;
  }

  return mismatch === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(new Uint8Array(signature));
}

async function hashSessionToken(sessionSecret: string, sessionToken: string): Promise<string> {
  return hmacSha256Hex(sessionSecret, `session:${sessionToken}`);
}

async function resolveOAuthTokenEncryptionKey(env: WorkerBindings): Promise<CryptoKey> {
  const raw = env[OAUTH_TOKEN_ENCRYPTION_KEY_ENV];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new ActionableConfigError(
      `Missing required environment variable(s): ${OAUTH_TOKEN_ENCRYPTION_KEY_ENV}`,
      `Set secret with \`wrangler secret put ${OAUTH_TOKEN_ENCRYPTION_KEY_ENV}\` and redeploy.`,
    );
  }

  const keyBytes = parseEncryptionKeyBytes(raw);
  if (!keyBytes || keyBytes.byteLength !== 32) {
    throw new ActionableConfigError(
      `${OAUTH_TOKEN_ENCRYPTION_KEY_ENV} must be exactly 32 bytes (base64/base64url, or hex with optional hex: prefix).`,
      `Generate one with \`openssl rand -base64 32 | tr -d "\\n"\`, set \`wrangler secret put ${OAUTH_TOKEN_ENCRYPTION_KEY_ENV}\`, and redeploy.`,
    );
  }

  const keyMaterial = new Uint8Array(keyBytes.byteLength);
  keyMaterial.set(keyBytes);
  return crypto.subtle.importKey('raw', keyMaterial.buffer, 'AES-GCM', false, ['encrypt']);
}

async function encryptOAuthAccessToken(accessToken: string, key: CryptoKey): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(accessToken));
  return `${OAUTH_TOKEN_CIPHERTEXT_VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

async function createSignedOAuthState(sessionSecret: string): Promise<string> {
  const payload = {
    nonce: randomToken(18),
    exp: Date.now() + OAUTH_STATE_TTL_SECONDS * 1000,
  };
  const encodedPayload = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await hmacSha256Hex(sessionSecret, `oauth-state:${encodedPayload}`);
  return `${encodedPayload}.${sig}`;
}

async function validateSignedOAuthState(sessionSecret: string, state: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [encodedPayload, providedSig] = state.split('.');
  if (!encodedPayload || !providedSig) {
    return { ok: false, error: 'OAuth state is malformed. Start again at /api/auth/github/start.' };
  }

  const expectedSig = await hmacSha256Hex(sessionSecret, `oauth-state:${encodedPayload}`);
  if (!timingSafeEqual(expectedSig, providedSig)) {
    return { ok: false, error: 'OAuth state signature mismatch. Start again at /api/auth/github/start.' };
  }

  try {
    const decoded = fromBase64Url(encodedPayload);
    const parsed = JSON.parse(decoded) as { exp?: unknown };
    const exp = Number(parsed.exp);
    if (!Number.isFinite(exp) || exp <= Date.now()) {
      return { ok: false, error: 'OAuth state expired. Start again at /api/auth/github/start.' };
    }
  } catch {
    return { ok: false, error: 'OAuth state payload is invalid. Start again at /api/auth/github/start.' };
  }

  return { ok: true };
}

function buildGitHubCallbackUrl(c: WorkerContext): string {
  const requestUrl = new URL(c.req.url);
  requestUrl.pathname = '/api/auth/github/callback';
  requestUrl.search = '';
  requestUrl.hash = '';
  return requestUrl.toString();
}

function buildAppProfileUrl(c: WorkerContext, handle: string): string {
  const requestUrl = new URL(c.req.url);
  requestUrl.pathname = `/v/${encodeURIComponent(handle.trim().toLowerCase())}`;
  requestUrl.search = '';
  requestUrl.hash = '';
  return requestUrl.toString();
}

function callbackRespondsWithJson(c: WorkerContext): boolean {
  return c.req.query('format')?.toLowerCase() === 'json';
}

function parseHandleAllowlist(raw: string | undefined): Set<string> {
  if (typeof raw !== 'string') {
    return new Set<string>();
  }

  return new Set(
    raw
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function hasD1Prepare(db: D1Database | undefined): db is D1Database {
  return Boolean(db && typeof (db as { prepare?: unknown }).prepare === 'function');
}

function getEdgeCache(): Cache | null {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  return cache ?? null;
}

function applyPublicCacheHeaders(response: Response, cacheControl: string, cacheStatus: 'local-hit' | 'edge-hit' | 'miss'): Response {
  response.headers.set('cache-control', cacheControl);
  response.headers.set('x-velocity-cache', cacheStatus);
  return response;
}

function createPublicCacheVersionToken(refreshVersion: number, canonicalScanVersion: number): PublicCacheVersionToken {
  const boundedRefreshVersion = Math.max(0, Math.floor(refreshVersion));
  const boundedScanVersion = Math.max(0, Math.floor(canonicalScanVersion));
  return `${boundedRefreshVersion}:${boundedScanVersion}`;
}

function buildEdgeCacheRequest(requestUrl: string, cacheVersion: PublicCacheVersionToken): Request {
  const cacheUrl = new URL(requestUrl);
  cacheUrl.hash = '';
  cacheUrl.searchParams.set('__cv', cacheVersion);
  return new Request(cacheUrl.toString(), { method: 'GET' });
}

function localPublicCacheKey(cacheVersion: PublicCacheVersionToken, cacheKey: string): string {
  return `${PUBLIC_CACHE_KEY_PREFIX}${cacheVersion}:${cacheKey}`;
}

function invalidatePublicReadCaches(nextCacheVersion?: PublicCacheVersionToken): void {
  deleteCachedByPrefix(PUBLIC_CACHE_KEY_PREFIX);
  if (typeof nextCacheVersion === 'string' && nextCacheVersion.length > 0) {
    setCached(PUBLIC_CACHE_VERSION_KEY, nextCacheVersion, PUBLIC_CACHE_VERSION_TTL_MS);
  }
}

async function resolvePublicCacheVersion(
  env: WorkerBindings,
  options: { bypassLocalCache?: boolean } = {},
): Promise<PublicCacheVersionToken> {
  if (!options.bypassLocalCache) {
    const cached = getCached<PublicCacheVersionToken>(PUBLIC_CACHE_VERSION_KEY);
    if (typeof cached === 'string' && cached.length > 0) {
      return cached;
    }
  }

  const emptyVersion = createPublicCacheVersionToken(0, 0);
  if (!hasD1Prepare(env.DB)) {
    return emptyVersion;
  }

  try {
    const row = await env.DB
      .prepare(
        `SELECT
           COALESCE((SELECT MAX(id) FROM refresh_runs WHERE status = 'success'), 0) AS refresh_version,
           COALESCE((SELECT MAX(id) FROM snapshots), 0) AS canonical_scan_version`,
      )
      .first<{ refresh_version?: unknown; canonical_scan_version?: unknown }>();
    const version = createPublicCacheVersionToken(
      toFiniteNumber(row?.refresh_version),
      toFiniteNumber(row?.canonical_scan_version),
    );
    setCached(PUBLIC_CACHE_VERSION_KEY, version, PUBLIC_CACHE_VERSION_TTL_MS);
    return version;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[cache] failed to resolve cache version token, using ${emptyVersion}: ${message}`);
    return emptyVersion;
  }
}

async function invalidatePublicReadCachesFromDb(env: WorkerBindings): Promise<PublicCacheVersionToken | undefined> {
  invalidatePublicReadCaches();
  if (!hasD1Prepare(env.DB)) {
    return undefined;
  }

  try {
    return await resolvePublicCacheVersion(env, { bypassLocalCache: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[cache] failed to prime cache version after canonical write: ${message}`);
    return undefined;
  }
}

interface CachedJsonResponseOptions<T> {
  cacheKey: string;
  cacheVersion: PublicCacheVersionToken;
  localTtlMs: number;
  cacheControl: string;
  skipCache?: boolean;
  load: () => Promise<T>;
}

async function respondWithCachedJson<T>(c: WorkerContext, options: CachedJsonResponseOptions<T>): Promise<Response> {
  if (options.skipCache) {
    const payload = await options.load();
    return applyPublicCacheHeaders(c.json(payload), options.cacheControl, 'miss');
  }

  const localKey = localPublicCacheKey(options.cacheVersion, options.cacheKey);
  const local = getCached<T>(localKey);
  if (local !== undefined) {
    return applyPublicCacheHeaders(c.json(local), options.cacheControl, 'local-hit');
  }

  const edgeCache = getEdgeCache();
  const edgeRequest = buildEdgeCacheRequest(c.req.url, options.cacheVersion);
  if (edgeCache) {
    const edgeHit = await edgeCache.match(edgeRequest);
    if (edgeHit) {
      const response = new Response(edgeHit.body, edgeHit);
      return applyPublicCacheHeaders(response, options.cacheControl, 'edge-hit');
    }
  }

  const payload = await options.load();
  setCached(localKey, payload, options.localTtlMs);
  const response = applyPublicCacheHeaders(c.json(payload), options.cacheControl, 'miss');

  if (edgeCache && response.ok) {
    await edgeCache.put(edgeRequest, response.clone());
  }
  return response;
}

class ProfileNotFoundError extends Error {
  constructor(handle: string) {
    super(`Profile not found for handle: ${handle}`);
    this.name = 'ProfileNotFoundError';
  }
}

async function loadProfileByHandle(db: D1Database, handle: string): Promise<ProfileResponse> {
  await ensureSeedData(db, leaderboardArtifact as LeaderboardArtifact);
  const profile = await getProfileByHandle(db, handle);
  if (!profile) {
    throw new ProfileNotFoundError(handle);
  }
  return profile;
}

interface RefreshLockRow {
  lock_owner: string;
  expires_at: string;
}

interface RefreshLockTicket {
  ownerId: string;
}

class RefreshLockConflictError extends Error {
  lockOwner: string | null;
  expiresAt: string | null;

  constructor(lockOwner: string | null, expiresAt: string | null) {
    super('Seed refresh is already running.');
    this.name = 'RefreshLockConflictError';
    this.lockOwner = lockOwner;
    this.expiresAt = expiresAt;
  }
}

class RefreshLockLostError extends Error {
  ownerId: string;
  reason: string;

  constructor(ownerId: string, reason: string) {
    super(`Seed refresh lock was lost for owner ${ownerId}: ${reason}`);
    this.name = 'RefreshLockLostError';
    this.ownerId = ownerId;
    this.reason = reason;
  }
}

interface RefreshLockHeartbeatMonitor {
  intervalMs: number;
  ttlSeconds: number;
  assertHealthy: () => void;
  stop: () => Promise<void>;
}

async function ensureRefreshLockTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS ${REFRESH_LOCK_TABLE_NAME} (
        lock_name TEXT PRIMARY KEY,
        lock_owner TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
    )
    .run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_refresh_locks_expires ON ${REFRESH_LOCK_TABLE_NAME}(expires_at)`).run();
}

async function readCurrentRefreshLock(db: D1Database): Promise<RefreshLockRow | null> {
  return db
    .prepare(`SELECT lock_owner, expires_at FROM ${REFRESH_LOCK_TABLE_NAME} WHERE lock_name = ? LIMIT 1`)
    .bind(REFRESH_LOCK_NAME)
    .first<RefreshLockRow>();
}

async function acquireRefreshLock(
  db: D1Database,
  trigger: 'manual' | 'scheduled',
  ttlSeconds: number,
): Promise<RefreshLockTicket | null> {
  await ensureRefreshLockTable(db);
  const ownerId = `${trigger}:${crypto.randomUUID()}`;
  const acquiredAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  const result = await db
    .prepare(
      `INSERT INTO ${REFRESH_LOCK_TABLE_NAME} (lock_name, lock_owner, acquired_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(lock_name) DO UPDATE SET
         lock_owner = excluded.lock_owner,
         acquired_at = excluded.acquired_at,
         expires_at = excluded.expires_at
       WHERE datetime(${REFRESH_LOCK_TABLE_NAME}.expires_at) <= datetime('now')`,
    )
    .bind(REFRESH_LOCK_NAME, ownerId, acquiredAt, expiresAt)
    .run();

  const changes = toFiniteNumber((result as { meta?: { changes?: unknown } }).meta?.changes);
  if (changes < 1) {
    return null;
  }
  return { ownerId };
}

async function renewRefreshLock(db: D1Database, ownerId: string, ttlSeconds: number): Promise<boolean> {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const result = await db
    .prepare(
      `UPDATE ${REFRESH_LOCK_TABLE_NAME}
       SET expires_at = ?
       WHERE lock_name = ?
         AND lock_owner = ?
         AND datetime(expires_at) > datetime('now')`,
    )
    .bind(expiresAt, REFRESH_LOCK_NAME, ownerId)
    .run();

  const changes = toFiniteNumber((result as { meta?: { changes?: unknown } }).meta?.changes);
  return changes > 0;
}

function startRefreshLockHeartbeat(
  db: D1Database,
  ownerId: string,
  ttlSeconds: number,
  intervalMs: number,
): RefreshLockHeartbeatMonitor {
  let active = true;
  let failureReason: string | null = null;
  let inFlight: Promise<void> | null = null;

  const pulse = async (): Promise<void> => {
    if (!active || failureReason || inFlight) {
      return;
    }

    inFlight = (async () => {
      try {
        const renewed = await renewRefreshLock(db, ownerId, ttlSeconds);
        if (!renewed) {
          failureReason = 'lock-expired-or-stolen';
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failureReason = `heartbeat-error:${message}`;
      }
    })().finally(() => {
      inFlight = null;
    });

    await inFlight;
  };

  const interval = setInterval(() => {
    void pulse();
  }, intervalMs);
  void pulse();

  return {
    intervalMs,
    ttlSeconds,
    assertHealthy: () => {
      if (failureReason) {
        throw new RefreshLockLostError(ownerId, failureReason);
      }
    },
    stop: async () => {
      active = false;
      clearInterval(interval);
      if (inFlight) {
        await inFlight;
      }
    },
  };
}

async function releaseRefreshLock(db: D1Database, ownerId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM ${REFRESH_LOCK_TABLE_NAME} WHERE lock_name = ? AND lock_owner = ?`)
    .bind(REFRESH_LOCK_NAME, ownerId)
    .run();
}

interface RetentionCleanupResult {
  executedAt: string;
  policyDays: typeof RETENTION_WINDOWS_DAYS;
  deletedRows: {
    scans: number;
    snapshots: number;
    profileMetricsHistory: number;
    refreshRuns: number;
    sessions: number;
    refreshLocks: number;
  };
}

async function runRetentionCleanup(db: D1Database): Promise<RetentionCleanupResult> {
  const scansWindow = `-${RETENTION_WINDOWS_DAYS.scans} day`;
  const snapshotsWindow = `-${RETENTION_WINDOWS_DAYS.snapshots} day`;
  const historyWindow = `-${RETENTION_WINDOWS_DAYS.profileMetricsHistory} day`;
  const refreshRunsWindow = `-${RETENTION_WINDOWS_DAYS.refreshRuns} day`;
  const revokedSessionsWindow = `-${RETENTION_WINDOWS_DAYS.sessionsRevoked} day`;
  const expiredSessionsWindow = `-${RETENTION_WINDOWS_DAYS.sessionsExpired} day`;
  const refreshLocksWindow = `-${RETENTION_WINDOWS_DAYS.refreshLocks} day`;

  const scansDelete = await db
    .prepare(
      `DELETE FROM scans
       WHERE snapshot_id IN (
         SELECT id FROM snapshots
         WHERE datetime(scanned_at) < datetime('now', ?)
       )`,
    )
    .bind(scansWindow)
    .run();

  const snapshotsDelete = await db
    .prepare(`DELETE FROM snapshots WHERE datetime(scanned_at) < datetime('now', ?)`)
    .bind(snapshotsWindow)
    .run();

  const historyDelete = await db
    .prepare(`DELETE FROM profile_metrics_history WHERE datetime(captured_at) < datetime('now', ?)`)
    .bind(historyWindow)
    .run();

  const refreshRunsDelete = await db
    .prepare(
      `DELETE FROM refresh_runs
       WHERE status <> 'running'
         AND datetime(COALESCE(finished_at, started_at)) < datetime('now', ?)`,
    )
    .bind(refreshRunsWindow)
    .run();

  const sessionsDelete = await db
    .prepare(
      `DELETE FROM sessions
       WHERE (revoked_at IS NOT NULL AND datetime(revoked_at) < datetime('now', ?))
          OR (revoked_at IS NULL AND datetime(expires_at) < datetime('now', ?))`,
    )
    .bind(revokedSessionsWindow, expiredSessionsWindow)
    .run();

  const refreshLocksDelete = await db
    .prepare(`DELETE FROM ${REFRESH_LOCK_TABLE_NAME} WHERE datetime(expires_at) < datetime('now', ?)`)
    .bind(refreshLocksWindow)
    .run();

  return {
    executedAt: new Date().toISOString(),
    policyDays: RETENTION_WINDOWS_DAYS,
    deletedRows: {
      scans: toFiniteNumber((scansDelete as { meta?: { changes?: unknown } }).meta?.changes),
      snapshots: toFiniteNumber((snapshotsDelete as { meta?: { changes?: unknown } }).meta?.changes),
      profileMetricsHistory: toFiniteNumber((historyDelete as { meta?: { changes?: unknown } }).meta?.changes),
      refreshRuns: toFiniteNumber((refreshRunsDelete as { meta?: { changes?: unknown } }).meta?.changes),
      sessions: toFiniteNumber((sessionsDelete as { meta?: { changes?: unknown } }).meta?.changes),
      refreshLocks: toFiniteNumber((refreshLocksDelete as { meta?: { changes?: unknown } }).meta?.changes),
    },
  };
}

interface SeedRefreshExecutionResult {
  refresh: Awaited<ReturnType<typeof refreshLeaderboardFromSeed>>;
  retention: RetentionCleanupResult | null;
  cacheVersion?: PublicCacheVersionToken;
  lock: {
    ttlSeconds: number;
    heartbeatMs: number;
  };
}

async function requireAuthenticatedSession(c: WorkerContext): Promise<SessionAuthResult> {
  if (!c.env?.DB) {
    return {
      ok: false,
      response: c.json({ error: 'Auth storage unavailable', actionable: 'Bind D1 as DB to enable /api/me and authenticated refresh.' }, 503),
    };
  }

  const missing = requireAuthEnv(c.env, false);
  if (missing.length > 0) {
    return {
      ok: false,
      response: c.json(missingEnvResponse(missing), 500),
    };
  }

  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  if (!sessionToken) {
    return {
      ok: false,
      response: c.json(
        {
          error: 'Not authenticated',
          actionable: 'Start OAuth at /api/auth/github/start to create a session.',
          placeholder: false,
        },
        401,
      ),
    };
  }

  const tokenHash = await hashSessionToken(c.env.SESSION_SECRET as string, sessionToken);
  const identity = await getSessionIdentityByTokenHash(c.env.DB, tokenHash);
  if (!identity) {
    deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
    return {
      ok: false,
      response: c.json(
        {
          error: 'Session expired or invalid',
          actionable: 'Start OAuth again at /api/auth/github/start.',
          placeholder: false,
        },
        401,
      ),
    };
  }

  return {
    ok: true,
    identity,
  };
}

async function resolveOptionalSessionIdentity(c: WorkerContext): Promise<AuthSessionIdentity | null> {
  if (!c.env?.DB) {
    return null;
  }

  const sessionSecret = c.env.SESSION_SECRET;
  if (typeof sessionSecret !== 'string' || sessionSecret.trim().length === 0) {
    return null;
  }

  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  if (!sessionToken) {
    return null;
  }

  try {
    const tokenHash = await hashSessionToken(sessionSecret, sessionToken);
    const identity = await getSessionIdentityByTokenHash(c.env.DB, tokenHash);
    if (!identity) {
      deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
      return null;
    }
    return identity;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[scan] optional auth lookup failed: ${message}`);
    return null;
  }
}

async function runSeedRefresh(env: WorkerBindings, trigger: 'manual' | 'scheduled') {
  if (!env.DB) {
    throw new Error('DB binding is required for seed refresh operations.');
  }

  const lockTtlSeconds = refreshLockTtlSeconds(env);
  const lockHeartbeatMs = refreshLockHeartbeatMs(env, lockTtlSeconds);

  if (!hasD1Prepare(env.DB)) {
    const refresh = await refreshLeaderboardFromSeed(env.DB, seedCreators as SeedCreator[], env.GITHUB_TOKEN, trigger);
    const cacheVersion = await invalidatePublicReadCachesFromDb(env);
    return {
      refresh,
      retention: null,
      cacheVersion,
      lock: {
        ttlSeconds: lockTtlSeconds,
        heartbeatMs: lockHeartbeatMs,
      },
    } satisfies SeedRefreshExecutionResult;
  }

  const ticket = await acquireRefreshLock(env.DB, trigger, lockTtlSeconds);
  if (!ticket) {
    const active = await readCurrentRefreshLock(env.DB);
    throw new RefreshLockConflictError(active?.lock_owner ?? null, active?.expires_at ?? null);
  }

  const heartbeat = startRefreshLockHeartbeat(env.DB, ticket.ownerId, lockTtlSeconds, lockHeartbeatMs);
  try {
    heartbeat.assertHealthy();
    const refresh = await refreshLeaderboardFromSeed(env.DB, seedCreators as SeedCreator[], env.GITHUB_TOKEN, trigger);
    heartbeat.assertHealthy();
    const cacheVersion = await invalidatePublicReadCachesFromDb(env);

    let retention: RetentionCleanupResult | null = null;
    try {
      retention = await runRetentionCleanup(env.DB);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[retention] cleanup failed after ${trigger} refresh: ${message}`);
    }

    return {
      refresh,
      retention,
      cacheVersion,
      lock: {
        ttlSeconds: lockTtlSeconds,
        heartbeatMs: lockHeartbeatMs,
      },
    } satisfies SeedRefreshExecutionResult;
  } finally {
    await heartbeat.stop();
    try {
      await releaseRefreshLock(env.DB, ticket.ownerId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[refresh] failed to release lock owner=${ticket.ownerId}: ${message}`);
    }
  }
}

app.get('/api/health', (c) => {
  return c.json({ ok: true, service: 'velocity-mvp', now: new Date().toISOString() });
});

app.get('/api/leaderboard', async (c) => {
  const db = c.env?.DB;
  if (!db) {
    return applyPublicCacheHeaders(
      c.json({
        ...(leaderboardArtifact as LeaderboardArtifact),
        dataSource: {
          kind: 'static-artifact',
          fallback: true,
          healthy: false,
          reason: 'db-binding-missing',
        },
      }),
      LEADERBOARD_CACHE_CONTROL,
      'miss',
    );
  }

  const cacheVersion = await resolvePublicCacheVersion(c.env);
  try {
    return await respondWithCachedJson(c, {
      cacheKey: 'leaderboard',
      cacheVersion,
      localTtlMs: LEADERBOARD_LOCAL_CACHE_TTL_MS,
      cacheControl: LEADERBOARD_CACHE_CONTROL,
      skipCache: !hasD1Prepare(db),
      load: async () => {
        await ensureSeedData(db, leaderboardArtifact as LeaderboardArtifact);
        const artifact = await getLeaderboardArtifact(db);
        return {
          ...artifact,
          dataSource: {
            kind: 'd1',
            fallback: false,
            healthy: true,
          },
        };
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown leaderboard data failure';
    console.error(`[leaderboard] failed to read D1 artifact; serving fallback: ${message}`);
    return c.json(
      {
        ...(leaderboardArtifact as LeaderboardArtifact),
        dataSource: {
          kind: 'static-artifact',
          fallback: true,
          healthy: false,
          reason: 'd1-read-failure',
          message,
        },
      },
      200,
      { 'cache-control': 'no-store' },
    );
  }
});

app.post('/api/scan', async (c) => {
  let body: ScanRequest;
  try {
    body = (await c.req.json()) as ScanRequest;
  } catch {
    return c.json({ error: 'Expected JSON body with { repoUrl: string }' }, 400);
  }
  const parsed = scanSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Expected body with { repoUrl: string }' }, 400);
  }

  try {
    const identity = c.env?.DB ? await resolveOptionalSessionIdentity(c) : null;
    const actorGitHubHandle = identity?.providerLogin?.trim().toLowerCase();
    const report = await scanRepoByUrl(parsed.data.repoUrl, c.env?.GITHUB_TOKEN, {
      attribution: actorGitHubHandle
        ? {
            mode: 'handle-authored',
            handle: actorGitHubHandle,
          }
        : undefined,
    });
    const ownerHandle = report.repo.owner.trim().toLowerCase();
    const requestedOwnerHandle = report.metadata?.repoIdentity?.requestedOwner?.trim().toLowerCase();
    const canonicalOwnerResolved = report.metadata?.repoIdentity?.canonicalOwnerResolved ?? true;
    const requestedOwnerDiffers = requestedOwnerHandle && requestedOwnerHandle !== ownerHandle;
    const attributionTargetHandle = report.attribution.targetHandle?.trim().toLowerCase();
    const strictHandleAttribution =
      report.attribution.mode === 'handle-authored' &&
      report.attribution.strict &&
      !!actorGitHubHandle &&
      attributionTargetHandle === actorGitHubHandle;

    let persistence: NonNullable<typeof report.persistence> = {
      canonicalLeaderboardWrite: false,
      rankingEligible: false,
      reason: c.env?.DB ? 'unauthenticated' : 'db-unavailable',
      ownerHandle,
      requestedOwnerHandle: requestedOwnerDiffers ? requestedOwnerHandle : undefined,
      attributionMode: report.attribution.mode,
      attributionStrict: report.attribution.strict,
      canonicalOwnerResolved,
    };

    if (c.env?.DB) {
      if (!identity) {
        persistence = {
          canonicalLeaderboardWrite: false,
          rankingEligible: false,
          reason: 'unauthenticated',
          ownerHandle,
          requestedOwnerHandle: requestedOwnerDiffers ? requestedOwnerHandle : undefined,
          attributionMode: report.attribution.mode,
          attributionStrict: report.attribution.strict,
          canonicalOwnerResolved,
        };
      } else if (!canonicalOwnerResolved) {
        persistence = {
          canonicalLeaderboardWrite: false,
          rankingEligible: false,
          reason: 'owner-unresolved',
          ownerHandle,
          requestedOwnerHandle: requestedOwnerDiffers ? requestedOwnerHandle : undefined,
          actorHandle: identity.handle,
          attributionMode: report.attribution.mode,
          attributionStrict: report.attribution.strict,
          canonicalOwnerResolved,
        };
      } else if (!actorGitHubHandle || actorGitHubHandle !== ownerHandle) {
        persistence = {
          canonicalLeaderboardWrite: false,
          rankingEligible: false,
          reason: 'owner-mismatch',
          ownerHandle,
          requestedOwnerHandle: requestedOwnerDiffers ? requestedOwnerHandle : undefined,
          actorHandle: identity.handle,
          attributionMode: report.attribution.mode,
          attributionStrict: report.attribution.strict,
          canonicalOwnerResolved,
        };
      } else if (!strictHandleAttribution) {
        persistence = {
          canonicalLeaderboardWrite: false,
          rankingEligible: false,
          reason: 'non-canonical-attribution',
          ownerHandle,
          requestedOwnerHandle: requestedOwnerDiffers ? requestedOwnerHandle : undefined,
          actorHandle: identity.handle,
          attributionMode: report.attribution.mode,
          attributionStrict: report.attribution.strict,
          canonicalOwnerResolved,
        };
      } else {
        await persistScanReport(c.env.DB, report);
        await invalidatePublicReadCachesFromDb(c.env);
        persistence = {
          canonicalLeaderboardWrite: true,
          rankingEligible: true,
          reason: 'persisted',
          ownerHandle,
          requestedOwnerHandle: requestedOwnerDiffers ? requestedOwnerHandle : undefined,
          actorHandle: identity.handle,
          attributionMode: report.attribution.mode,
          attributionStrict: report.attribution.strict,
          canonicalOwnerResolved,
        };
      }
    }
    return c.json({
      ...report,
      persistence,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown scan error';
    const status = message.startsWith('Invalid repository URL:') ? 400 : 500;
    return c.json({ error: message }, status);
  }
});

app.get('/api/auth/github/start', async (c) => {
  if (!c.env?.DB) {
    return c.json(
      {
        error: 'Auth storage unavailable',
        actionable: 'Bind D1 as DB to enable GitHub OAuth sessions.',
      },
      503,
    );
  }

  const missing = requireAuthEnv(c.env, true);
  if (missing.length > 0) {
    return c.json(missingEnvResponse(missing), 500);
  }

  const sessionSecret = c.env.SESSION_SECRET as string;
  const state = await createSignedOAuthState(sessionSecret);
  setCookie(c, OAUTH_STATE_COOKIE_NAME, state, {
    ...baseCookieOptions(c.env),
    maxAge: OAUTH_STATE_TTL_SECONDS,
    expires: new Date(Date.now() + OAUTH_STATE_TTL_SECONDS * 1000),
  });

  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', c.env.GITHUB_CLIENT_ID as string);
  authorizeUrl.searchParams.set('redirect_uri', buildGitHubCallbackUrl(c));
  authorizeUrl.searchParams.set('scope', 'read:user user:email');
  authorizeUrl.searchParams.set('state', state);

  return c.redirect(authorizeUrl.toString(), 302);
});

app.get('/api/auth/github/callback', async (c) => {
  if (!c.env?.DB) {
    return c.json(
      {
        error: 'Auth storage unavailable',
        actionable: 'Bind D1 as DB to enable GitHub OAuth sessions.',
      },
      503,
    );
  }

  const missing = requireAuthEnv(c.env, true, [OAUTH_TOKEN_ENCRYPTION_KEY_ENV]);
  if (missing.length > 0) {
    return c.json(missingEnvResponse(missing), 500);
  }

  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return c.json(
      {
        error: 'GitHub callback missing code/state query params.',
        actionable: 'Restart OAuth at /api/auth/github/start.',
      },
      400,
    );
  }

  const stateCookie = getCookie(c, OAUTH_STATE_COOKIE_NAME);
  if (!stateCookie || !timingSafeEqual(stateCookie, state)) {
    return c.json(
      {
        error: 'OAuth state cookie mismatch.',
        actionable: 'Restart OAuth at /api/auth/github/start.',
      },
      400,
    );
  }

  const stateCheck = await validateSignedOAuthState(c.env.SESSION_SECRET as string, state);
  if (!stateCheck.ok) {
    return c.json({ error: stateCheck.error, actionable: 'Restart OAuth at /api/auth/github/start.' }, 400);
  }

  let oauthTokenEncryptionKey: CryptoKey;
  try {
    oauthTokenEncryptionKey = await resolveOAuthTokenEncryptionKey(c.env);
  } catch (error) {
    if (error instanceof ActionableConfigError) {
      return c.json({ error: error.message, actionable: error.actionable }, 500);
    }
    return c.json(
      {
        error: 'Failed to initialize OAuth token encryption.',
        actionable: `Verify ${OAUTH_TOKEN_ENCRYPTION_KEY_ENV} and retry /api/auth/github/start.`,
      },
      500,
    );
  }

  let oauthToken: { accessToken: string; tokenType: string; scope: string };
  try {
    oauthToken = await exchangeGitHubOAuthCode({
      clientId: c.env.GITHUB_CLIENT_ID as string,
      clientSecret: c.env.GITHUB_CLIENT_SECRET as string,
      code,
      redirectUri: buildGitHubCallbackUrl(c),
      state,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown OAuth exchange failure';
    return c.json(
      {
        error: message,
        actionable: 'Verify GitHub OAuth app callback URL and client credentials, then retry /api/auth/github/start.',
      },
      502,
    );
  }

  let githubUser: Awaited<ReturnType<typeof fetchGitHubAuthenticatedUser>>;
  try {
    githubUser = await fetchGitHubAuthenticatedUser(oauthToken.accessToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown GitHub user fetch error';
    return c.json({ error: message, actionable: 'Retry OAuth at /api/auth/github/start.' }, 502);
  }

  let encryptedAccessToken: string;
  try {
    encryptedAccessToken = await encryptOAuthAccessToken(oauthToken.accessToken, oauthTokenEncryptionKey);
  } catch {
    return c.json(
      {
        error: 'Failed to encrypt OAuth access token.',
        actionable: `Verify ${OAUTH_TOKEN_ENCRYPTION_KEY_ENV} is valid and retry /api/auth/github/start.`,
      },
      500,
    );
  }

  const identity = await upsertGitHubOAuthIdentity(c.env.DB, githubUser.login, {
    providerUserId: String(githubUser.id),
    providerLogin: githubUser.login,
    encryptedAccessToken,
    tokenType: oauthToken.tokenType,
    scope: oauthToken.scope,
    avatarUrl: githubUser.avatar_url,
    profileUrl: githubUser.html_url,
  });

  const ttlSeconds = sessionTtlSeconds(c.env);
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const sessionToken = randomToken(32);
  const tokenHash = await hashSessionToken(c.env.SESSION_SECRET as string, sessionToken);

  await createSessionRecord(c.env.DB, {
    sessionId: crypto.randomUUID(),
    userId: identity.userId,
    tokenHash,
    expiresAt,
    userAgent: c.req.header('user-agent') ?? undefined,
  });

  setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
    ...baseCookieOptions(c.env),
    maxAge: ttlSeconds,
    expires: new Date(expiresAt),
  });
  deleteCookie(c, OAUTH_STATE_COOKIE_NAME, { path: '/' });

  const redirectTo = buildAppProfileUrl(c, identity.handle);
  if (!callbackRespondsWithJson(c)) {
    return c.redirect(redirectTo, 302);
  }

  return c.json({
    ok: true,
    auth: {
      provider: 'github',
      persistence: 'd1-session',
      productionReady: true,
      placeholder: false,
    },
    user: {
      handle: identity.handle,
      githubLogin: githubUser.login,
      githubId: githubUser.id,
      avatarUrl: githubUser.avatar_url,
      profileUrl: githubUser.html_url,
    },
    session: {
      expiresAt,
      ttlSeconds,
      httpOnly: true,
      sameSite: 'Lax',
      secure: isProd(c.env),
    },
    redirectTo,
  });
});

app.post('/api/auth/logout', async (c) => {
  if (!c.env?.DB) {
    return c.json(
      {
        error: 'Auth storage unavailable',
        actionable: 'Bind D1 as DB to enable logout/session revocation.',
      },
      503,
    );
  }

  const missing = requireAuthEnv(c.env, false);
  if (missing.length > 0) {
    return c.json(missingEnvResponse(missing), 500);
  }

  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  let revoked = false;
  if (sessionToken) {
    const tokenHash = await hashSessionToken(c.env.SESSION_SECRET as string, sessionToken);
    await revokeSessionByTokenHash(c.env.DB, tokenHash);
    revoked = true;
  }

  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
  return c.json({
    ok: true,
    session: {
      revoked,
      cookieCleared: true,
      productionReady: true,
      placeholder: false,
    },
  });
});

app.get('/api/me', async (c) => {
  const auth = await requireAuthenticatedSession(c);
  if (!auth.ok) {
    return auth.response;
  }

  return c.json({
    authenticated: true,
    user: {
      handle: auth.identity.handle,
      githubLogin: auth.identity.providerLogin,
      githubId: auth.identity.providerUserId,
      avatarUrl: auth.identity.avatarUrl,
      profileUrl: auth.identity.profileUrl,
    },
    session: {
      id: auth.identity.sessionId,
      expiresAt: auth.identity.expiresAt,
      persistence: 'd1-session',
      productionReady: true,
      placeholder: false,
    },
  });
});

app.post('/api/refresh/seeds', async (c) => {
  const auth = await requireAuthenticatedSession(c);
  if (!auth.ok) {
    return auth.response;
  }

  const refreshAdminHandles = parseHandleAllowlist(c.env?.REFRESH_ADMIN_HANDLES);
  if (!refreshAdminHandles.has(auth.identity.handle.trim().toLowerCase())) {
    return c.json(
      {
        error: 'Forbidden',
        actionable: 'This endpoint is restricted to handles listed in REFRESH_ADMIN_HANDLES.',
        authenticated: true,
        allowlisted: false,
      },
      403,
    );
  }

  try {
    const execution = await runSeedRefresh(c.env, 'manual');
    return c.json({
      ok: true,
      trigger: 'manual',
      triggeredBy: auth.identity.handle,
      refresh: execution.refresh,
      retentionCleanup: execution.retention,
      cacheInvalidation: {
        localCachePurged: true,
        cacheVersion: execution.cacheVersion ?? createPublicCacheVersionToken(execution.refresh.runId, execution.refresh.runId),
        edgeStrategy: 'Cache key versioning + short edge TTL',
        expectedMaxVersionStalenessSeconds: Math.ceil(PUBLIC_CACHE_VERSION_TTL_MS / 1000),
      },
      lock: {
        ttlSeconds: execution.lock.ttlSeconds,
        heartbeatMs: execution.lock.heartbeatMs,
      },
      productionReady: true,
      placeholder: false,
    });
  } catch (error) {
    if (error instanceof RefreshLockConflictError) {
      return c.json(
        {
          error: 'Refresh already in progress',
          actionable: 'Retry once the active refresh lock expires or completes.',
          lock: {
            owner: error.lockOwner,
            expiresAt: error.expiresAt,
          },
        },
        409,
      );
    }
    if (error instanceof RefreshLockLostError) {
      return c.json(
        {
          error: 'Refresh lock lost during execution',
          actionable: 'Retry refresh now; heartbeat renewal indicates a competing run may have taken over.',
          lock: {
            owner: error.ownerId,
            reason: error.reason,
          },
        },
        409,
      );
    }

    const message = error instanceof Error ? error.message : 'Unknown seed refresh error';
    return c.json(
      {
        error: message,
        actionable: 'Verify GITHUB_TOKEN and DB schema migrations, then retry /api/refresh/seeds.',
      },
      500,
    );
  }
});

app.get('/api/profile/:handle', async (c) => {
  if (!c.env?.DB) {
    return c.json({ error: 'Profile storage unavailable' }, 503);
  }

  const handle = c.req.param('handle').trim().toLowerCase();
  const cacheVersion = await resolvePublicCacheVersion(c.env);

  try {
    return await respondWithCachedJson(c, {
      cacheKey: `profile:${handle}`,
      cacheVersion,
      localTtlMs: PROFILE_LOCAL_CACHE_TTL_MS,
      cacheControl: PROFILE_CACHE_CONTROL,
      skipCache: !hasD1Prepare(c.env.DB),
      load: async () => loadProfileByHandle(c.env.DB as D1Database, handle),
    });
  } catch (error) {
    if (error instanceof ProfileNotFoundError) {
      return c.json({ error: 'Profile not found' }, 404, { 'cache-control': 'public, max-age=30, s-maxage=30' });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[profile] failed to load handle=${handle}: ${message}`);
    return c.json({ error: 'Profile lookup failed' }, 500);
  }
});

app.get('/api/v/:handle', async (c) => {
  if (!c.env?.DB) {
    return c.json({ error: 'Profile storage unavailable' }, 503);
  }

  const handle = c.req.param('handle').trim().toLowerCase();
  const cacheVersion = await resolvePublicCacheVersion(c.env);

  try {
    return await respondWithCachedJson(c, {
      cacheKey: `profile:${handle}`,
      cacheVersion,
      localTtlMs: PROFILE_LOCAL_CACHE_TTL_MS,
      cacheControl: PROFILE_CACHE_CONTROL,
      skipCache: !hasD1Prepare(c.env.DB),
      load: async () => loadProfileByHandle(c.env.DB as D1Database, handle),
    });
  } catch (error) {
    if (error instanceof ProfileNotFoundError) {
      return c.json({ error: 'Profile not found' }, 404, { 'cache-control': 'public, max-age=30, s-maxage=30' });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[profile] failed to load /api/v handle=${handle}: ${message}`);
    return c.json({ error: 'Profile lookup failed' }, 500);
  }
});

app.get('/api/share/:handle/badge.svg', async (c) => {
  if (!c.env?.DB) {
    return c.text('Profile storage unavailable', 503);
  }

  let profile: ProfileResponse;
  try {
    profile = await loadProfileByHandle(c.env.DB, c.req.param('handle'));
  } catch (error) {
    if (error instanceof ProfileNotFoundError) {
      return c.text('Profile not found', 404);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[share] badge generation failed: ${message}`);
    return c.text('Profile lookup failed', 500);
  }

  return c.body(buildBadgeSvg(profile), 200, {
    'content-type': 'image/svg+xml; charset=utf-8',
    'cache-control': SHARE_CACHE_CONTROL,
  });
});

app.get('/api/share/:handle/stat-card.json', async (c) => {
  if (!c.env?.DB) {
    return c.json({ error: 'Profile storage unavailable' }, 503);
  }

  let profile: ProfileResponse;
  try {
    profile = await loadProfileByHandle(c.env.DB, c.req.param('handle'));
  } catch (error) {
    if (error instanceof ProfileNotFoundError) {
      return c.json({ error: 'Profile not found' }, 404);
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[share] stat-card generation failed: ${message}`);
    return c.json({ error: 'Profile lookup failed' }, 500);
  }

  c.header('cache-control', SHARE_CACHE_CONTROL);
  return c.json({
    version: 'v1',
    generatedAt: new Date().toISOString(),
    handle: profile.handle,
    rank: profile.leaderboard.rank,
    percentile: profile.leaderboard.percentile,
    stackTier: profile.stackTier,
    metrics: {
      equivalentEngineeringHours: profile.leaderboard.totals.equivalentEngineeringHours,
      mergedPrsCiVerified: profile.leaderboard.totals.mergedPrsCiVerified,
      mergedPrsUnverified: profile.leaderboard.totals.mergedPrsUnverified,
      commitsPerDay: profile.leaderboard.totals.commitsPerDay,
      activeCodingHours: profile.leaderboard.totals.activeCodingHours,
    },
    attribution: profile.leaderboard.attribution ?? {
      mode: 'repo-wide',
      source: 'github-author-login-match',
      strict: false,
      productionReady: true,
      notes: 'No persisted attribution metadata found for this profile.',
    },
    trust: {
      ciVerification: 'CI-verified merged PRs are used for EEH; unverified merged PR counts are exposed for transparency.',
    },
    productionReady: true,
    placeholder: false,
  });
});

app.all('*', async (c) => {
  const pathname = new URL(c.req.url).pathname;
  if (pathname.startsWith('/api/')) {
    return c.json({ error: 'Not found' }, 404);
  }

  if (!c.env?.ASSETS) {
    return c.text('Not found', 404);
  }

  const directAsset = await c.env.ASSETS.fetch(c.req.raw);
  if (directAsset.status !== 404) {
    return directAsset;
  }

  const fallbackUrl = new URL(c.req.url);
  fallbackUrl.pathname = '/index.html';
  return c.env.ASSETS.fetch(new Request(fallbackUrl.toString(), c.req.raw));
});

const worker: ExportedHandler<WorkerBindings> = {
  fetch(request, env, ctx) {
    return app.fetch(request, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runSeedRefresh(env, 'scheduled')
        .then((execution) => {
          const refresh = execution.refresh;
          const retentionSummary = execution.retention
            ? ` retention_deleted=${JSON.stringify(execution.retention.deletedRows)}`
            : '';
          console.log(
            `[refresh] scheduled seed refresh complete run=${refresh.runId} entries=${refresh.entriesProcessed}${retentionSummary}`,
          );
        })
        .catch((error) => {
          if (error instanceof RefreshLockConflictError) {
            console.log(`[refresh] scheduled seed refresh skipped; lock held by ${error.lockOwner ?? 'unknown'}`);
            return;
          }
          if (error instanceof RefreshLockLostError) {
            console.warn(
              `[refresh] scheduled seed refresh lock lost for owner=${error.ownerId}; reason=${error.reason}`,
            );
            return;
          }
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[refresh] scheduled seed refresh failed: ${message}`);
        }),
    );
  },
};

export default worker;

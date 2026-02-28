import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import leaderboardArtifact from '../../data/leaderboard.generated.json';
import seedCreators from '../../data/seed-creators.json';
import { exchangeGitHubOAuthCode, fetchGitHubAuthenticatedUser } from '../shared/github';
import { scanRepoByUrl } from '../shared/scanService';
import type { LeaderboardArtifact, ScanRequest, SeedCreator } from '../shared/types';
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

type WorkerBindings = Env & {
  GITHUB_TOKEN?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  OAUTH_TOKEN_ENCRYPTION_KEY?: string;
  REFRESH_ADMIN_HANDLES?: string;
  SESSION_TTL_HOURS?: string;
  DB?: D1Database;
};

type SessionAuthResult =
  | { ok: true; identity: AuthSessionIdentity }
  | { ok: false; response: Response };

type WorkerContext = Context<{ Bindings: WorkerBindings }>;

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
  if (expectedSig !== providedSig) {
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

async function runSeedRefresh(env: WorkerBindings, trigger: 'manual' | 'scheduled') {
  if (!env.DB) {
    throw new Error('DB binding is required for seed refresh operations.');
  }

  return refreshLeaderboardFromSeed(env.DB, seedCreators as SeedCreator[], env.GITHUB_TOKEN, trigger);
}

app.get('/api/health', (c) => {
  return c.json({ ok: true, service: 'velocity-mvp', now: new Date().toISOString() });
});

app.get('/api/leaderboard', (c) => {
  const db = c.env?.DB;
  if (!db) {
    return c.json(leaderboardArtifact as LeaderboardArtifact);
  }

  return ensureSeedData(db, leaderboardArtifact as LeaderboardArtifact)
    .then(() => getLeaderboardArtifact(db))
    .then((artifact) => c.json(artifact))
    .catch(() => c.json(leaderboardArtifact as LeaderboardArtifact));
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
    const report = await scanRepoByUrl(parsed.data.repoUrl, c.env?.GITHUB_TOKEN);
    if (c.env?.DB) {
      await persistScanReport(c.env.DB, report);
    }
    return c.json(report);
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
  if (!stateCookie || stateCookie !== state) {
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
    const refresh = await runSeedRefresh(c.env, 'manual');
    return c.json({
      ok: true,
      trigger: 'manual',
      triggeredBy: auth.identity.handle,
      refresh,
      productionReady: true,
      placeholder: false,
    });
  } catch (error) {
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

  await ensureSeedData(c.env.DB, leaderboardArtifact as LeaderboardArtifact);
  const profile = await getProfileByHandle(c.env.DB, c.req.param('handle'));
  if (!profile) {
    return c.json({ error: 'Profile not found' }, 404);
  }
  return c.json(profile);
});

app.get('/api/v/:handle', async (c) => {
  if (!c.env?.DB) {
    return c.json({ error: 'Profile storage unavailable' }, 503);
  }

  await ensureSeedData(c.env.DB, leaderboardArtifact as LeaderboardArtifact);
  const profile = await getProfileByHandle(c.env.DB, c.req.param('handle'));
  if (!profile) {
    return c.json({ error: 'Profile not found' }, 404);
  }
  return c.json(profile);
});

app.get('/api/share/:handle/badge.svg', async (c) => {
  if (!c.env?.DB) {
    return c.text('Profile storage unavailable', 503);
  }

  await ensureSeedData(c.env.DB, leaderboardArtifact as LeaderboardArtifact);
  const profile = await getProfileByHandle(c.env.DB, c.req.param('handle'));
  if (!profile) {
    return c.text('Profile not found', 404);
  }

  return c.body(buildBadgeSvg(profile), 200, {
    'content-type': 'image/svg+xml; charset=utf-8',
    'cache-control': 'public, max-age=300',
  });
});

app.get('/api/share/:handle/stat-card.json', async (c) => {
  if (!c.env?.DB) {
    return c.json({ error: 'Profile storage unavailable' }, 503);
  }

  await ensureSeedData(c.env.DB, leaderboardArtifact as LeaderboardArtifact);
  const profile = await getProfileByHandle(c.env.DB, c.req.param('handle'));
  if (!profile) {
    return c.json({ error: 'Profile not found' }, 404);
  }

  c.header('cache-control', 'public, max-age=300');
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
        .then((result) => {
          console.log(`[refresh] scheduled seed refresh complete run=${result.runId} entries=${result.entriesProcessed}`);
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[refresh] scheduled seed refresh failed: ${message}`);
        }),
    );
  },
};

export default worker;

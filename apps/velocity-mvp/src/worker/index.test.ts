import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../shared/scanService', () => ({
  scanRepoByUrl: vi.fn(),
}));

vi.mock('../shared/github', () => ({
  exchangeGitHubOAuthCode: vi.fn(),
  fetchGitHubAuthenticatedUser: vi.fn(),
}));

vi.mock('./data/db', () => ({
  ensureSeedData: vi.fn().mockResolvedValue(undefined),
  getLeaderboardArtifact: vi.fn().mockResolvedValue({
    generatedAt: '2026-02-27T00:00:00.000Z',
    sourceSeedPath: 'd1://leaderboard_rows',
    entries: [],
  }),
  persistScanReport: vi.fn().mockResolvedValue(undefined),
  getProfileByHandle: vi.fn().mockResolvedValue(null),
  buildBadgeSvg: vi.fn().mockReturnValue('<svg/>'),
  upsertGitHubOAuthIdentity: vi.fn().mockResolvedValue({ userId: 10, handle: 'alice', oauthAccountId: 5 }),
  createSessionRecord: vi.fn().mockResolvedValue(undefined),
  getSessionIdentityByTokenHash: vi.fn().mockResolvedValue(null),
  revokeSessionByTokenHash: vi.fn().mockResolvedValue(undefined),
  refreshLeaderboardFromSeed: vi.fn().mockResolvedValue({
    runId: 99,
    generatedAt: '2026-02-27T00:00:00.000Z',
    entriesProcessed: 3,
    sourceSeedPath: 'data/seed-creators.json',
    trigger: 'manual',
  }),
}));

import { app } from './index';
import { exchangeGitHubOAuthCode, fetchGitHubAuthenticatedUser } from '../shared/github';
import { scanRepoByUrl } from '../shared/scanService';
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
} from './data/db';

const scanRepoByUrlMock = vi.mocked(scanRepoByUrl);
const ensureSeedDataMock = vi.mocked(ensureSeedData);
const getLeaderboardArtifactMock = vi.mocked(getLeaderboardArtifact);
const persistScanReportMock = vi.mocked(persistScanReport);
const getProfileByHandleMock = vi.mocked(getProfileByHandle);
const buildBadgeSvgMock = vi.mocked(buildBadgeSvg);
const exchangeGitHubOAuthCodeMock = vi.mocked(exchangeGitHubOAuthCode);
const fetchGitHubAuthenticatedUserMock = vi.mocked(fetchGitHubAuthenticatedUser);
const upsertGitHubOAuthIdentityMock = vi.mocked(upsertGitHubOAuthIdentity);
const createSessionRecordMock = vi.mocked(createSessionRecord);
const getSessionIdentityByTokenHashMock = vi.mocked(getSessionIdentityByTokenHash);
const revokeSessionByTokenHashMock = vi.mocked(revokeSessionByTokenHash);
const refreshLeaderboardFromSeedMock = vi.mocked(refreshLeaderboardFromSeed);
const OAUTH_TOKEN_ENCRYPTION_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';

describe('worker routes', () => {
  beforeEach(() => {
    scanRepoByUrlMock.mockReset();
    ensureSeedDataMock.mockReset();
    ensureSeedDataMock.mockResolvedValue(undefined);
    getLeaderboardArtifactMock.mockReset();
    getLeaderboardArtifactMock.mockResolvedValue({
      generatedAt: '2026-02-27T00:00:00.000Z',
      sourceSeedPath: 'd1://leaderboard_rows',
      entries: [],
    });
    persistScanReportMock.mockReset();
    persistScanReportMock.mockResolvedValue(undefined);
    getProfileByHandleMock.mockReset();
    getProfileByHandleMock.mockResolvedValue(null);
    buildBadgeSvgMock.mockReset();
    buildBadgeSvgMock.mockReturnValue('<svg/>');

    exchangeGitHubOAuthCodeMock.mockReset();
    fetchGitHubAuthenticatedUserMock.mockReset();
    upsertGitHubOAuthIdentityMock.mockReset();
    upsertGitHubOAuthIdentityMock.mockResolvedValue({ userId: 10, handle: 'alice', oauthAccountId: 5 });
    createSessionRecordMock.mockReset();
    createSessionRecordMock.mockResolvedValue(undefined);
    getSessionIdentityByTokenHashMock.mockReset();
    getSessionIdentityByTokenHashMock.mockResolvedValue(null);
    revokeSessionByTokenHashMock.mockReset();
    revokeSessionByTokenHashMock.mockResolvedValue(undefined);
    refreshLeaderboardFromSeedMock.mockReset();
    refreshLeaderboardFromSeedMock.mockResolvedValue({
      runId: 99,
      generatedAt: '2026-02-27T00:00:00.000Z',
      entriesProcessed: 3,
      sourceSeedPath: 'data/seed-creators.json',
      trigger: 'manual',
    });
  });

  it('serves health endpoint', async () => {
    const response = await app.request('http://localhost/api/health');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; service: string };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('velocity-mvp');
  });

  it('serves leaderboard JSON', async () => {
    const response = await app.request('http://localhost/api/leaderboard');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { entries?: unknown[] };
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it('serves DB-backed leaderboard when D1 binding is available', async () => {
    getLeaderboardArtifactMock.mockResolvedValue({
      generatedAt: '2026-02-27T00:00:00.000Z',
      sourceSeedPath: 'd1://leaderboard_rows',
      entries: [
        {
          rank: 1,
          handle: 'alice',
          scannedRepos: 2,
          percentile: 100,
          stackTier: 2,
          crowns: ['velocity-king'],
          attribution: {
            mode: 'handle-authored',
            source: 'github-author-login-match',
            targetHandle: 'alice',
            strict: true,
            productionReady: true,
            notes: 'strict',
          },
          thirtyDay: { equivalentEngineeringHours: 90, mergedPrs: 11, commitsPerDay: 3.2, activeCodingHours: 40 },
          totals: {
            equivalentEngineeringHours: 120,
            mergedPrsUnverified: 12,
            mergedPrsCiVerified: 11,
            mergedPrs: 11,
            commitsPerDay: 3.4,
            activeCodingHours: 50,
            offHoursRatio: 0.3,
            velocityAcceleration: 0.2,
          },
          repos: [],
        },
      ],
    });

    const response = await app.request('http://localhost/api/leaderboard', undefined, { DB: {} as D1Database });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { entries: Array<{ percentile?: number; thirtyDay?: { mergedPrs?: number } }> };
    expect(body.entries[0]?.percentile).toBe(100);
    expect(body.entries[0]?.thirtyDay?.mergedPrs).toBe(11);
    expect(ensureSeedDataMock).toHaveBeenCalled();
    expect(getLeaderboardArtifactMock).toHaveBeenCalled();
  });

  it('returns 400 for invalid scan payload', async () => {
    const response = await app.request('http://localhost/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: 'not-a-url' }),
    });
    expect(response.status).toBe(400);
  });

  it('returns scan result for valid payload', async () => {
    scanRepoByUrlMock.mockResolvedValue({
      repo: { owner: 'acme', name: 'repo', url: 'https://github.com/acme/repo' },
      scannedAt: '2026-02-27T00:00:00.000Z',
      attribution: {
        mode: 'repo-wide',
        source: 'github-author-login-match',
        strict: false,
        productionReady: true,
        notes: 'repo-wide fallback',
      },
      assumptions: {
        offHoursDefinitionUtc: 'off-hours',
        equivalentEngineeringHoursFormula: 'eeh formula',
        defaultBranchScope: 'Merged PRs were evaluated only when targeting the repository default branch.',
        ciVerification: 'CI-verified merged PRs require merge commit SHA plus passing checks.',
      },
      metrics: {
        commitsPerDay: 1,
        mergedPrsUnverified: 3,
        mergedPrsCiVerified: 2,
        mergedPrs: 2,
        activeCodingHours: 20,
        offHoursRatio: 0.4,
        velocityAcceleration: 0.1,
        equivalentEngineeringHours: 44,
      },
      windows: [],
    });

    const response = await app.request(
      'http://localhost/api/scan',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/acme/repo' }),
      },
      { GITHUB_TOKEN: undefined },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { metrics?: { mergedPrsCiVerified?: number }; attribution?: { mode?: string } };
    expect(body.metrics?.mergedPrsCiVerified).toBe(2);
    expect(body.attribution?.mode).toBe('repo-wide');
  });

  it('persists scan result when D1 binding is available', async () => {
    scanRepoByUrlMock.mockResolvedValue({
      repo: { owner: 'acme', name: 'repo', url: 'https://github.com/acme/repo' },
      scannedAt: '2026-02-27T00:00:00.000Z',
      attribution: {
        mode: 'repo-wide',
        source: 'github-author-login-match',
        strict: false,
        productionReady: true,
        notes: 'repo-wide fallback',
      },
      assumptions: {
        offHoursDefinitionUtc: 'off-hours',
        equivalentEngineeringHoursFormula: 'eeh formula',
        defaultBranchScope: 'Merged PRs were evaluated only when targeting the repository default branch.',
        ciVerification: 'CI-verified merged PRs require merge commit SHA plus passing checks.',
      },
      metrics: {
        commitsPerDay: 1,
        mergedPrsUnverified: 3,
        mergedPrsCiVerified: 2,
        mergedPrs: 2,
        activeCodingHours: 20,
        offHoursRatio: 0.4,
        velocityAcceleration: 0.1,
        equivalentEngineeringHours: 44,
      },
      windows: [],
    });

    const response = await app.request(
      'http://localhost/api/scan',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/acme/repo' }),
      },
      { DB: {} as D1Database, GITHUB_TOKEN: undefined },
    );

    expect(response.status).toBe(200);
    expect(persistScanReportMock).toHaveBeenCalledTimes(1);
  });

  it('returns explicit missing-env error for GitHub OAuth start', async () => {
    const response = await app.request('http://localhost/api/auth/github/start', undefined, {
      DB: {} as D1Database,
      APP_ENV: 'development',
    });

    expect(response.status).toBe(500);
    const body = (await response.json()) as { missing?: string[]; actionable?: string };
    expect(body.missing).toContain('GITHUB_CLIENT_ID');
    expect(body.missing).toContain('GITHUB_CLIENT_SECRET');
    expect(body.missing).toContain('SESSION_SECRET');
    expect(body.actionable).toContain('wrangler secret put');
  });

  it('returns 400 for OAuth callback missing code/state', async () => {
    const response = await app.request('http://localhost/api/auth/github/callback', undefined, {
      DB: {} as D1Database,
      APP_ENV: 'development',
      GITHUB_CLIENT_ID: 'id',
      GITHUB_CLIENT_SECRET: 'secret',
      SESSION_SECRET: 'session-secret',
      OAUTH_TOKEN_ENCRYPTION_KEY,
    });

    expect(response.status).toBe(400);
  });

  it('redirects OAuth callback to /v/:handle by default', async () => {
    exchangeGitHubOAuthCodeMock.mockResolvedValue({
      accessToken: 'gho_plain_token',
      tokenType: 'bearer',
      scope: 'read:user',
    });
    fetchGitHubAuthenticatedUserMock.mockResolvedValue({
      login: 'alice',
      id: 101,
      name: 'Alice',
      avatar_url: 'https://avatars.githubusercontent.com/u/101',
      html_url: 'https://github.com/alice',
    });

    const baseEnv = {
      DB: {} as D1Database,
      APP_ENV: 'development' as const,
      GITHUB_CLIENT_ID: 'id',
      GITHUB_CLIENT_SECRET: 'secret',
      SESSION_SECRET: 'session-secret',
      OAUTH_TOKEN_ENCRYPTION_KEY,
    };
    const startResponse = await app.request('http://localhost/api/auth/github/start', undefined, baseEnv);
    expect(startResponse.status).toBe(302);

    const authorizeLocation = startResponse.headers.get('location');
    expect(authorizeLocation).toBeTruthy();
    const state = new URL(authorizeLocation as string).searchParams.get('state');
    expect(state).toBeTruthy();

    const callbackResponse = await app.request(
      `http://localhost/api/auth/github/callback?code=oauth-code&state=${encodeURIComponent(state as string)}`,
      {
        headers: { cookie: `velocity_oauth_state=${state}` },
      },
      baseEnv,
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe('http://localhost/v/alice');
    const accountPayload = upsertGitHubOAuthIdentityMock.mock.calls[0]?.[2] as { encryptedAccessToken?: string };
    expect(accountPayload.encryptedAccessToken).toMatch(/^v1\./);
    expect(accountPayload.encryptedAccessToken).not.toBe('gho_plain_token');
  });

  it('returns JSON from OAuth callback when format=json is requested', async () => {
    exchangeGitHubOAuthCodeMock.mockResolvedValue({
      accessToken: 'gho_plain_token',
      tokenType: 'bearer',
      scope: 'read:user',
    });
    fetchGitHubAuthenticatedUserMock.mockResolvedValue({
      login: 'alice',
      id: 101,
      name: 'Alice',
      avatar_url: 'https://avatars.githubusercontent.com/u/101',
      html_url: 'https://github.com/alice',
    });

    const baseEnv = {
      DB: {} as D1Database,
      APP_ENV: 'development' as const,
      GITHUB_CLIENT_ID: 'id',
      GITHUB_CLIENT_SECRET: 'secret',
      SESSION_SECRET: 'session-secret',
      OAUTH_TOKEN_ENCRYPTION_KEY,
    };
    const startResponse = await app.request('http://localhost/api/auth/github/start', undefined, baseEnv);
    expect(startResponse.status).toBe(302);

    const authorizeLocation = startResponse.headers.get('location');
    const state = new URL(authorizeLocation as string).searchParams.get('state');
    expect(state).toBeTruthy();

    const callbackResponse = await app.request(
      `http://localhost/api/auth/github/callback?code=oauth-code&state=${encodeURIComponent(state as string)}&format=json`,
      {
        headers: { cookie: `velocity_oauth_state=${state}` },
      },
      baseEnv,
    );

    expect(callbackResponse.status).toBe(200);
    const body = (await callbackResponse.json()) as { redirectTo?: string; user?: { handle?: string } };
    expect(body.user?.handle).toBe('alice');
    expect(body.redirectTo).toBe('http://localhost/v/alice');
  });

  it('logs out and revokes server-side session when cookie exists', async () => {
    const response = await app.request(
      'http://localhost/api/auth/logout',
      {
        method: 'POST',
        headers: { cookie: 'velocity_session=abc123' },
      },
      {
        DB: {} as D1Database,
        APP_ENV: 'development',
        SESSION_SECRET: 'session-secret',
      },
    );

    expect(response.status).toBe(200);
    expect(revokeSessionByTokenHashMock).toHaveBeenCalledTimes(1);
  });

  it('returns 401 for /api/me without session', async () => {
    const response = await app.request('http://localhost/api/me', undefined, {
      DB: {} as D1Database,
      APP_ENV: 'development',
      SESSION_SECRET: 'session-secret',
    });

    expect(response.status).toBe(401);
  });

  it('returns /api/me payload when session lookup succeeds', async () => {
    getSessionIdentityByTokenHashMock.mockResolvedValue({
      sessionId: 'sess-1',
      handle: 'alice',
      userId: 1,
      expiresAt: '2026-03-15T00:00:00.000Z',
      provider: 'github',
      providerLogin: 'alice',
      providerUserId: '101',
      avatarUrl: 'https://avatars.githubusercontent.com/u/101',
      profileUrl: 'https://github.com/alice',
    });

    const response = await app.request(
      'http://localhost/api/me',
      {
        headers: { cookie: 'velocity_session=abc123' },
      },
      {
        DB: {} as D1Database,
        APP_ENV: 'development',
        SESSION_SECRET: 'session-secret',
      },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { authenticated?: boolean; user?: { handle?: string } };
    expect(body.authenticated).toBe(true);
    expect(body.user?.handle).toBe('alice');
  });

  it('requires auth for manual seed refresh', async () => {
    const response = await app.request(
      'http://localhost/api/refresh/seeds',
      { method: 'POST' },
      {
        DB: {} as D1Database,
        APP_ENV: 'development',
        SESSION_SECRET: 'session-secret',
      },
    );

    expect(response.status).toBe(401);
  });

  it('returns 403 for authenticated users not in refresh allowlist', async () => {
    getSessionIdentityByTokenHashMock.mockResolvedValue({
      sessionId: 'sess-1',
      handle: 'eve',
      userId: 2,
      expiresAt: '2026-03-15T00:00:00.000Z',
      provider: 'github',
      providerLogin: 'eve',
      providerUserId: '202',
      avatarUrl: null,
      profileUrl: null,
    });

    const response = await app.request(
      'http://localhost/api/refresh/seeds',
      {
        method: 'POST',
        headers: { cookie: 'velocity_session=abc123' },
      },
      {
        DB: {} as D1Database,
        APP_ENV: 'development',
        SESSION_SECRET: 'session-secret',
        REFRESH_ADMIN_HANDLES: 'alice,bob',
      },
    );

    expect(response.status).toBe(403);
    const body = (await response.json()) as { error?: string; allowlisted?: boolean };
    expect(body.error).toBe('Forbidden');
    expect(body.allowlisted).toBe(false);
    expect(refreshLeaderboardFromSeedMock).not.toHaveBeenCalled();
  });

  it('runs manual seed refresh for allowlisted authenticated sessions', async () => {
    getSessionIdentityByTokenHashMock.mockResolvedValue({
      sessionId: 'sess-1',
      handle: 'alice',
      userId: 1,
      expiresAt: '2026-03-15T00:00:00.000Z',
      provider: 'github',
      providerLogin: 'alice',
      providerUserId: '101',
      avatarUrl: null,
      profileUrl: null,
    });

    const response = await app.request(
      'http://localhost/api/refresh/seeds',
      {
        method: 'POST',
        headers: { cookie: 'velocity_session=abc123' },
      },
      {
        DB: {} as D1Database,
        APP_ENV: 'development',
        SESSION_SECRET: 'session-secret',
        GITHUB_TOKEN: 'ghp_token',
        REFRESH_ADMIN_HANDLES: 'alice,bob',
      },
    );

    expect(response.status).toBe(200);
    expect(refreshLeaderboardFromSeedMock).toHaveBeenCalledWith(expect.anything(), expect.any(Array), 'ghp_token', 'manual');
  });

  it('returns 400 when scanner classifies an invalid repository URL', async () => {
    scanRepoByUrlMock.mockRejectedValue(new Error('Invalid repository URL: bad URL shape'));

    const response = await app.request(
      'http://localhost/api/scan',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/acme/repo' }),
      },
      { GITHUB_TOKEN: undefined },
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('Invalid repository URL:');
  });

  it('returns 500 when scanner fails unexpectedly', async () => {
    scanRepoByUrlMock.mockRejectedValue(new Error('GitHub API 500: exploded'));

    const response = await app.request(
      'http://localhost/api/scan',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: 'https://github.com/acme/repo' }),
      },
      { GITHUB_TOKEN: undefined },
    );

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain('GitHub API 500');
  });

  it('returns 404 for unknown API route', async () => {
    const response = await app.request('http://localhost/api/unknown');
    expect(response.status).toBe(404);
  });

  it('serves profile JSON for /api/profile/:handle and /api/v/:handle', async () => {
    getProfileByHandleMock.mockResolvedValue({
      handle: 'alice',
      stackTier: 2,
      crowns: [{ key: 'velocity-king', label: 'Velocity King', awardedAt: '2026-02-27T00:00:00.000Z' }],
      leaderboard: {
        rank: 1,
        handle: 'alice',
        scannedRepos: 2,
        percentile: 100,
        attribution: {
          mode: 'handle-authored',
          source: 'github-author-login-match',
          targetHandle: 'alice',
          strict: true,
          productionReady: true,
          notes: 'strict',
        },
        totals: {
          equivalentEngineeringHours: 120,
          mergedPrsUnverified: 12,
          mergedPrsCiVerified: 11,
          mergedPrs: 11,
          commitsPerDay: 3.4,
          activeCodingHours: 50,
          offHoursRatio: 0.3,
          velocityAcceleration: 0.2,
        },
        repos: [],
      },
      history: [],
    });

    const profileResponse = await app.request('http://localhost/api/profile/alice', undefined, { DB: {} as D1Database });
    const vResponse = await app.request('http://localhost/api/v/alice', undefined, { DB: {} as D1Database });

    expect(profileResponse.status).toBe(200);
    expect(vResponse.status).toBe(200);
    const body = (await profileResponse.json()) as { handle?: string; stackTier?: number };
    expect(body.handle).toBe('alice');
    expect(body.stackTier).toBe(2);
  });

  it('returns profile share badge SVG', async () => {
    getProfileByHandleMock.mockResolvedValue({
      handle: 'alice',
      stackTier: 2,
      crowns: [],
      leaderboard: {
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
          equivalentEngineeringHours: 120,
          mergedPrsUnverified: 12,
          mergedPrsCiVerified: 11,
          mergedPrs: 11,
          commitsPerDay: 3.4,
          activeCodingHours: 50,
          offHoursRatio: 0.3,
          velocityAcceleration: 0.2,
        },
        repos: [],
      },
      history: [],
    });
    buildBadgeSvgMock.mockReturnValue('<svg role="img"></svg>');

    const response = await app.request('http://localhost/api/share/alice/badge.svg', undefined, { DB: {} as D1Database });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('image/svg+xml');
    const body = await response.text();
    expect(body).toContain('<svg');
  });

  it('returns share stat-card JSON', async () => {
    getProfileByHandleMock.mockResolvedValue({
      handle: 'alice',
      stackTier: 2,
      crowns: [],
      leaderboard: {
        rank: 1,
        handle: 'alice',
        scannedRepos: 2,
        percentile: 100,
        attribution: {
          mode: 'handle-authored',
          source: 'github-author-login-match',
          targetHandle: 'alice',
          strict: true,
          productionReady: true,
          notes: 'strict',
        },
        totals: {
          equivalentEngineeringHours: 120,
          mergedPrsUnverified: 12,
          mergedPrsCiVerified: 11,
          mergedPrs: 11,
          commitsPerDay: 3.4,
          activeCodingHours: 50,
          offHoursRatio: 0.3,
          velocityAcceleration: 0.2,
        },
        repos: [],
      },
      history: [],
    });

    const response = await app.request('http://localhost/api/share/alice/stat-card.json', undefined, { DB: {} as D1Database });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { version?: string; attribution?: { mode?: string } };
    expect(body.version).toBe('v1');
    expect(body.attribution?.mode).toBe('handle-authored');
  });

  it('falls back to index asset for non-api route', async () => {
    const assets = {
      fetch: async (request: Request): Promise<Response> => {
        const path = new URL(request.url).pathname;
        if (path === '/index.html') {
          return new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } });
        }
        return new Response('Not found', { status: 404 });
      },
    };
    const response = await app.request('http://localhost/some/route', undefined, { ASSETS: assets });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('<html>ok</html>');
  });
});

import type { LeaderboardArtifact, ProfileResponse, RepoReportCard } from '../shared/types';

export interface AuthIdentity {
  handle: string;
  githubLogin: string;
  githubId: string;
  avatarUrl?: string;
  profileUrl?: string;
}

interface AuthMeResponse {
  authenticated: true;
  user: AuthIdentity;
}

async function parseApiError(response: Response, fallback: string): Promise<string> {
  const raw = (await response.text()).trim();
  if (raw.length === 0) {
    return fallback;
  }

  try {
    const payload = JSON.parse(raw) as { error?: unknown; message?: unknown };
    if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
      return payload.error;
    }
    if (typeof payload.message === 'string' && payload.message.trim().length > 0) {
      return payload.message;
    }
  } catch {
    // Non-JSON error payloads are returned as raw text.
  }

  return raw.slice(0, 240);
}

export async function fetchLeaderboard(): Promise<LeaderboardArtifact> {
  const response = await fetch('/api/leaderboard');
  if (!response.ok) {
    throw new Error(`Failed to fetch leaderboard (${response.status})`);
  }
  return (await response.json()) as LeaderboardArtifact;
}

export async function scanRepository(repoUrl: string): Promise<RepoReportCard> {
  const response = await fetch('/api/scan', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ repoUrl }),
  });

  if (!response.ok) {
    throw new Error(await parseApiError(response, `Scan failed (${response.status})`));
  }

  return (await response.json()) as RepoReportCard;
}

export async function fetchProfile(handle: string): Promise<ProfileResponse> {
  const response = await fetch(`/api/profile/${encodeURIComponent(handle)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch profile (${response.status})`);
  }
  return (await response.json()) as ProfileResponse;
}

export async function fetchAuthIdentity(): Promise<AuthIdentity | null> {
  const response = await fetch('/api/me', { credentials: 'same-origin' });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await parseApiError(response, `Failed to fetch auth session (${response.status})`));
  }

  const payload = (await response.json()) as AuthMeResponse;
  const user = payload.user;
  if (!user || typeof user.handle !== 'string' || typeof user.githubLogin !== 'string' || typeof user.githubId !== 'string') {
    throw new Error('Invalid /api/me payload');
  }
  return user;
}

export async function logoutAuthSession(): Promise<void> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  });
  if (!response.ok) {
    throw new Error(await parseApiError(response, `Sign out failed (${response.status})`));
  }
}

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS oauth_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_login TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_type TEXT,
  scope TEXT,
  avatar_url TEXT,
  profile_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_refreshed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (provider, provider_user_id),
  UNIQUE (provider, provider_login),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS repo_ownership (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  repo_id INTEGER NOT NULL,
  attribution_mode TEXT NOT NULL,
  attribution_source TEXT NOT NULL,
  attribution_target_handle TEXT,
  strict_attribution INTEGER NOT NULL DEFAULT 0,
  ownership_source TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_verified_at TEXT,
  UNIQUE (user_id, repo_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS refresh_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger_type TEXT NOT NULL,
  source_seed_path TEXT NOT NULL,
  status TEXT NOT NULL,
  generated_at TEXT,
  entries_processed INTEGER,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE snapshots ADD COLUMN attribution_mode TEXT NOT NULL DEFAULT 'repo-wide';
ALTER TABLE snapshots ADD COLUMN attribution_source TEXT NOT NULL DEFAULT 'github-author-login-match';
ALTER TABLE snapshots ADD COLUMN attributed_handle TEXT;
ALTER TABLE snapshots ADD COLUMN attribution_strict INTEGER NOT NULL DEFAULT 0;

ALTER TABLE scans ADD COLUMN attribution_json TEXT;

ALTER TABLE leaderboard_rows ADD COLUMN attribution_mode TEXT NOT NULL DEFAULT 'repo-wide';
ALTER TABLE leaderboard_rows ADD COLUMN attribution_source TEXT NOT NULL DEFAULT 'github-author-login-match';
ALTER TABLE leaderboard_rows ADD COLUMN attribution_target_handle TEXT;
ALTER TABLE leaderboard_rows ADD COLUMN attribution_strict INTEGER NOT NULL DEFAULT 0;

ALTER TABLE profile_metrics_history ADD COLUMN refresh_run_id INTEGER REFERENCES refresh_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_oauth_accounts_user ON oauth_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_accounts_provider_login ON oauth_accounts(provider, provider_login);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_repo_ownership_user_repo ON repo_ownership(user_id, repo_id);
CREATE INDEX IF NOT EXISTS idx_repo_ownership_handle ON repo_ownership(attribution_target_handle);
CREATE INDEX IF NOT EXISTS idx_refresh_runs_status_started ON refresh_runs(status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_refresh_run ON profile_metrics_history(refresh_run_id);

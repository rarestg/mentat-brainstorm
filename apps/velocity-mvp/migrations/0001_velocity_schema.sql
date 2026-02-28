PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS repos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  repo_id INTEGER,
  snapshot_type TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  commits_per_day REAL NOT NULL,
  merged_prs_unverified INTEGER NOT NULL,
  merged_prs_ci_verified INTEGER NOT NULL,
  merged_prs INTEGER NOT NULL,
  active_coding_hours REAL NOT NULL,
  off_hours_ratio REAL NOT NULL,
  velocity_acceleration REAL NOT NULL,
  equivalent_engineering_hours REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL UNIQUE,
  assumptions_json TEXT NOT NULL,
  windows_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (snapshot_id) REFERENCES snapshots(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS leaderboard_rows (
  user_id INTEGER PRIMARY KEY,
  rank INTEGER NOT NULL,
  scanned_repos INTEGER NOT NULL,
  featured_repo TEXT,
  ai_ready_score REAL,
  scan_insight TEXT,
  total_equivalent_engineering_hours REAL NOT NULL,
  total_merged_prs_unverified INTEGER NOT NULL,
  total_merged_prs_ci_verified INTEGER NOT NULL,
  total_merged_prs INTEGER NOT NULL,
  total_commits_per_day REAL NOT NULL,
  total_active_coding_hours REAL NOT NULL,
  total_off_hours_ratio REAL NOT NULL,
  total_velocity_acceleration REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crowns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  crown_key TEXT NOT NULL,
  label TEXT NOT NULL,
  awarded_at TEXT NOT NULL,
  UNIQUE (user_id, crown_key),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profile_metrics_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  rank INTEGER NOT NULL,
  percentile REAL NOT NULL,
  stack_tier INTEGER NOT NULL,
  equivalent_engineering_hours REAL NOT NULL,
  merged_prs INTEGER NOT NULL,
  commits_per_day REAL NOT NULL,
  active_coding_hours REAL NOT NULL,
  UNIQUE (user_id, captured_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_handle ON users(handle);
CREATE INDEX IF NOT EXISTS idx_repos_owner_name ON repos(owner, name);
CREATE INDEX IF NOT EXISTS idx_snapshots_user_scanned_at ON snapshots(user_id, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_snapshots_type_scanned_at ON snapshots(snapshot_type, scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_user_captured_at ON profile_metrics_history(user_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_crowns_user ON crowns(user_id);

-- Cotly initial schema. All timestamps are UTC epoch seconds.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  created_at INTEGER NOT NULL
);

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  verifier TEXT,
  redirect_uri TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE social_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  access_token_enc TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_expires_at INTEGER,
  scopes TEXT,
  meta TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'connected',
  last_verified_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider, external_id)
);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  original_filename TEXT,
  r2_key TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_s REAL,
  created_at INTEGER NOT NULL
);

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT,
  base_caption TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at INTEGER,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  publish_mode TEXT NOT NULL DEFAULT 'scheduled',
  media_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX idx_posts_status ON posts(status, scheduled_at);

CREATE TABLE post_media (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (post_id, media_id)
);

CREATE TABLE post_targets (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  social_account_id TEXT REFERENCES social_accounts(id) ON DELETE SET NULL,
  platform TEXT NOT NULL,
  caption_override TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled',
  scheduled_at INTEGER NOT NULL,
  provider_post_id TEXT,
  provider_permalink TEXT,
  last_error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  publish_generation INTEGER NOT NULL DEFAULT 1,
  published_at INTEGER,
  next_retry_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_targets_due ON post_targets(status, scheduled_at);
CREATE INDEX idx_targets_retry ON post_targets(status, next_retry_at);
CREATE INDEX idx_targets_post ON post_targets(post_id);

CREATE TABLE publishing_attempts (
  id TEXT PRIMARY KEY,
  post_target_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  result TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  provider_response_summary TEXT,
  retryable INTEGER
);
CREATE INDEX idx_attempts_target ON publishing_attempts(post_target_id, attempt_number);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE platform_usage (
  provider TEXT NOT NULL,
  period_ym TEXT NOT NULL,
  writes INTEGER NOT NULL DEFAULT 0,
  est_cost_usd REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, period_ym)
);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'info',
  event TEXT NOT NULL,
  ref_type TEXT,
  ref_id TEXT,
  message TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_activity_created ON activity_log(created_at);

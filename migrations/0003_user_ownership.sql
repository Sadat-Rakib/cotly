-- Cotly multi-user ownership scoping. Every social account and OAuth start now
-- belongs to the Cotly user that created it; posts.owner_id already exists.
-- Existing rows belong to the single original owner.

-- social_accounts needs a new unique constraint that includes owner_id, so the
-- table is rebuilt (SQLite cannot alter constraints). Data is preserved.
CREATE TABLE social_accounts_new (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'owner',
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
  UNIQUE(owner_id, provider, external_id)
);
INSERT INTO social_accounts_new (id, owner_id, provider, external_id, display_name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, scopes, meta, status, last_verified_at, created_at, updated_at)
SELECT id, 'owner', provider, external_id, display_name, avatar_url, access_token_enc, refresh_token_enc, token_expires_at, scopes, meta, status, last_verified_at, created_at, updated_at FROM social_accounts;
DROP TABLE social_accounts;
ALTER TABLE social_accounts_new RENAME TO social_accounts;
CREATE INDEX idx_social_accounts_owner ON social_accounts(owner_id);
CREATE INDEX idx_posts_owner ON posts(owner_id);
ALTER TABLE oauth_states ADD COLUMN owner_id TEXT;

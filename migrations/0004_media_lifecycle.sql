-- Media lifecycle: expiry stamped at upload + an explicit status.
-- Timestamps are epoch seconds, matching the rest of the schema.
ALTER TABLE media ADD COLUMN expires_at INTEGER;
ALTER TABLE media ADD COLUMN status TEXT NOT NULL DEFAULT 'ready';

-- Legacy rows predate expiry; give them the 7-day default from their
-- created_at so cleanup covers them without special cases.
UPDATE media SET expires_at = created_at + 604800 WHERE expires_at IS NULL;

CREATE INDEX idx_media_expires_at ON media(expires_at);
CREATE INDEX idx_media_owner ON media(owner_id);

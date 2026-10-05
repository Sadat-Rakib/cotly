-- Per-user settings. The old `settings` KV is deployment-global (scheduler
-- bookkeeping stays there); anything a user configures in Profile lives here
-- so two people on the same deployment never overwrite each other.
CREATE TABLE user_settings (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Seed every existing user with the deployment-wide values in effect before
-- this migration so nobody's behavior changes.
INSERT INTO user_settings (user_id, key, value)
SELECT u.id, 'media_retention_hours', s.value FROM users u
JOIN settings s ON s.key = 'media_retention_hours' AND s.value <> '';

INSERT INTO user_settings (user_id, key, value)
SELECT u.id, 'x_budget_mode', s.value FROM users u
JOIN settings s ON s.key = 'x_budget_mode';

INSERT INTO user_settings (user_id, key, value)
SELECT u.id, 'x_budget_monthly_usd', s.value FROM users u
JOIN settings s ON s.key = 'x_budget_monthly_usd';

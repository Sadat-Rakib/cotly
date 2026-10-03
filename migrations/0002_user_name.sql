-- Cotly V2: profile name on users (nullable; the composer/profile UI fills it).
ALTER TABLE users ADD COLUMN name TEXT;

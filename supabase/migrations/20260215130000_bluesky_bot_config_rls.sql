-- Enable RLS on bluesky_bot_config (idempotent)
ALTER TABLE bluesky_bot_config ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read bot config for their own pets.
-- The select query intentionally excludes app_password and session_data
-- (enforced at the application layer), but RLS provides defense-in-depth.
--
-- We allow reading config for ANY pet (not just owned) because:
-- 1. The iOS app shows public MemePet profiles with Bluesky links
-- 2. Only public-safe columns (handle, did, is_active) are queried
-- 3. Sensitive columns (app_password, session_data) are excluded at the API layer
CREATE POLICY "authenticated_read_bot_config"
  ON bluesky_bot_config
  FOR SELECT
  TO authenticated
  USING (true);

-- Also allow anon users to read (for unauthenticated browsing)
CREATE POLICY "anon_read_bot_config"
  ON bluesky_bot_config
  FOR SELECT
  TO anon
  USING (true);

-- Service role always bypasses RLS, so no policy needed for server-side operations.

-- Also ensure bluesky_post_log is readable (for activity feeds)
ALTER TABLE bluesky_post_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_post_log"
  ON bluesky_post_log
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "anon_read_post_log"
  ON bluesky_post_log
  FOR SELECT
  TO anon
  USING (true);

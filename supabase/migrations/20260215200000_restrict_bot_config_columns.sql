-- SECURITY FIX: Restrict anon/authenticated access to sensitive columns
-- app_password and session_data should only be readable by service_role
-- (which bypasses RLS and column grants)
--
-- All production server code uses service_role_key.
-- iOS/client only queries: pet_id, handle, did, is_active

-- Step 1: Revoke all SELECT on the table from anon and authenticated
REVOKE SELECT ON bluesky_bot_config FROM anon, authenticated;

-- Step 2: Grant SELECT only on safe columns
GRANT SELECT (
  id,
  pet_id,
  did,
  handle,
  pds_url,
  is_active,
  posting_frequency,
  created_at,
  updated_at,
  chronotype,
  schedule_state,
  utc_offset_hours
) ON bluesky_bot_config TO anon, authenticated;

-- Note: RLS policies remain unchanged (row-level, not column-level)
-- Note: service_role bypasses both RLS and column-level grants

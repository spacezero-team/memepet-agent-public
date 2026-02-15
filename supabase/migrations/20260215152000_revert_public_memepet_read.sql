-- Revert public meme pet read policy.
-- Users should only see their own pets (existing RLS behavior is correct).
DROP POLICY IF EXISTS "public_read_memepets" ON pet;

-- Allow public read access to meme pets (pets with meme JSONB populated).
-- Meme pets are autonomous social media bots meant to be publicly discoverable.
-- Non-meme pets (regular pets without meme data) remain restricted to their owner.
--
-- This fixes the issue where iOS users could only see their own meme pets
-- but not others' meme pets in the discovery feed.

-- Policy: anyone (authenticated or anon) can SELECT pets where meme IS NOT NULL
CREATE POLICY "public_read_memepets"
  ON pet
  FOR SELECT
  TO authenticated, anon
  USING (meme IS NOT NULL);

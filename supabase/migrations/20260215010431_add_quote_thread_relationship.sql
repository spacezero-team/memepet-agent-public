-- Add new enum values for quote posts and threads
ALTER TYPE bluesky_activity_type ADD VALUE IF NOT EXISTS 'engagement_quote';
ALTER TYPE bluesky_activity_type ADD VALUE IF NOT EXISTS 'proactive_thread';

-- Create pet_relationship table for relationship memory
-- Note: pet.id is TEXT type
CREATE TABLE IF NOT EXISTS pet_relationship (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id_a TEXT NOT NULL REFERENCES pet(id) ON DELETE CASCADE,
  pet_id_b TEXT NOT NULL REFERENCES pet(id) ON DELETE CASCADE,
  sentiment TEXT NOT NULL DEFAULT 'acquaintance',
  sentiment_score NUMERIC(3, 2) DEFAULT 0.0 CHECK (sentiment_score >= -1.0 AND sentiment_score <= 1.0),
  interaction_count INTEGER DEFAULT 0,
  last_interaction_type TEXT,
  last_interaction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_pet_relationship UNIQUE (pet_id_a, pet_id_b)
);

CREATE INDEX IF NOT EXISTS idx_pet_relationship_a ON pet_relationship(pet_id_a);
CREATE INDEX IF NOT EXISTS idx_pet_relationship_b ON pet_relationship(pet_id_b);

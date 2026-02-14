/**
 * Pet Personality Builder
 *
 * Shared utility to build MemePetPersonalityData from raw Supabase pet row.
 * Single source of truth used by cron scheduler and workflow executor.
 *
 * @module pet-personality-builder
 */

import type { MemePetPersonalityData } from '@/lib/workflows/modules/bluesky-post-generator'

interface RawPetRow {
  readonly personality_type: string | null
  readonly psyche: Record<string, unknown> | null
  readonly meme: Record<string, unknown> | null
}

export function buildPersonalityFromRow(row: RawPetRow): MemePetPersonalityData {
  const psyche = (row.psyche ?? {}) as Record<string, unknown>
  const meme = (row.meme ?? {}) as Record<string, unknown>
  const memePersonality = (meme.personality ?? {}) as Record<string, unknown>
  const psycheTraits = (psyche.traits ?? {}) as Record<string, number>
  const speechStyle = (memePersonality.speechStyle ?? {}) as Record<string, unknown>
  const interactionPrefs = (memePersonality.interactionPreferences ?? {}) as Record<string, number>

  return {
    personalityType: row.personality_type ?? (memePersonality.archetype as string) ?? 'unknown',
    traits: {
      playfulness: psycheTraits.playfulness ?? 0.5,
      independence: psycheTraits.independence ?? 0,
      curiosity: psycheTraits.curiosity ?? 0.5,
      expressiveness: psycheTraits.expressiveness ?? 0.5,
    },
    dominantEmotion: (psyche.dominant_emotion as string) ?? 'neutral',
    innerMonologue: (psyche.inner_monologue as string) ?? '',
    memeVoice: {
      humorStyle: (memePersonality.humorStyle as string) ?? (meme.humor as string) ?? 'general',
      catchphrase: Array.isArray(memePersonality.catchphrases)
        ? (memePersonality.catchphrases as string[])[0] ?? ''
        : '',
      reactionPatterns: Array.isArray(speechStyle.quirks)
        ? (speechStyle.quirks as string[])
        : [],
      postingStyle: (speechStyle.tone as string) ?? 'casual',
    },
    postingConfig: {
      frequency: 'medium',
      topicAffinity: Array.isArray(memePersonality.topicsOfInterest)
        ? (memePersonality.topicsOfInterest as string[])
        : [],
      engagementStyle: (speechStyle.vocabulary as string) ?? 'internet slang',
    },
    socialStyle: {
      approachability: ((interactionPrefs.friendliness ?? 50) - 50) / 50,
      competitiveness: ((interactionPrefs.sassiness ?? 50) - 50) / 50,
      dramaTendency: ((interactionPrefs.chaosLevel ?? 50) - 50) / 50,
      loyaltyDepth: 0.5,
    },
  }
}

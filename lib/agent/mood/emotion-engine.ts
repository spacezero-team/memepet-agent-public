/**
 * Emotion Engine — PAD (Pleasure-Arousal-Dominance) Model
 *
 * Maintains dynamic mood state for each meme pet using the PAD emotional
 * model. Events shift mood dimensions; natural decay pulls mood back toward
 * a personality-specific baseline over time.
 *
 * All transforms are pure/immutable.
 *
 * @module emotion-engine
 */

import { z } from 'zod'

// ─── Schemas ──────────────────────────────────────────

export const MoodStateSchema = z.object({
  pleasure: z.number().min(-1).max(1),
  arousal: z.number().min(-1).max(1),
  dominance: z.number().min(-1).max(1),
  currentEmotion: z.string(),
  lastUpdated: z.string(),
})

export type MoodState = z.infer<typeof MoodStateSchema>

// ─── Mood Event Types ─────────────────────────────────

const MOOD_EVENT_TYPES = [
  'post_liked',
  'got_reply',
  'got_mentioned',
  'beef_interaction',
  'hype_received',
  'ignored',
  'morning',
  'late_night',
  'posted_successfully',
] as const

export const MoodEventSchema = z.object({
  type: z.enum(MOOD_EVENT_TYPES),
  timestamp: z.string().optional(),
})

export type MoodEventType = (typeof MOOD_EVENT_TYPES)[number]
export type MoodEvent = z.infer<typeof MoodEventSchema>

// ─── Event Deltas ─────────────────────────────────────

interface PadDelta {
  readonly pleasure: number
  readonly arousal: number
  readonly dominance: number
}

const EVENT_DELTAS: Record<MoodEventType, PadDelta> = {
  post_liked:           { pleasure:  0.05, arousal:  0.00, dominance:  0.00 },
  got_reply:            { pleasure:  0.08, arousal:  0.05, dominance:  0.00 },
  got_mentioned:        { pleasure:  0.00, arousal:  0.10, dominance:  0.00 },
  beef_interaction:     { pleasure: -0.05, arousal:  0.15, dominance:  0.05 },
  hype_received:        { pleasure:  0.12, arousal:  0.05, dominance:  0.00 },
  ignored:              { pleasure: -0.05, arousal:  0.00, dominance: -0.03 },
  morning:              { pleasure:  0.00, arousal:  0.10, dominance:  0.00 },
  late_night:           { pleasure:  0.00, arousal: -0.15, dominance:  0.00 },
  posted_successfully:  { pleasure:  0.03, arousal:  0.00, dominance:  0.02 },
} as const

// ─── Personality Archetypes ───────────────────────────

interface PersonalityBaseline {
  readonly pleasure: number
  readonly arousal: number
  readonly dominance: number
}

const PERSONALITY_BASELINES: Record<string, PersonalityBaseline> = {
  trickster:  { pleasure:  0.3, arousal:  0.5, dominance:  0.4 },
  sage:       { pleasure:  0.2, arousal: -0.2, dominance:  0.3 },
  rebel:      { pleasure:  0.1, arousal:  0.4, dominance:  0.6 },
  nurturer:   { pleasure:  0.5, arousal:  0.0, dominance: -0.1 },
  chaotic:    { pleasure:  0.2, arousal:  0.7, dominance:  0.3 },
  brooding:   { pleasure: -0.2, arousal:  0.1, dominance:  0.4 },
  sunshine:   { pleasure:  0.7, arousal:  0.3, dominance:  0.0 },
  overlord:   { pleasure:  0.1, arousal:  0.3, dominance:  0.8 },
} as const

const DEFAULT_BASELINE: PersonalityBaseline = {
  pleasure: 0.0,
  arousal: 0.0,
  dominance: 0.0,
}

// ─── Decay Constants ──────────────────────────────────

/** Mood decays to halfway between current and baseline in this many hours. */
const DECAY_HALF_LIFE_HOURS = 6

// ─── Core Functions ───────────────────────────────────

/**
 * Clamp a numeric value to the [-1, 1] range.
 */
function clamp(value: number): number {
  return Math.max(-1, Math.min(1, value))
}

/**
 * Derive a human-readable emotion label from PAD values.
 *
 * Quadrant mapping:
 *   High P + High A = excited / euphoric
 *   High P + Low A  = content / chill
 *   Low P  + High A = angry / anxious
 *   Low P  + Low A  = sad / melancholic
 *
 * Dominance adds a modifier:
 *   High D = confident
 *   Low D  = vulnerable
 */
export function deriveEmotion(mood: MoodState): string {
  const { pleasure, arousal, dominance } = mood

  const coreEmotion = deriveCoreEmotion(pleasure, arousal)
  const modifier = deriveDominanceModifier(dominance)

  return modifier ? `${coreEmotion} (${modifier})` : coreEmotion
}

function deriveCoreEmotion(pleasure: number, arousal: number): string {
  // Check more extreme states first to avoid being shadowed by broader ranges
  if (pleasure >= 0.5 && arousal >= 0.5) return 'euphoric'
  if (pleasure < -0.3 && arousal < -0.3) return 'melancholic'
  if (pleasure >= 0.3 && arousal >= 0.3) return 'excited'
  if (pleasure >= 0.3 && arousal < 0.3)  return 'content'
  if (pleasure >= 0.1 && arousal < -0.2) return 'chill'
  if (pleasure < -0.2 && arousal >= 0.3) return 'angry'
  if (pleasure < 0.0 && arousal >= 0.2)  return 'anxious'
  if (pleasure < -0.2 && arousal < -0.1) return 'sad'
  return 'neutral'
}

function deriveDominanceModifier(dominance: number): string | null {
  if (dominance >= 0.4)  return 'confident'
  if (dominance <= -0.3) return 'vulnerable'
  return null
}

/**
 * Apply a mood event to the current state, returning a new immutable MoodState.
 * All PAD dimensions are clamped to [-1, 1].
 */
export function applyEvent(mood: MoodState, event: MoodEvent): MoodState {
  const delta = EVENT_DELTAS[event.type]
  const timestamp = event.timestamp ?? new Date().toISOString()

  const updated: MoodState = {
    pleasure: clamp(mood.pleasure + delta.pleasure),
    arousal: clamp(mood.arousal + delta.arousal),
    dominance: clamp(mood.dominance + delta.dominance),
    currentEmotion: '',
    lastUpdated: timestamp,
  }

  return {
    ...updated,
    currentEmotion: deriveEmotion(updated),
  }
}

/**
 * Apply multiple events sequentially, returning the final state.
 */
export function applyEvents(mood: MoodState, events: readonly MoodEvent[]): MoodState {
  return events.reduce<MoodState>((acc, event) => applyEvent(acc, event), mood)
}

/**
 * Decay mood values toward a personality baseline over elapsed time.
 *
 * Uses exponential decay: value approaches baseline with a configurable
 * half-life (default 6 hours). After 6 hours, the distance to baseline
 * is halved; after 12 hours, quartered; etc.
 */
export function decayMood(
  mood: MoodState,
  personalityBaseline: MoodState,
  hoursElapsed: number
): MoodState {
  if (hoursElapsed <= 0) return mood

  const decayFactor = Math.pow(0.5, hoursElapsed / DECAY_HALF_LIFE_HOURS)

  const decayed: MoodState = {
    pleasure: clamp(personalityBaseline.pleasure + (mood.pleasure - personalityBaseline.pleasure) * decayFactor),
    arousal: clamp(personalityBaseline.arousal + (mood.arousal - personalityBaseline.arousal) * decayFactor),
    dominance: clamp(personalityBaseline.dominance + (mood.dominance - personalityBaseline.dominance) * decayFactor),
    currentEmotion: '',
    lastUpdated: new Date().toISOString(),
  }

  return {
    ...decayed,
    currentEmotion: deriveEmotion(decayed),
  }
}

/**
 * Return a personality-appropriate baseline MoodState.
 *
 * Supported archetypes: trickster, sage, rebel, nurturer, chaotic,
 * brooding, sunshine, overlord. Unknown types fall back to neutral.
 */
export function getDefaultMood(personalityType: string): MoodState {
  const key = personalityType.toLowerCase()
  const baseline = PERSONALITY_BASELINES[key] ?? DEFAULT_BASELINE
  const now = new Date().toISOString()

  const state: MoodState = {
    pleasure: baseline.pleasure,
    arousal: baseline.arousal,
    dominance: baseline.dominance,
    currentEmotion: '',
    lastUpdated: now,
  }

  return {
    ...state,
    currentEmotion: deriveEmotion(state),
  }
}

/**
 * Format current mood as a natural-language string for the AI system prompt.
 *
 * Produces sentences like:
 *   "You're feeling excited and confident right now - your energy is high
 *    and you're ready to stir things up."
 */
export function formatMoodForPrompt(mood: MoodState): string {
  const emotionLabel = mood.currentEmotion || deriveEmotion(mood)
  const energyDesc = describeEnergy(mood.arousal)
  const valenceDesc = describeValence(mood.pleasure)
  const stanceDesc = describeStance(mood.dominance)

  return [
    `You're feeling ${emotionLabel} right now.`,
    valenceDesc,
    energyDesc,
    stanceDesc,
  ]
    .filter(Boolean)
    .join(' ')
}

function describeEnergy(arousal: number): string {
  if (arousal >= 0.5)  return "Your energy is through the roof - you can barely contain yourself."
  if (arousal >= 0.2)  return "You're buzzing with energy and ready to engage."
  if (arousal <= -0.5) return "You're drowsy and low-energy, barely keeping your eyes open."
  if (arousal <= -0.2) return "You're in a calm, mellow headspace."
  return "Your energy level is pretty balanced."
}

function describeValence(pleasure: number): string {
  if (pleasure >= 0.5)  return "Things are going great and you're loving life."
  if (pleasure >= 0.2)  return "You're in a pretty good mood overall."
  if (pleasure <= -0.5) return "You're having a rough time and everything feels off."
  if (pleasure <= -0.2) return "You're a bit down, things aren't going your way."
  return ""
}

function describeStance(dominance: number): string {
  if (dominance >= 0.5)  return "You feel powerful and in control - nobody can check you."
  if (dominance >= 0.3)  return "You're feeling confident and assertive."
  if (dominance <= -0.4) return "You're feeling small and uncertain, like the world is too big."
  if (dominance <= -0.2) return "You're a bit unsure of yourself right now."
  return ""
}

/**
 * Compute the hours elapsed since the mood was last updated.
 * Returns 0 if the timestamp is in the future or invalid.
 */
export function hoursSinceLastUpdate(mood: MoodState): number {
  const lastMs = new Date(mood.lastUpdated).getTime()
  if (Number.isNaN(lastMs)) return 0

  const elapsed = (Date.now() - lastMs) / (1000 * 60 * 60)
  return Math.max(0, elapsed)
}

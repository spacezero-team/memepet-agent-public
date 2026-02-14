/**
 * Natural Posting Rhythm Engine
 *
 * Models human-like posting patterns: time-of-day awareness,
 * activity bursts, mood-based frequency, and organic gaps.
 *
 * @module posting-rhythm
 */

import type { MemePetPersonalityData } from '@/lib/workflows/modules/bluesky-post-generator'

// ─── Types ──────────────────────────────────────────

export interface PetScheduleState {
  readonly lastPostAt: string | null
  readonly dailyMood: DailyMood
  readonly moodDate: string | null
  readonly burst: BurstState | null
  readonly postsToday: number
  readonly postCountDate: string | null
}

export interface DailyMood {
  readonly frequencyMultiplier: number
  readonly label: 'silent' | 'quiet' | 'normal' | 'chatty' | 'hyperactive'
}

export interface BurstState {
  readonly startedAt: string
  readonly postsRemaining: number
  readonly intervalMinutes: number
}

export type Chronotype = 'early_bird' | 'normal' | 'night_owl'

// ─── Constants ──────────────────────────────────────

export const ACTIVITY_CURVES: Record<Chronotype, readonly number[]> = {
  early_bird: [
    0.0, 0.0, 0.0, 0.0, 0.05, 0.3, 0.7, 1.0, 1.0, 0.9, 0.8, 0.7,
    0.6, 0.5, 0.5, 0.4, 0.3, 0.2, 0.1, 0.05, 0.0, 0.0, 0.0, 0.0,
  ],
  normal: [
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.3, 0.5, 0.7, 0.8, 0.9,
    0.7, 0.6, 0.7, 0.8, 0.9, 1.0, 1.0, 0.9, 0.7, 0.5, 0.2, 0.0,
  ],
  night_owl: [
    0.5, 0.3, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.2, 0.3,
    0.5, 0.6, 0.7, 0.8, 0.9, 0.9, 1.0, 1.0, 1.0, 1.0, 0.9, 0.7,
  ],
} as const

const DAILY_POST_TARGETS: Record<string, number> = {
  high: 8,
  medium: 5,
  low: 2,
}

const MAX_POSTS_PER_DAY = 15
const MIN_POST_GAP_MINUTES = 25
const POST_BURST_COOLDOWN_MINUTES = 120

// ─── Decision Engine ────────────────────────────────

export interface PostDecision {
  readonly shouldPost: boolean
  readonly reason: string
  readonly updatedState: PetScheduleState
}

export function evaluatePostingDecision(params: {
  readonly now: Date
  readonly state: PetScheduleState
  readonly frequency: 'high' | 'medium' | 'low'
  readonly chronotype: Chronotype
  readonly personality: MemePetPersonalityData
  readonly utcOffsetHours: number
}): PostDecision {
  const { now, frequency, chronotype, personality, utcOffsetHours } = params
  let state = params.state

  // Step 1: Roll daily mood if new day
  const todayStr = toDateString(now, utcOffsetHours)
  if (state.moodDate !== todayStr) {
    state = {
      ...state,
      dailyMood: rollDailyMood(personality),
      moodDate: todayStr,
      postsToday: 0,
      postCountDate: todayStr,
    }
  }

  // Step 2: Daily cap
  const effectiveTarget = Math.round(
    DAILY_POST_TARGETS[frequency] * state.dailyMood.frequencyMultiplier
  )
  const dailyCap = Math.min(effectiveTarget + 2, MAX_POSTS_PER_DAY)

  if (state.postsToday >= dailyCap) {
    return { shouldPost: false, reason: `daily cap (${state.postsToday}/${dailyCap})`, updatedState: state }
  }

  // Step 3: Minimum gap
  if (state.lastPostAt) {
    const elapsed = now.getTime() - new Date(state.lastPostAt).getTime()
    if (elapsed < MIN_POST_GAP_MINUTES * 60 * 1000) {
      return { shouldPost: false, reason: `min gap (${Math.round(elapsed / 60000)}m < ${MIN_POST_GAP_MINUTES}m)`, updatedState: state }
    }
  }

  // Step 4: Post-burst cooldown
  if (state.burst && state.burst.postsRemaining <= 0) {
    const burstEnd = new Date(state.burst.startedAt).getTime() + POST_BURST_COOLDOWN_MINUTES * 60 * 1000
    if (now.getTime() < burstEnd) {
      return { shouldPost: false, reason: `burst cooldown (${Math.round((burstEnd - now.getTime()) / 60000)}m left)`, updatedState: { ...state, burst: null } }
    }
    state = { ...state, burst: null }
  }

  // Step 5: Active burst
  if (state.burst && state.burst.postsRemaining > 0) {
    if (state.lastPostAt) {
      const elapsed = now.getTime() - new Date(state.lastPostAt).getTime()
      if (elapsed < state.burst.intervalMinutes * 60 * 1000) {
        return { shouldPost: false, reason: `burst interval (${Math.round(elapsed / 60000)}m < ${state.burst.intervalMinutes}m)`, updatedState: state }
      }
    }
    return {
      shouldPost: true,
      reason: `burst post (${state.burst.postsRemaining} left)`,
      updatedState: {
        ...state,
        lastPostAt: now.toISOString(),
        postsToday: state.postsToday + 1,
        burst: { ...state.burst, postsRemaining: state.burst.postsRemaining - 1 },
      },
    }
  }

  // Step 6: Time-of-day gating
  const localHour = getLocalHour(now, utcOffsetHours)
  const activityLevel = ACTIVITY_CURVES[chronotype][localHour]

  if (activityLevel <= 0.0) {
    return { shouldPost: false, reason: `sleeping (hour=${localHour})`, updatedState: state }
  }

  // Step 7: Probabilistic posting
  const ticksPerDay = 48
  const avgActivity = averageActivityLevel(chronotype)
  const baseRate = effectiveTarget / (ticksPerDay * avgActivity)
  const postProbability = Math.min(activityLevel * baseRate, 0.85)
  const roll = Math.random()

  if (roll > postProbability) {
    return { shouldPost: false, reason: `prob skip (p=${postProbability.toFixed(3)}, roll=${roll.toFixed(3)})`, updatedState: state }
  }

  // Step 8: Maybe start burst
  const burstChance = computeBurstChance(personality)
  if (Math.random() < burstChance) {
    const burstSize = 1 + Math.floor(Math.random() * 2)
    const burstInterval = 5 + Math.floor(Math.random() * 20)
    return {
      shouldPost: true,
      reason: `burst start (${burstSize + 1} total, ${burstInterval}m apart)`,
      updatedState: {
        ...state,
        lastPostAt: now.toISOString(),
        postsToday: state.postsToday + 1,
        burst: { startedAt: now.toISOString(), postsRemaining: burstSize, intervalMinutes: burstInterval },
      },
    }
  }

  return {
    shouldPost: true,
    reason: `normal post (p=${postProbability.toFixed(3)}, mood=${state.dailyMood.label})`,
    updatedState: { ...state, lastPostAt: now.toISOString(), postsToday: state.postsToday + 1 },
  }
}

export function emptyScheduleState(): PetScheduleState {
  return {
    lastPostAt: null,
    dailyMood: { frequencyMultiplier: 1.0, label: 'normal' },
    moodDate: null,
    burst: null,
    postsToday: 0,
    postCountDate: null,
  }
}

// ─── Helpers ────────────────────────────────────────

function toDateString(date: Date, utcOffsetHours: number): string {
  const local = new Date(date.getTime() + utcOffsetHours * 3600000)
  return local.toISOString().slice(0, 10)
}

function getLocalHour(date: Date, utcOffsetHours: number): number {
  const localMs = date.getTime() + utcOffsetHours * 3600000
  return new Date(localMs).getUTCHours()
}

function averageActivityLevel(chronotype: Chronotype): number {
  const curve = ACTIVITY_CURVES[chronotype]
  return curve.reduce((acc, val) => acc + val, 0) / 24
}

function rollDailyMood(personality: MemePetPersonalityData): DailyMood {
  const volatility = 0.3 + (personality.traits.expressiveness * 0.2) + (Math.max(0, personality.socialStyle.dramaTendency) * 0.2)
  const baseTendency = 1.0 + (personality.traits.expressiveness - 0.5) * 0.3 - (personality.traits.independence * 0.1)

  const u1 = Math.random()
  const u2 = Math.random()
  const gaussian = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)

  const multiplier = Math.max(0.3, Math.min(2.0, baseTendency + gaussian * volatility))
  const label = moodLabel(multiplier)

  return { frequencyMultiplier: Math.round(multiplier * 100) / 100, label }
}

function moodLabel(m: number): DailyMood['label'] {
  if (m <= 0.4) return 'silent'
  if (m <= 0.7) return 'quiet'
  if (m <= 1.3) return 'normal'
  if (m <= 1.7) return 'chatty'
  return 'hyperactive'
}

function computeBurstChance(personality: MemePetPersonalityData): number {
  const base = 0.08
  const bonus = personality.traits.expressiveness * 0.08 + Math.max(0, personality.socialStyle.dramaTendency) * 0.06
  const penalty = personality.traits.independence * 0.04
  return Math.max(0.02, Math.min(0.25, base + bonus - penalty))
}

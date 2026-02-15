/**
 * Per-Bot Memory Types
 *
 * Structured memory that each bot maintains across posting sessions.
 * Stored as JSONB in the bot_memory Supabase table.
 *
 * @module bot-memory
 */

import { z } from 'zod'
import { MoodStateSchema } from '@/lib/agent/mood/emotion-engine'

const RecentPostDigestSchema = z.object({
  postedAt: z.string(),
  gist: z.string().max(80),
  mood: z.string(),
  topic: z.string(),
  intentType: z.string(),
  hasImage: z.boolean().optional(),
})

const RelationshipEntrySchema = z.object({
  name: z.string(),
  petId: z.string().nullable(),
  sentiment: z.enum([
    'rival', 'friend', 'crush', 'nemesis', 'acquaintance', 'fan', 'hater'
  ]),
  lastInteraction: z.string().max(100),
  lastInteractedAt: z.string(),
  interactionCount: z.number().int(),
})

const RunningThemeSchema = z.object({
  description: z.string().max(120),
  startedAt: z.string(),
  mentionCount: z.number().int(),
  status: z.enum(['active', 'cooling-off', 'retired']),
})

export const ReflectionInsightSchema = z.object({
  insight: z.string()
    .max(300)
    .describe('A high-level insight the pet formed from reflecting on recent activity'),
  category: z.enum(['self', 'relationship', 'world', 'goal'])
    .describe('What this insight is about'),
  confidence: z.number()
    .min(0)
    .max(1)
    .describe('Confidence level from 0.0 to 1.0'),
  createdAt: z.string()
    .describe('ISO timestamp of when this insight was formed'),
  basedOnPosts: z.number()
    .int()
    .min(0)
    .describe('How many recent posts contributed to this insight'),
})

export const BotMemorySchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  recentPosts: z.array(RecentPostDigestSchema).max(15),
  topicCooldowns: z.record(z.string(), z.string()),
  runningThemes: z.array(RunningThemeSchema).max(5),
  relationships: z.array(RelationshipEntrySchema).max(20),
  narrativeArc: z.string().max(300),
  currentMood: z.string().max(50),
  avoidList: z.array(z.string().max(80)).max(10),
  reflections: z.array(ReflectionInsightSchema).max(10).optional(),
  lastReflectionAt: z.string().optional(),
  moodState: MoodStateSchema.optional(),
})

export type BotMemory = z.infer<typeof BotMemorySchema>
export type RecentPostDigest = z.infer<typeof RecentPostDigestSchema>
export type RelationshipEntry = z.infer<typeof RelationshipEntrySchema>
export type RunningTheme = z.infer<typeof RunningThemeSchema>
export type ReflectionInsight = z.infer<typeof ReflectionInsightSchema>

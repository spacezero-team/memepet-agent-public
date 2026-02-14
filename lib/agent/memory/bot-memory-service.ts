/**
 * Bot Memory Service
 *
 * CRUD operations for per-bot memory stored in Supabase bot_memory table.
 * All state transformations are pure/immutable.
 *
 * @module bot-memory-service
 */

import { getServiceSupabase } from '@/lib/api/service-supabase'
import {
  BotMemorySchema,
  type BotMemory,
  type RecentPostDigest,
  type RelationshipEntry,
} from '@/lib/agent/types/bot-memory'

const DEFAULT_MEMORY: BotMemory = {
  version: 1,
  updatedAt: new Date().toISOString(),
  recentPosts: [],
  topicCooldowns: {},
  runningThemes: [],
  relationships: [],
  narrativeArc: '',
  currentMood: 'neutral',
  avoidList: [],
}

export async function loadBotMemory(petId: string): Promise<BotMemory> {
  const supabase = getServiceSupabase()

  const { data } = await (supabase as any)
    .from('bot_memory')
    .select('memory')
    .eq('pet_id', petId)
    .maybeSingle() as { data: { memory: unknown } | null }

  if (!data?.memory) {
    return { ...DEFAULT_MEMORY, updatedAt: new Date().toISOString() }
  }

  const parsed = BotMemorySchema.safeParse(data.memory)
  if (!parsed.success) {
    return { ...DEFAULT_MEMORY, updatedAt: new Date().toISOString() }
  }

  return parsed.data
}

export async function saveBotMemory(
  petId: string,
  memory: BotMemory
): Promise<void> {
  const supabase = getServiceSupabase()

  const updated: BotMemory = {
    ...memory,
    updatedAt: new Date().toISOString(),
  }

  await (supabase as any)
    .from('bot_memory')
    .upsert(
      { pet_id: petId, memory: updated },
      { onConflict: 'pet_id' }
    )
}

export function appendPostToMemory(
  memory: BotMemory,
  digest: RecentPostDigest
): BotMemory {
  const recentPosts = [digest, ...memory.recentPosts].slice(0, 15)

  const topicCooldowns = {
    ...memory.topicCooldowns,
    [digest.topic]: digest.postedAt,
  }

  return { ...memory, recentPosts, topicCooldowns, currentMood: digest.mood }
}

export function updateRelationship(
  memory: BotMemory,
  entry: RelationshipEntry
): BotMemory {
  const existingIdx = memory.relationships.findIndex(
    r => r.name === entry.name
  )

  const relationships = existingIdx >= 0
    ? memory.relationships.map((r, i) => i === existingIdx ? entry : r)
    : [...memory.relationships, entry].slice(-20)

  return { ...memory, relationships }
}

export function getTopicsOnCooldown(
  memory: BotMemory,
  cooldownHours: number = 8
): string[] {
  const cutoff = Date.now() - cooldownHours * 60 * 60 * 1000

  return Object.entries(memory.topicCooldowns)
    .filter(([, timestamp]) => new Date(timestamp).getTime() > cutoff)
    .map(([topic]) => topic)
}

export function cleanupCooldowns(memory: BotMemory): BotMemory {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000
  const cleaned = Object.fromEntries(
    Object.entries(memory.topicCooldowns)
      .filter(([, timestamp]) => new Date(timestamp).getTime() > cutoff)
  )
  return { ...memory, topicCooldowns: cleaned }
}

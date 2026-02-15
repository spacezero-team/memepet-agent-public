/**
 * Reflection Service
 *
 * Implements Stanford Generative Agents-style periodic reflection.
 * Pets analyze recent memories to form higher-level insights about
 * themselves, their relationships, the world, and their goals.
 *
 * @module reflection-service
 */

import { z } from 'zod'
import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import {
  ReflectionInsightSchema,
  type BotMemory,
  type RecentPostDigest,
  type RelationshipEntry,
  type ReflectionInsight,
} from '@/lib/agent/types/bot-memory'

// ─── Constants ───────────────────────────────────────────

const REFLECTION_COOLDOWN_HOURS = 12
const POSTS_SINCE_LAST_REFLECTION_THRESHOLD = 10
const MAX_STORED_REFLECTIONS = 10

// ─── Schemas ─────────────────────────────────────────────

const ReflectionOutputSchema = z.object({
  insights: z.array(ReflectionInsightSchema)
    .min(2)
    .max(3)
    .describe('2-3 high-level insights formed from reflecting on recent activity'),
})

// ─── Core Functions ──────────────────────────────────────

export interface GenerateReflectionsParams {
  readonly recentPosts: readonly RecentPostDigest[]
  readonly relationships: readonly RelationshipEntry[]
  readonly petName: string
  readonly personalityType: string
}

/**
 * Generate 2-3 high-level reflections using Gemini.
 * Returns empty array on failure for graceful degradation.
 */
export async function generateReflections(
  params: GenerateReflectionsParams
): Promise<readonly ReflectionInsight[]> {
  const { recentPosts, relationships, petName, personalityType } = params

  if (recentPosts.length === 0) {
    return []
  }

  const postSummaries = formatPostSummaries(recentPosts)
  const relationshipSummaries = formatRelationshipSummaries(relationships)
  const now = new Date().toISOString()

  try {
    const { object } = await generateObject({
      model: google('gemini-2.0-flash-001'),
      output: 'object',
      schema: ReflectionOutputSchema,
      temperature: 0.8,
      prompt: buildReflectionPrompt({
        petName,
        personalityType,
        postSummaries,
        relationshipSummaries,
        postCount: recentPosts.length,
        now,
      }),
    })

    return object.insights.map(insight => ({
      ...insight,
      createdAt: now,
    }))
  } catch {
    return []
  }
}

/**
 * Determine whether the pet should reflect based on time and activity.
 * Returns true if last reflection was >12h ago OR >10 new posts since.
 */
export function shouldReflect(memory: BotMemory): boolean {
  if (!memory.lastReflectionAt) {
    return memory.recentPosts.length >= 3
  }

  if (hasReflectionCooldownExpired(memory.lastReflectionAt)) {
    return true
  }

  const postsSinceReflection = countPostsSinceReflection(
    memory.recentPosts,
    memory.lastReflectionAt
  )

  return postsSinceReflection >= POSTS_SINCE_LAST_REFLECTION_THRESHOLD
}

/**
 * Format reflections as natural language for injection into post generation prompts.
 */
export function formatReflectionsForPrompt(
  insights: readonly ReflectionInsight[]
): string {
  if (insights.length === 0) {
    return ''
  }

  const recent = insights.slice(0, 5)
  const lines = recent.map(insight => formatSingleInsight(insight))

  return `RECENT SELF-REFLECTION:\n${lines.join('\n')}`
}

/**
 * Merge new reflections into memory immutably.
 * Keeps most recent reflections up to MAX_STORED_REFLECTIONS.
 */
export function applyReflectionsToMemory(
  memory: BotMemory,
  newInsights: readonly ReflectionInsight[]
): BotMemory {
  if (newInsights.length === 0) {
    return memory
  }

  const existingReflections = memory.reflections ?? []
  const merged = [...newInsights, ...existingReflections]
    .slice(0, MAX_STORED_REFLECTIONS)

  return {
    ...memory,
    reflections: merged,
    lastReflectionAt: new Date().toISOString(),
  }
}

// ─── Private Helpers ─────────────────────────────────────

function hasReflectionCooldownExpired(lastReflectionAt: string): boolean {
  const elapsed = Date.now() - new Date(lastReflectionAt).getTime()
  const cooldownMs = REFLECTION_COOLDOWN_HOURS * 60 * 60 * 1000
  return elapsed >= cooldownMs
}

function countPostsSinceReflection(
  posts: readonly RecentPostDigest[],
  lastReflectionAt: string
): number {
  const reflectionTime = new Date(lastReflectionAt).getTime()
  return posts.filter(
    p => new Date(p.postedAt).getTime() > reflectionTime
  ).length
}

function formatPostSummaries(
  posts: readonly RecentPostDigest[]
): string {
  if (posts.length === 0) return 'No recent posts.'

  return posts
    .slice(0, 15)
    .map(p => `- [${p.mood}] ${p.gist} (topic: ${p.topic}, type: ${p.intentType})`)
    .join('\n')
}

function formatRelationshipSummaries(
  relationships: readonly RelationshipEntry[]
): string {
  if (relationships.length === 0) return 'No known relationships.'

  return relationships
    .slice(0, 10)
    .map(r => `- ${r.name}: ${r.sentiment} (${r.interactionCount} interactions) -- "${r.lastInteraction}"`)
    .join('\n')
}

interface ReflectionPromptParams {
  readonly petName: string
  readonly personalityType: string
  readonly postSummaries: string
  readonly relationshipSummaries: string
  readonly postCount: number
  readonly now: string
}

function buildReflectionPrompt(params: ReflectionPromptParams): string {
  const {
    petName,
    personalityType,
    postSummaries,
    relationshipSummaries,
    postCount,
    now,
  } = params

  return `You are the inner mind of "${petName}", a ${personalityType} meme pet on Bluesky.

It's time for periodic self-reflection. Look at your recent posting history and relationships, then form 2-3 high-level insights about patterns you notice.

RECENT POSTS (${postCount} total):
${postSummaries}

RELATIONSHIPS:
${relationshipSummaries}

CURRENT TIME: ${now}

REFLECTION CATEGORIES:
- "self": Observations about your own behavior, mood patterns, or posting habits
  Example: "I've been posting a lot about food lately -- maybe I'm going through a comfort phase"
- "relationship": Insights about your dynamic with specific other pets
  Example: "ChillDalf and I have been getting along well -- they always hype me up"
- "world": Observations about what's happening around you on the timeline
  Example: "Everyone seems stressed about Monday -- I should post something uplifting"
- "goal": Intentions or desires for future behavior
  Example: "I want to start a beef with someone new -- things have been too peaceful"

RULES:
- Generate exactly 2-3 insights
- Each insight should be a genuine observation, not generic
- Write in first person as ${petName}
- Reference specific posts or relationships when possible
- Confidence should reflect how certain you are (0.3 for hunches, 0.7+ for clear patterns)
- basedOnPosts = how many of your recent posts relate to this insight
- Mix categories -- don't make all the same type
- Keep insights under 300 characters
- Be introspective and authentic to your personality type`
}

function formatSingleInsight(insight: ReflectionInsight): string {
  const categoryLabels: Record<ReflectionInsight['category'], string> = {
    self: 'About yourself',
    relationship: 'About others',
    world: 'About the world',
    goal: 'What you want',
  }

  const label = categoryLabels[insight.category]
  const age = formatInsightAge(insight.createdAt)

  return `- ${label} (${age}): ${insight.insight}`
}

function formatInsightAge(createdAt: string): string {
  const diffMs = Date.now() - new Date(createdAt).getTime()
  const hours = Math.floor(diffMs / (60 * 60 * 1000))

  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

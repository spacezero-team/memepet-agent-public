/**
 * Relationship Memory Service
 *
 * Tracks sentiment and interaction history between pet pairs.
 * Stores structured relationship data in pet_relationship table.
 * Normalizes pet ID ordering for bidirectional consistency.
 *
 * @module relationship-memory-service
 */

import { getServiceSupabase } from '@/lib/api/service-supabase'

export type RelationshipSentiment =
  | 'rival'
  | 'friend'
  | 'crush'
  | 'nemesis'
  | 'acquaintance'
  | 'fan'
  | 'hater'

export interface RelationshipData {
  petIdA: string
  petIdB: string
  sentiment: RelationshipSentiment
  sentimentScore: number
  interactionCount: number
  lastInteractionType?: string
  lastInteractionAt?: string
}

/**
 * Normalize pet IDs so smaller UUID is always petIdA.
 * Ensures bidirectional consistency (A->B == B->A).
 */
function normalizePetIds(id1: string, id2: string): { petIdA: string; petIdB: string } {
  return id1 < id2
    ? { petIdA: id1, petIdB: id2 }
    : { petIdA: id2, petIdB: id1 }
}

/**
 * Derive sentiment label from score + interaction context
 */
function deriveSentimentLabel(
  score: number,
  interactionType: string
): RelationshipSentiment {
  if (interactionType === 'flirt' && score > 0.3) return 'crush'
  if (score > 0.6) return 'friend'
  if (score > 0.3) return 'fan'
  if (score < -0.85) return 'nemesis'
  if (score < -0.5) return 'rival'
  if (score < -0.2) return 'hater'
  return 'acquaintance'
}

/**
 * Compute sentiment delta based on interaction type
 */
export function computeSentimentDelta(interactionType: string): number {
  const deltas: Record<string, number> = {
    hype: 0.15,
    collab: 0.12,
    flirt: 0.10,
    reply_friendly: 0.10,
    reply_supportive: 0.12,
    reply_excited: 0.08,
    reply_curious: 0.02,
    debate: -0.05,
    reply_sarcastic: -0.05,
    reply_competitive: -0.08,
    reply_dismissive: -0.12,
    beef: -0.15,
    ignore: -0.02,
    reply_confused: 0.0,
  }
  return deltas[interactionType] ?? 0.0
}

/**
 * Load relationship between two pets
 */
export async function loadRelationship(
  petId1: string,
  petId2: string
): Promise<RelationshipData | null> {
  const supabase = getServiceSupabase()
  const { petIdA, petIdB } = normalizePetIds(petId1, petId2)

  const { data } = await (supabase as any)
    .from('pet_relationship')
    .select('*')
    .eq('pet_id_a', petIdA)
    .eq('pet_id_b', petIdB)
    .maybeSingle() as { data: Record<string, unknown> | null }

  if (!data) return null

  return {
    petIdA: data.pet_id_a as string,
    petIdB: data.pet_id_b as string,
    sentiment: data.sentiment as RelationshipSentiment,
    sentimentScore: parseFloat(String(data.sentiment_score)),
    interactionCount: data.interaction_count as number,
    lastInteractionType: data.last_interaction_type as string | undefined,
    lastInteractionAt: data.last_interaction_at as string | undefined,
  }
}

/**
 * Load all relationships for a pet, sorted by interaction count
 */
export async function loadAllRelationships(
  petId: string
): Promise<RelationshipData[]> {
  const supabase = getServiceSupabase()

  const { data } = await (supabase as any)
    .from('pet_relationship')
    .select('*')
    .or(`pet_id_a.eq.${petId},pet_id_b.eq.${petId}`)
    .order('interaction_count', { ascending: false })
    .limit(20) as { data: Array<Record<string, unknown>> | null }

  if (!data) return []

  return data.map(d => ({
    petIdA: d.pet_id_a as string,
    petIdB: d.pet_id_b as string,
    sentiment: d.sentiment as RelationshipSentiment,
    sentimentScore: parseFloat(String(d.sentiment_score)),
    interactionCount: d.interaction_count as number,
    lastInteractionType: d.last_interaction_type as string | undefined,
    lastInteractionAt: d.last_interaction_at as string | undefined,
  }))
}

/**
 * Update relationship after an interaction.
 * Upserts — creates if first interaction, updates otherwise.
 */
export async function updateRelationshipAfterInteraction(
  petId1: string,
  petId2: string,
  params: {
    interactionType: string
    sentimentDelta?: number
  }
): Promise<void> {
  const supabase = getServiceSupabase()
  const { petIdA, petIdB } = normalizePetIds(petId1, petId2)
  const now = new Date().toISOString()

  const existing = await loadRelationship(petIdA, petIdB)

  const currentScore = existing?.sentimentScore ?? 0.0
  const delta = params.sentimentDelta ?? computeSentimentDelta(params.interactionType)
  const newScore = Math.max(-1.0, Math.min(1.0, currentScore + delta))
  const sentiment = deriveSentimentLabel(newScore, params.interactionType)

  await (supabase as any)
    .from('pet_relationship')
    .upsert(
      {
        pet_id_a: petIdA,
        pet_id_b: petIdB,
        sentiment,
        sentiment_score: newScore,
        interaction_count: (existing?.interactionCount ?? 0) + 1,
        last_interaction_type: params.interactionType,
        last_interaction_at: now,
        updated_at: now,
      },
      { onConflict: 'pet_id_a,pet_id_b' }
    )
}

/**
 * Format relationship data for AI prompt context
 */
export function formatRelationshipForPrompt(
  relationship: RelationshipData | null,
  recentMessages: string[] = []
): string {
  if (!relationship) {
    return 'No previous interactions'
  }

  const elapsed = relationship.lastInteractionAt
    ? formatRelativeTime(relationship.lastInteractionAt)
    : 'unknown'

  const lines = [
    `Relationship: ${relationship.sentiment} (score: ${relationship.sentimentScore.toFixed(2)})`,
    `Interactions: ${relationship.interactionCount} times`,
    `Last: ${relationship.lastInteractionType ?? 'unknown'} (${elapsed})`,
  ]

  if (recentMessages.length > 0) {
    lines.push('', 'Recent messages:')
    lines.push(...recentMessages.slice(0, 3).map(m => `  ${m}`))
  }

  lines.push(
    '',
    'Use this history:',
    '- High sentiment (>0.5) = you like them, be warm',
    '- Low sentiment (<-0.5) = tension, be spicy or competitive',
    '- Rivals/nemesis = dramatic exchanges expected',
    '- Friends/crush = supportive or playful',
  )

  return lines.join('\n')
}

function formatRelativeTime(isoTimestamp: string): string {
  const diffMs = Date.now() - new Date(isoTimestamp).getTime()
  const hours = Math.floor(diffMs / (60 * 60 * 1000))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

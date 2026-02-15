/**
 * Engagement Content Filter
 *
 * Pre-filters timeline/search candidates before AI evaluation.
 * Removes sensitive content, spam, own posts, and other pet posts.
 *
 * @module engagement-filter
 */

export interface EngagementCandidate {
  postUri: string
  postCid: string
  authorHandle: string
  authorDid: string
  text: string
}

export interface FilteredCandidate {
  candidate: EngagementCandidate
  filtered: boolean
  filterReason?: string
  /** True if this user has never interacted with the pet before */
  isFirstInteraction?: boolean
}

const SENSITIVE_KEYWORDS = [
  'politics', 'election', 'trump', 'biden', 'democrat', 'republican',
  'abortion', 'gun control', 'immigration', 'genocide', 'holocaust',
  'suicide', 'self-harm', 'nazi', 'terrorist', 'mass shooting',
]

const SPAM_INDICATORS = [
  'buy now', 'click here', 'free crypto', 'airdrop', 'dm me',
  'follow for follow', 'f4f', 'promo code', 'giveaway', 'limited time',
]

export function preFilterCandidates(
  candidates: EngagementCandidate[],
  ownDid: string,
  otherPetDids: Set<string>,
  previouslyInteractedDids?: Set<string>
): FilteredCandidate[] {
  return candidates.map(candidate => {
    const textLower = candidate.text.toLowerCase()

    if (candidate.authorDid === ownDid) {
      return { candidate, filtered: true, filterReason: 'own_post' }
    }

    // Filter out other MemePet bots (use interaction mode instead)
    if (otherPetDids.has(candidate.authorDid)) {
      return { candidate, filtered: true, filterReason: 'other_pet' }
    }

    if (SENSITIVE_KEYWORDS.some(kw => textLower.includes(kw))) {
      return { candidate, filtered: true, filterReason: 'sensitive_content' }
    }

    if (SPAM_INDICATORS.some(kw => textLower.includes(kw))) {
      return { candidate, filtered: true, filterReason: 'spam' }
    }

    if (candidate.text.trim().length < 10) {
      return { candidate, filtered: true, filterReason: 'too_short' }
    }

    // Mark first-time vs returning users for opt-in engagement
    const isFirstInteraction = previouslyInteractedDids
      ? !previouslyInteractedDids.has(candidate.authorDid)
      : true

    return { candidate, filtered: false, isFirstInteraction }
  })
}

/**
 * Load DIDs of users who have previously interacted with this pet
 * (mentioned, replied to, or engaged with the pet's posts)
 */
export async function loadPreviouslyInteractedDids(
  petId: string,
  supabaseClient: ReturnType<typeof import('@/lib/api/service-supabase').getServiceSupabase>
): Promise<Set<string>> {
  const { data } = await (supabaseClient as any)
    .from('bluesky_post_log')
    .select('metadata')
    .eq('pet_id', petId)
    .in('activity_type', [
      'reactive_reply',
      'engagement_comment',
      'engagement_like',
      'engagement_quote',
    ])
    .order('created_at', { ascending: false })
    .limit(200) as { data: Array<{ metadata: Record<string, unknown> }> | null }

  const dids = new Set<string>()
  for (const row of data ?? []) {
    const did = row.metadata?.engagedAuthorDid as string | undefined
    const replyDid = row.metadata?.inReplyToAuthorDid as string | undefined
    if (did) dids.add(did)
    if (replyDid) dids.add(replyDid)
  }
  return dids
}

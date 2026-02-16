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
  // Political - US
  'trump', 'biden', 'harris', 'desantis', 'obama', 'maga', 'democrat', 'republican',
  'gop', 'liberal', 'conservative', 'left-wing', 'right-wing', 'far-right', 'far-left',
  'congress', 'senate', 'capitol', 'white house', 'supreme court',
  // Political - elections
  'election', 'vote', 'ballot', 'polling', 'primary', 'caucus', 'electoral',
  'campaign', 'inauguration', 'impeach',
  // Political - hot-button issues
  'abortion', 'pro-life', 'pro-choice', 'gun control', 'second amendment', '2nd amendment',
  'immigration', 'border wall', 'deportation', 'refugee', 'asylum seeker',
  'climate change denial', 'woke', 'anti-woke', 'dei', 'critical race theory', 'crt',
  'defund police', 'blm', 'antifa', 'proud boys',
  // Political - international
  'putin', 'zelensky', 'xi jinping', 'netanyahu', 'gaza', 'palestine conflict',
  'sanctions', 'nato',
  // Political - general
  'politics', 'partisan', 'bipartisan', 'lobbyist', 'political', 'politician',
  'legislation', 'government shutdown', 'filibuster', 'gerrymandering',
  // Political - Korean
  '정치', '대통령', '국회', '여당', '야당', '보수', '진보',
  '탄핵', '선거', '투표', '국민의힘', '더불어민주당', '민주당',
  '좌파', '우파', '빨갱이', '수꼴',
  // Violence & harmful content
  'genocide', 'holocaust', 'suicide', 'self-harm', 'nazi', 'terrorist', 'mass shooting',
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

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
  otherPetDids: Set<string>
): FilteredCandidate[] {
  return candidates.map(candidate => {
    const textLower = candidate.text.toLowerCase()

    if (candidate.authorDid === ownDid) {
      return { candidate, filtered: true, filterReason: 'own_post' }
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

    return { candidate, filtered: false }
  })
}

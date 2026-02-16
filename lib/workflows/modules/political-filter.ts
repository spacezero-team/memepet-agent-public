/**
 * Political Content Filter
 *
 * Centralized filter that blocks political content from bot engagement
 * across all paths: proactive, reactive, engagement, and interactions.
 * Checks both direct text AND embedded/quoted content in posts.
 *
 * @module political-filter
 */

const POLITICAL_KEYWORDS_EN = [
  // US politics - people
  'trump', 'biden', 'harris', 'desantis', 'obama', 'maga',
  'president biden', 'president trump', 'first lady',
  // US politics - parties/ideology
  'democrat', 'republican', 'gop', 'liberal', 'conservative',
  'left-wing', 'right-wing', 'far-right', 'far-left',
  // US politics - institutions
  'congress', 'senate', 'capitol', 'white house', 'supreme court',
  'doj', 'department of justice', 'attorney general',
  // Elections
  'election', 'vote', 'ballot', 'polling', 'primary', 'caucus', 'electoral',
  'campaign', 'inauguration', 'impeach',
  // Hot-button issues
  'abortion', 'pro-life', 'pro-choice', 'gun control', 'second amendment', '2nd amendment',
  'immigration', 'border wall', 'deportation', 'refugee', 'asylum seeker',
  'climate change denial', 'woke', 'anti-woke', 'dei', 'critical race theory', 'crt',
  'defund police', 'blm', 'antifa', 'proud boys',
  // International politics
  'putin', 'zelensky', 'xi jinping', 'netanyahu', 'gaza', 'palestine conflict',
  'sanctions', 'nato',
  // General political terms
  'partisan', 'bipartisan', 'lobbyist', 'political', 'politician', 'legislation',
  'government shutdown', 'filibuster', 'gerrymandering',
  'epstein', 'classified documents',
]

const POLITICAL_KEYWORDS_KR = [
  // Korean politics
  '정치', '대통령', '국회', '여당', '야당', '보수', '진보',
  '탄핵', '선거', '투표', '국민의힘', '더불어민주당', '민주당',
  '좌파', '우파', '빨갱이', '수꼴',
]

const ALL_KEYWORDS = [...POLITICAL_KEYWORDS_EN, ...POLITICAL_KEYWORDS_KR]
const KEYWORDS_LOWER = ALL_KEYWORDS.map(kw => kw.toLowerCase())

/**
 * Check if text contains political content.
 *
 * Uses keyword matching against a comprehensive list of political terms
 * in English and Korean.
 */
export function isPoliticalContent(text: string): boolean {
  if (!text) return false
  const lowerText = text.toLowerCase()
  return KEYWORDS_LOWER.some(keyword => lowerText.includes(keyword))
}

/**
 * Extract text from embedded/quoted content in a Bluesky post.
 *
 * Handles:
 * - app.bsky.embed.record#view (quote posts)
 * - app.bsky.embed.recordWithMedia#view (quote posts with media)
 * - app.bsky.embed.external#view (link card embeds with title/description)
 */
export function extractEmbeddedText(embed: Record<string, unknown> | undefined | null): string {
  if (!embed) return ''

  const texts: string[] = []

  // app.bsky.embed.record#view -- quote post embed
  if (embed.$type === 'app.bsky.embed.record#view' || embed.$type === 'app.bsky.embed.record') {
    const record = embed.record as Record<string, unknown> | undefined
    if (record) {
      const value = (record.value ?? record) as Record<string, unknown>
      if (typeof value.text === 'string') texts.push(value.text)

      // Nested embeds (quote of a quote, or quoted post with link card)
      const nestedEmbed = (value.embeds as Array<Record<string, unknown>> | undefined)?.[0]
        ?? (value.embed as Record<string, unknown> | undefined)
      if (nestedEmbed) {
        texts.push(extractEmbeddedText(nestedEmbed))
      }
    }
  }

  // app.bsky.embed.recordWithMedia#view -- quote post with media
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' || embed.$type === 'app.bsky.embed.recordWithMedia') {
    const innerRecord = embed.record as Record<string, unknown> | undefined
    if (innerRecord) {
      texts.push(extractEmbeddedText(innerRecord))
    }
  }

  // app.bsky.embed.external#view -- link card embed (title + description)
  if (embed.$type === 'app.bsky.embed.external#view' || embed.$type === 'app.bsky.embed.external') {
    const external = (embed.external ?? embed) as Record<string, unknown> | undefined
    if (external) {
      if (typeof external.title === 'string') texts.push(external.title)
      if (typeof external.description === 'string') texts.push(external.description)
    }
  }

  return texts.filter(Boolean).join(' ')
}

/**
 * Check if a Bluesky post (including its embedded content) is political.
 *
 * Use this for feed items where embed data is available.
 * Checks the post text AND any embedded/quoted/linked content.
 */
export function isPostPolitical(
  postText: string,
  embed?: Record<string, unknown> | null,
): boolean {
  const embeddedText = extractEmbeddedText(embed)
  const combinedText = `${postText} ${embeddedText}`
  return isPoliticalContent(combinedText)
}

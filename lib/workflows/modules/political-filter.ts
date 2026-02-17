/**
 * Political Content Filter
 *
 * Centralized filter that blocks political content from bot engagement
 * across all paths: proactive, reactive, engagement, and interactions.
 * Checks both direct text AND embedded/quoted content in posts.
 *
 * Uses word-boundary matching (\b) to prevent false positives like
 * "favorite" matching "vote" or "deity" matching "dei".
 *
 * @module political-filter
 */

const POLITICAL_KEYWORDS_EN = [
  // US politics - people (proper nouns, safe for word-boundary)
  'trump', 'biden', 'harris', 'kamala', 'desantis', 'obama', 'maga',
  'melania', 'jill biden', 'president biden', 'president trump', 'first lady',
  'mar-a-lago', 'ivanka', 'kushner',
  // US politics - parties/ideology (multi-word or specific enough)
  'democrat', 'republican', 'gop',
  'left-wing', 'right-wing', 'far-right', 'far-left',
  // US politics - institutions
  'capitol hill', 'white house', 'supreme court', 'scotus',
  'department of justice', 'attorney general',
  // Elections (multi-word to avoid false positives)
  'election day', 'ballot box', 'electoral college', 'electoral vote',
  'inauguration', 'impeach', 'impeachment', 'indictment', 'arraignment',
  // Hot-button issues
  'abortion', 'pro-life', 'pro-choice', 'roe v wade',
  'gun control', 'second amendment', '2nd amendment',
  'border wall', 'deportation', 'asylum seeker',
  'climate change denial', 'anti-woke',
  'critical race theory',
  'defund police', 'black lives matter', 'antifa', 'proud boys',
  // International politics
  'putin', 'zelensky', 'xi jinping', 'netanyahu', 'gaza',
  'palestine conflict', 'hamas', 'hezbollah',
  'ukraine war',
  // General political terms (specific enough)
  'partisan', 'bipartisan', 'lobbyist', 'politician',
  'government shutdown', 'filibuster', 'gerrymandering',
  'epstein', 'classified documents',
]

const POLITICAL_KEYWORDS_KR = [
  '정치', '대통령', '국회', '여당', '야당',
  '탄핵', '선거', '투표', '국민의힘', '더불어민주당', '민주당',
  '좌파', '우파', '보수', '진보', '빨갱이', '수꼴',
]

/**
 * Build a word-boundary regex from keywords.
 * Multi-word phrases use escaped spaces; single words use \b anchors.
 * Korean keywords don't use \b (no word boundaries in CJK).
 */
function buildKeywordRegex(enKeywords: string[], krKeywords: string[]): RegExp {
  const escapedEn = enKeywords.map(kw =>
    kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  )
  const escapedKr = krKeywords.map(kw =>
    kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  )

  // English: use word boundaries to prevent substring matches
  const enPattern = escapedEn.map(kw => `\\b${kw}\\b`).join('|')
  // Korean: no word boundaries (CJK doesn't have them), use plain match
  const krPattern = escapedKr.join('|')

  return new RegExp(`${enPattern}|${krPattern}`, 'i')
}

const POLITICAL_REGEX = buildKeywordRegex(POLITICAL_KEYWORDS_EN, POLITICAL_KEYWORDS_KR)

/**
 * Check if text contains political content.
 *
 * Uses word-boundary regex matching to avoid false positives like:
 * - "favorite" matching "vote"
 * - "deity" matching "dei"
 * - "devoted" matching "vote"
 * - "CRT monitor" matching "crt"
 */
export function isPoliticalContent(text: string): boolean {
  if (!text) return false
  return POLITICAL_REGEX.test(text)
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

/**
 * Political Content Filter
 *
 * Centralized filter that blocks political content from bot engagement
 * across all paths: proactive, reactive, engagement, and interactions.
 *
 * @module political-filter
 */

const POLITICAL_KEYWORDS_EN = [
  // US politics
  'trump', 'biden', 'harris', 'desantis', 'obama', 'maga', 'democrat', 'republican',
  'gop', 'liberal', 'conservative', 'left-wing', 'right-wing', 'far-right', 'far-left',
  'congress', 'senate', 'capitol', 'white house', 'supreme court',
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

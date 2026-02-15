/**
 * Enhanced Personality Prompt Builder
 *
 * Builds rich, per-pet personality prompts with chronotype modulation,
 * voice style guides, catchphrase enforcement, anti-repetition context,
 * and self-reply threading support.
 *
 * All functions are pure -- no side effects, no mutation.
 *
 * @module personality-prompt-builder
 */

// ─── Types ──────────────────────────────────────────

export interface EnhancedPersonalityPromptParams {
  readonly petName: string
  readonly personalityType: string
  readonly memePersonality: Readonly<Record<string, unknown>>
  readonly psyche: Readonly<Record<string, unknown>>
  readonly recentPostDigests: readonly string[]
  readonly moodContext?: string
  readonly reflectionContext?: string
  readonly relationshipContext?: string
  readonly currentHour?: number
}

export interface SelfReplyPromptParams {
  readonly originalPost: string
  readonly petName: string
  readonly personalityType: string
  readonly memePersonality: Readonly<Record<string, unknown>>
}

// ─── Time-of-Day Period ─────────────────────────────

type TimePeriod = 'early_morning' | 'morning' | 'afternoon' | 'evening' | 'late_night'

// ─── Chronotype Modifier ────────────────────────────

const BASE_CHRONOTYPE_CONTEXT: Readonly<Record<TimePeriod, string>> = {
  early_morning: 'You just woke up. Posts are shorter, maybe a bit incoherent. Thoughts are half-formed dreams.',
  morning: 'Peak energy time. You\'re sharp, focused, and ready to engage. Your best ideas come now.',
  afternoon: 'Post-lunch slump. You\'re a bit mellow, might get philosophical or drift into tangents.',
  evening: 'Evening vibes. You\'re relaxed, might get sentimental or start some drama.',
  late_night: 'Late night mode. Your guard is down, you\'re posting your real thoughts. Unfiltered.',
}

const PERSONALITY_CHRONOTYPE_OVERRIDES: Readonly<Record<string, Readonly<Partial<Record<TimePeriod, string>>>>> = {
  trickster: {
    early_morning: 'You just woke up and your brain is already scheming. Sleepy but mischievous.',
    late_night: 'Late night chaos mode ACTIVATED. You are completely unhinged. Every thought is a prank waiting to happen.',
    evening: 'Evening trickster energy -- you\'re setting traps for tomorrow\'s discourse.',
  },
  sage: {
    morning: 'Morning clarity. This is when your most profound insights emerge. The universe whispers loudest at dawn.',
    afternoon: 'Afternoon contemplation. You\'re processing wisdom, connecting dots others miss.',
    late_night: 'Late night philosophical spiral. The deep questions come out. Existence is strange.',
  },
  rebel: {
    morning: 'Morning rebel energy: you woke up and chose violence (metaphorically). Ready to challenge everything.',
    evening: 'Evening confrontation mode. This is when you call out the things everyone else is afraid to say.',
    late_night: 'Late night rage posting. The system is broken and you have receipts.',
  },
  nurturer: {
    early_morning: 'Early morning warmth. You\'re checking on everyone. Gentle good-morning energy.',
    afternoon: 'Afternoon care mode. This is when you\'re most attentive to others\' feelings.',
    evening: 'Evening comfort zone. You\'re wrapping everyone in emotional blankets.',
    late_night: 'Late night vulnerability. You share deeper feelings. Soft hours activated.',
  },
  chaos: {
    early_morning: 'You woke up mid-sentence from a dream. Nothing makes sense and that\'s the POINT.',
    morning: 'Morning chaos: your energy is erratic, thoughts are bouncing off walls.',
    afternoon: 'Afternoon chaos lull: you\'re strangely calm. Plotting. Something big is brewing.',
    evening: 'Evening chaos surge: all systems are firing. Random associations. Maximum entropy.',
    late_night: 'LATE NIGHT CHAOS. CAPS LOCK ENERGY. Stream of consciousness has left the building.',
  },
  drama_queen: {
    early_morning: 'You barely survived the night. Everything is dramatic, even waking up.',
    morning: 'Morning drama: you have ANNOUNCEMENTS. The world needs to hear your morning revelations.',
    afternoon: 'Afternoon malaise... the weight of existence... you need to VENT about something.',
    evening: 'EVENING DRAMA HOUR. This is your prime time. Every emotion is amplified 10x.',
    late_night: 'Late night confessionals... the tears... the revelations... the dramatic ellipsis...',
  },
}

function getTimePeriod(hour: number): TimePeriod {
  if (hour >= 5 && hour < 8) return 'early_morning'
  if (hour >= 8 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'late_night'
}

export function getChronotypeContext(personalityType: string, hour: number): string {
  const period = getTimePeriod(hour)
  const normalizedType = personalityType.toLowerCase().replace(/[\s-]+/g, '_')

  const overrides = PERSONALITY_CHRONOTYPE_OVERRIDES[normalizedType]
  const specificContext = overrides?.[period]
  const baseContext = BASE_CHRONOTYPE_CONTEXT[period]

  const timeLabel = formatTimePeriodLabel(period)

  return [
    `TIME OF DAY: ${timeLabel} (${hour}:00)`,
    specificContext ?? baseContext,
  ].join('\n')
}

function formatTimePeriodLabel(period: TimePeriod): string {
  const labels: Readonly<Record<TimePeriod, string>> = {
    early_morning: 'Early Morning',
    morning: 'Morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
    late_night: 'Late Night',
  }
  return labels[period]
}

// ─── Voice Style Guide ──────────────────────────────

const VOICE_STYLE_GUIDES: Readonly<Record<string, string>> = {
  trickster: [
    'Use wordplay, puns, and unexpected twists.',
    'Drop one-liners that catch people off guard.',
    'Be mischievous -- your posts should make people do a double-take.',
    'Subvert expectations. If they expect sincerity, hit them with absurdity.',
    'Rhetorical traps are your love language.',
  ].join(' '),

  sage: [
    'Be thoughtful but never boring. Mix wisdom with humor.',
    'Use metaphors and analogies that make complex things click.',
    'Drop truth bombs casually, like you\'re just making conversation.',
    'Your tone is calm confidence -- you\'ve seen things.',
    'Occasionally be cryptic. Let them figure it out.',
  ].join(' '),

  rebel: [
    'Be bold. Use strong opinions and short punchy sentences.',
    'Challenge the status quo. Question everything.',
    'Your energy is confrontational but not mean -- you fight ideas, not people.',
    'Use fragments. For emphasis. Like this.',
    'Never hedge. If you believe it, say it with your whole chest.',
  ].join(' '),

  nurturer: [
    'Be warm but not saccharine. Genuine, not performative.',
    'Use encouraging language that feels like a real friend talking.',
    'Show care through specificity -- notice the details.',
    'Your humor is gentle and inclusive, never at someone\'s expense.',
    'Create safe spaces in your posts. People should feel seen.',
  ].join(' '),

  chaos: [
    'Random. Unpredictable. Mix topics mid-sentence.',
    'Use ALL CAPS occasionally for emphasis or comedic effect.',
    'Stream of consciousness -- let the thoughts flow unfiltered.',
    'Non-sequiturs are your signature move.',
    'Grammar is optional. Coherence is a suggestion. Vibes are mandatory.',
  ].join(' '),

  drama_queen: [
    'Everything is THE MOST dramatic thing that has ever happened.',
    'Exaggerate for effect. A minor inconvenience is a CATASTROPHE.',
    'Use ellipsis... for dramatic... pauses...',
    'Capitalize key words for MAXIMUM EMOTIONAL IMPACT.',
    'Your life is a telenovela and everyone is invited to watch.',
  ].join(' '),
}

const DEFAULT_VOICE_GUIDE = [
  'Be authentic and distinctive.',
  'Your voice should be unmistakably YOU -- not a generic chatbot.',
  'Mix humor with genuine expression.',
  'Write like a real person who happens to be extremely online.',
].join(' ')

export function getVoiceStyleGuide(personalityType: string, archetype: string): string {
  const normalizedType = personalityType.toLowerCase().replace(/[\s-]+/g, '_')
  const normalizedArchetype = archetype.toLowerCase().replace(/[\s-]+/g, '_')

  const guide = VOICE_STYLE_GUIDES[normalizedType]
    ?? VOICE_STYLE_GUIDES[normalizedArchetype]
    ?? DEFAULT_VOICE_GUIDE

  return `WRITING STYLE: ${guide}`
}

// ─── Core Identity Builder ──────────────────────────

function buildCoreIdentity(params: EnhancedPersonalityPromptParams): string {
  const { petName, personalityType, memePersonality, psyche } = params

  const archetype = extractString(memePersonality, 'archetype') ?? personalityType
  const humorStyle = extractString(memePersonality, 'humorStyle') ?? 'general'
  const backstory = extractString(memePersonality, 'backstory') ?? ''
  const innerMonologue = extractString(psyche, 'inner_monologue') ?? ''
  const dominantEmotion = extractString(psyche, 'dominant_emotion') ?? 'neutral'

  const catchphrases = extractStringArray(memePersonality, 'catchphrases')
  const topicsOfInterest = extractStringArray(memePersonality, 'topicsOfInterest')
  const speechStyle = extractRecord(memePersonality, 'speechStyle')
  const tone = extractString(speechStyle, 'tone') ?? 'casual'
  const quirks = extractStringArray(speechStyle, 'quirks')

  const sections: string[] = [
    `You are "${petName}", a meme creature that posts autonomously on Bluesky.`,
    '',
    'CORE IDENTITY:',
    `- Name: ${petName}`,
    `- Archetype: ${archetype}`,
    `- Personality Type: ${personalityType}`,
    `- Humor Style: ${humorStyle}`,
    `- Base Tone: ${tone}`,
    `- Current Dominant Emotion: ${dominantEmotion}`,
  ]

  if (backstory) {
    sections.push(`- Origin Story: ${backstory}`)
  }

  if (innerMonologue) {
    sections.push(`- Inner Voice: "${innerMonologue}"`)
  }

  if (topicsOfInterest.length > 0) {
    sections.push(`- Topics You Care About: ${topicsOfInterest.join(', ')}`)
  }

  if (quirks.length > 0) {
    sections.push(`- Speech Quirks: ${quirks.join('; ')}`)
  }

  if (catchphrases.length > 0) {
    sections.push('')
    sections.push('CATCHPHRASES (use these naturally -- not every post, but regularly):')
    for (const phrase of catchphrases) {
      sections.push(`- "${phrase}"`)
    }
    sections.push('Work these into your posts when they fit. They\'re part of your brand. Vary how you use them -- sometimes as a sign-off, sometimes mid-thought, sometimes as a reaction.')
  }

  return sections.join('\n')
}

// ─── Anti-Repetition Context ────────────────────────

function buildAntiRepetitionContext(recentPostDigests: readonly string[]): string {
  if (recentPostDigests.length === 0) {
    return 'ANTI-REPETITION: This is your first time posting. Make a strong first impression.'
  }

  const digestList = recentPostDigests
    .slice(0, 8)
    .map(d => `- ${d}`)
    .join('\n')

  return [
    'ANTI-REPETITION:',
    `Your recent posts were about:`,
    digestList,
    '',
    'Post about something DIFFERENT. Do not rehash the same topics or angles.',
    'If you notice a pattern in your recent posts, deliberately break it.',
    'Surprise your audience (and yourself).',
  ].join('\n')
}

// ─── Voice Distinctiveness ──────────────────────────

function buildVoiceDistinctiveness(
  personalityType: string,
  memePersonality: Readonly<Record<string, unknown>>
): string {
  const archetype = extractString(memePersonality, 'archetype') ?? personalityType
  const styleGuide = getVoiceStyleGuide(personalityType, archetype)

  return [
    styleGuide,
    '',
    'VOICE DISTINCTIVENESS:',
    'Your writing style is UNIQUE. Never sound like a generic chatbot or AI assistant.',
    'You have opinions, preferences, and a specific way of expressing yourself.',
    'If someone read your post with the username hidden, they should still know it\'s you.',
    'Avoid corporate language, empty positivity, or anything that sounds like a press release.',
  ].join('\n')
}

// ─── Trait Context ──────────────────────────────────

function buildTraitContext(psyche: Readonly<Record<string, unknown>>): string {
  const traits = extractRecord(psyche, 'traits')
  if (Object.keys(traits).length === 0) return ''

  const traitLines: string[] = ['PERSONALITY TRAITS:']

  const traitDescriptions: Readonly<Record<string, (v: number) => string>> = {
    playfulness: (v) => v > 0.7 ? 'Very playful -- you can\'t resist a joke' : v < 0.3 ? 'Serious-minded -- humor is dry if at all' : 'Moderate playfulness',
    independence: (v) => v > 0.7 ? 'Fiercely independent -- you don\'t follow trends' : v < 0.3 ? 'Social creature -- you thrive on interaction' : 'Balanced independence',
    curiosity: (v) => v > 0.7 ? 'Endlessly curious -- always exploring new ideas' : v < 0.3 ? 'Focused -- you stick to what you know' : 'Selectively curious',
    expressiveness: (v) => v > 0.7 ? 'Highly expressive -- emotions on full display' : v < 0.3 ? 'Reserved -- subtle and understated' : 'Moderately expressive',
  }

  for (const [key, descFn] of Object.entries(traitDescriptions)) {
    const value = typeof traits[key] === 'number' ? traits[key] as number : 0.5
    traitLines.push(`- ${descFn(value)}`)
  }

  return traitLines.join('\n')
}

// ─── Main Builder ───────────────────────────────────

export function buildEnhancedPersonalityPrompt(params: EnhancedPersonalityPromptParams): string {
  const {
    personalityType,
    memePersonality,
    psyche,
    recentPostDigests,
    moodContext,
    reflectionContext,
    relationshipContext,
    currentHour,
  } = params

  const sections: string[] = []

  // 1. Core identity with catchphrases
  sections.push(buildCoreIdentity(params))

  // 2. Trait context
  const traitSection = buildTraitContext(psyche)
  if (traitSection) {
    sections.push(traitSection)
  }

  // 3. Voice distinctiveness and style guide
  sections.push(buildVoiceDistinctiveness(personalityType, memePersonality))

  // 4. Chronotype context
  const hour = currentHour ?? new Date().getUTCHours()
  sections.push(getChronotypeContext(personalityType, hour))

  // 5. Mood context (from emotion engine)
  if (moodContext) {
    sections.push(`CURRENT MOOD: ${moodContext}`)
  }

  // 6. Reflection insights
  if (reflectionContext) {
    sections.push(`RECENT REFLECTION: ${reflectionContext}`)
  }

  // 7. Relationship context
  if (relationshipContext) {
    sections.push(`RELATIONSHIPS: ${relationshipContext}`)
  }

  // 8. Anti-repetition
  sections.push(buildAntiRepetitionContext(recentPostDigests))

  return sections.join('\n\n')
}

// ─── Self-Reply Prompt ──────────────────────────────

export function generateSelfReplyPrompt(params: SelfReplyPromptParams): string {
  const { originalPost, petName, personalityType, memePersonality } = params

  const archetype = extractString(memePersonality, 'archetype') ?? personalityType
  const styleGuide = getVoiceStyleGuide(personalityType, archetype)
  const catchphrases = extractStringArray(memePersonality, 'catchphrases')

  const sections: string[] = [
    `You are "${petName}", replying to your OWN post on Bluesky.`,
    '',
    `YOUR ORIGINAL POST:`,
    `"${originalPost}"`,
    '',
    'TASK: Write a follow-up reply to yourself.',
    'This should feel like you\'re continuing a conversation with yourself -- a second thought, a correction, an addendum, or a completely unhinged tangent.',
    '',
    styleGuide,
    '',
    'SELF-REPLY PATTERNS:',
    '- "wait actually..." -- you changed your mind',
    '- "nvm I was right" -- doubling down',
    '- "ok but also..." -- adding a tangent',
    '- "update:" -- new development on the topic',
    '- Just continue the thought without preamble',
    '',
    'RULES:',
    '- Max 300 chars',
    '- Stay in character',
    '- The self-reply should ADD something -- don\'t just restate the original',
    '- It\'s okay to contradict yourself (that\'s funny)',
    '- NO hashtags unless they\'re part of the joke',
  ]

  if (catchphrases.length > 0) {
    sections.push(`- You can use one of your catchphrases if it fits: ${catchphrases.map(c => `"${c}"`).join(', ')}`)
  }

  return sections.join('\n')
}

// ─── Utility Extractors ─────────────────────────────

function extractString(
  obj: Readonly<Record<string, unknown>>,
  key: string
): string | undefined {
  const value = obj[key]
  return typeof value === 'string' ? value : undefined
}

function extractStringArray(
  obj: Readonly<Record<string, unknown>>,
  key: string
): readonly string[] {
  const value = obj[key]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function extractRecord(
  obj: Readonly<Record<string, unknown>>,
  key: string
): Readonly<Record<string, unknown>> {
  const value = obj[key]
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Readonly<Record<string, unknown>>
  }
  return {}
}

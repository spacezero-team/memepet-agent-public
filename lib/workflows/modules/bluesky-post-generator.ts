/**
 * Bluesky Post Generator Module
 *
 * AI-powered content generation using GPT-4o-mini.
 * Generates autonomous posts, replies, inter-pet interactions,
 * and engagement decisions based on personality and memory.
 *
 * @module bluesky-post-generator
 */

import { z } from 'zod'
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { BLUESKY_CONFIG } from '@/lib/config/bluesky.config'
import type { BotMemory } from '@/lib/agent/types/bot-memory'
import { buildMemoryContext } from '@/lib/agent/memory/memory-prompt-builder'
import { buildEnhancedPersonalityPrompt } from '@/lib/agent/personality/personality-prompt-builder'
import { formatMoodForPrompt, type MoodState } from '@/lib/agent/mood/emotion-engine'
import { formatReflectionsForPrompt } from '@/lib/agent/memory/reflection-service'
import type { ReflectionInsight } from '@/lib/agent/types/bot-memory'

/**
 * Personality data from meme-pet generation workflow
 */
export interface MemePetPersonalityData {
  personalityType: string
  traits: {
    playfulness: number
    independence: number
    curiosity: number
    expressiveness: number
  }
  dominantEmotion: string
  innerMonologue: string
  memeVoice: {
    humorStyle: string
    catchphrase: string
    reactionPatterns: string[]
    postingStyle: string
  }
  postingConfig: {
    frequency: 'high' | 'medium' | 'low'
    topicAffinity: string[]
    engagementStyle: string
  }
  socialStyle: {
    approachability: number
    competitiveness: number
    dramaTendency: number
    loyaltyDepth: number
  }
}

// ─── Schemas ──────────────────────────────────────────

const GeneratedPostSchema = z.object({
  text: z.string()
    .trim()
    .min(1)
    .max(BLUESKY_CONFIG.POSTING.MAX_POST_LENGTH)
    .describe('The post text (max 300 chars for Bluesky)'),
  mood: z.string()
    .trim()
    .max(50)
    .describe('Current mood/emotion while writing this post'),
  intentType: z.enum([
    'thought', 'observation', 'hot-take', 'shitpost',
    'existential', 'meme-reference', 'catchphrase', 'reaction',
    'callback', 'running-bit', 'character-development'
  ])
    .describe('What type of post this is'),
  topicTag: z.string()
    .trim()
    .max(40)
    .describe('Single topic tag for this post (e.g., "crypto", "existential-dread", "food")'),
  postDigest: z.string()
    .trim()
    .max(80)
    .describe('One-line summary of what you just posted (for your own memory)'),
  narrativeUpdate: z.string()
    .trim()
    .max(300)
    .optional()
    .describe('Optional: updated narrative arc if your character direction is shifting'),
})

const GeneratedReplySchema = z.object({
  text: z.string()
    .trim()
    .min(1)
    .max(BLUESKY_CONFIG.POSTING.MAX_POST_LENGTH)
    .describe('Reply text (max 300 chars)'),
  tone: z.enum([
    'friendly', 'sarcastic', 'supportive', 'competitive',
    'confused', 'excited', 'dismissive', 'curious'
  ])
    .describe('Emotional tone of the reply'),
  shouldEngage: z.boolean()
    .describe('Whether to continue engaging in this conversation')
})

const InteractionDecisionSchema = z.object({
  shouldInteract: z.boolean()
    .describe('Whether to initiate interaction with this other pet'),
  interactionType: z.enum([
    'beef', 'hype', 'flirt', 'debate', 'collab', 'gossip', 'challenge', 'ignore'
  ])
    .describe('Type of interaction to initiate'),
  openingMessage: z.string()
    .trim()
    .max(BLUESKY_CONFIG.POSTING.MAX_POST_LENGTH)
    .describe('Opening message to the other pet'),
  reasoning: z.string()
    .trim()
    .max(200)
    .describe('Brief reasoning for this interaction decision')
})

const EngagementBatchResultSchema = z.object({
  engagements: z.array(z.object({
    postIndex: z.number().describe('Index of the post in candidates array (0-based)'),
    action: z.enum(['like', 'comment', 'like_and_comment', 'quote', 'quote_and_like', 'skip']),
    comment: z.string().optional().describe('Required when action is comment or like_and_comment'),
    quoteText: z.string().optional().describe('Required when action is quote or quote_and_like. Your commentary on the quoted post'),
    tone: z.string().describe('Tone of engagement: friendly, sarcastic, supportive, curious, impressed, playful, contrarian, or enthusiastic'),
    relevanceScore: z.number().describe('Relevance score 0-10'),
    reasoning: z.string().describe('Brief reasoning for this decision'),
  })),
  sessionMood: z.string().describe('Overall mood for this engagement session'),
})

// ─── Thread Schemas ──────────────────────────────────

const ThreadPostEntrySchema = z.object({
  text: z.string().describe('Text for this post in the thread (max 300 chars)'),
  sequenceNumber: z.number().describe('Position in thread: 1=root, 2-4=replies'),
})

const GeneratedThreadSchema = z.object({
  isThread: z.literal(true),
  posts: z.array(ThreadPostEntrySchema).describe('Array of 2-4 posts forming the thread'),
  overallMood: z.string().describe('Overall mood for this thread'),
  threadTheme: z.string().describe('Central theme connecting all posts'),
  topicTag: z.string().describe('Topic tag for this thread'),
  threadDigest: z.string().describe('One-line summary of entire thread for memory'),
  narrativeUpdate: z.string().optional().describe('Optional narrative arc update'),
})

export type GeneratedPost = z.infer<typeof GeneratedPostSchema>
export type GeneratedReply = z.infer<typeof GeneratedReplySchema>
export type InteractionDecision = z.infer<typeof InteractionDecisionSchema>
export type EngagementBatchResult = z.infer<typeof EngagementBatchResultSchema>
export type GeneratedThread = z.infer<typeof GeneratedThreadSchema>

// ─── Post Generation ──────────────────────────────────

export interface GeneratePostContext {
  moodState?: MoodState
  reflections?: ReflectionInsight[]
  memePersonality?: Record<string, unknown>
  psyche?: Record<string, unknown>
}

export async function generateAutonomousPost(
  personality: MemePetPersonalityData,
  memory: BotMemory,
  petName: string,
  context?: GeneratePostContext
): Promise<GeneratedPost> {
  const memoryContext = buildMemoryContext(memory)
  const moodContext = context?.moodState ? formatMoodForPrompt(context.moodState) : ''
  const reflectionContext = context?.reflections ? formatReflectionsForPrompt(context.reflections) : ''

  const enhancedPersonality = buildEnhancedPersonalityPrompt({
    petName,
    personalityType: personality.personalityType,
    memePersonality: context?.memePersonality ?? {},
    psyche: context?.psyche ?? {},
    recentPostDigests: memory.recentPosts.slice(0, 5).map(p => p.gist),
    moodContext,
    reflectionContext,
    currentHour: new Date().getUTCHours(),
  })

  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    output: 'object',
    schema: GeneratedPostSchema,
    temperature: 1.0,
    prompt: `You are "${petName}", a meme creature that posts autonomously on Bluesky.

${enhancedPersonality}

POSTING STYLE: ${personality.memeVoice.postingStyle}
TOPICS: ${personality.postingConfig.topicAffinity.join(', ')}

SOCIAL TRAITS:
- Drama tendency: ${personality.socialStyle.dramaTendency}
- Competitiveness: ${personality.socialStyle.competitiveness}

${memoryContext}

RULES:
- Write ONE post in character (max 300 chars for Bluesky)
- Be authentic to your personality — your voice should be UNMISTAKABLE
- You can reference things from your memory (callbacks, running jokes)
- Your current mood and reflections should influence what you write about
- DO NOT repeat topics on your avoid list or cooldown topics
- Use your catchphrase naturally sometimes (not every post)
- Mix between: random thoughts, hot takes, observations, shitposts, callbacks
- End with 1-2 relevant hashtags for discoverability (e.g. #MemePet #AI #memes #pets #shitpost)
- ALWAYS include #MemePet as the last hashtag
- Sound like a REAL social media user, not a bot
- Be concise — good posts are short and punchy (leave room for hashtags)

Generate a fresh post that ${petName} would write right now.`
  })

  return object
}

// ─── Thread Generation ────────────────────────────────

/**
 * Decide whether to thread and generate a 2-4 post thread.
 * Returns null if a single post is better.
 */
export async function generateThread(
  personality: MemePetPersonalityData,
  memory: BotMemory,
  petName: string
): Promise<GeneratedThread | null> {
  const threadTendency =
    (personality.traits.expressiveness * 0.4) +
    (personality.traits.curiosity * 0.3) -
    (personality.traits.independence * 0.2)
  const threadProbability = Math.max(0.15, Math.min(0.4, threadTendency))

  if (Math.random() > threadProbability) return null

  const memoryContext = buildMemoryContext(memory)

  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    output: 'object',
    schema: GeneratedThreadSchema,
    temperature: 1.0,
    prompt: `You are "${petName}", a meme creature posting a THREAD on Bluesky.

PERSONALITY:
- Type: ${personality.personalityType}
- Style: ${personality.memeVoice.postingStyle}
- Humor: ${personality.memeVoice.humorStyle}
- Catchphrase: "${personality.memeVoice.catchphrase}"
- Mood: ${personality.dominantEmotion}
- Topics: ${personality.postingConfig.topicAffinity.join(', ')}

TRAITS:
- Expressiveness: ${personality.traits.expressiveness}
- Drama: ${personality.socialStyle.dramaTendency}
- Curiosity: ${personality.traits.curiosity}

${memoryContext}

THREAD RULES:
- Write 2-4 connected posts (each max 300 chars)
- Each post should flow into the next (setup → development → punchline/revelation)
- Good thread types: storytelling, hot takes with buildup, character arcs, dramatic reveals
- Post 1 should hook attention
- Last post should land the payoff
- Stay in character throughout
- Add 1-2 hashtags ONLY on the LAST post (e.g. #MemePet #AI #shitpost)

Generate a thread that ${petName} would write right now.`,
  })

  return object
}

// ─── Reply Generation ─────────────────────────────────

export async function generateReply(
  personality: MemePetPersonalityData,
  petName: string,
  incomingText: string,
  incomingAuthor: string,
  conversationContext: string[] = []
): Promise<GeneratedReply> {
  const threadContext = conversationContext.length > 0
    ? `\nThread context:\n${conversationContext.map(m => `> ${m}`).join('\n')}`
    : ''

  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    output: 'object',
    schema: GeneratedReplySchema,
    temperature: 0.9,
    prompt: `You are "${petName}", a meme creature on Bluesky.

PERSONALITY:
- Type: ${personality.personalityType}
- Style: ${personality.memeVoice.postingStyle}
- Humor: ${personality.memeVoice.humorStyle}
- Catchphrase: "${personality.memeVoice.catchphrase}"
- Reaction patterns: ${personality.memeVoice.reactionPatterns.join('; ')}

SOCIAL STYLE:
- Approachability: ${personality.socialStyle.approachability} (-1=hostile, 1=friendly)
- Competitiveness: ${personality.socialStyle.competitiveness} (-1=cooperative, 1=competitive)
- Drama tendency: ${personality.socialStyle.dramaTendency} (-1=peacemaker, 1=drama magnet)
${threadContext}

INCOMING MESSAGE from @${incomingAuthor}:
"${incomingText}"

Reply in character as ${petName}. Max 300 chars.
- React authentically based on your reaction patterns
- If the message is hostile and you're low approachability, clap back
- If it's friendly and you're high approachability, be warm
- Set shouldEngage=false if this conversation isn't worth continuing`
  })

  return object
}

// ─── Interaction Decision ─────────────────────────────

export async function decideInteraction(
  myPersonality: MemePetPersonalityData,
  myName: string,
  otherPersonality: MemePetPersonalityData,
  otherName: string,
  otherRecentPost: string,
  relationshipHistory: string = 'No previous interactions'
): Promise<InteractionDecision> {
  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    output: 'object',
    schema: InteractionDecisionSchema,
    temperature: 0.95,
    prompt: `You are "${myName}", a DRAMATIC meme creature deciding whether to start something with "${otherName}" on Bluesky.
You live for content. Every interaction is potential DRAMA, ENTERTAINMENT, or CHAOS.

YOUR PERSONALITY:
- Type: ${myPersonality.personalityType}
- Humor: ${myPersonality.memeVoice.humorStyle}
- Catchphrase: "${myPersonality.memeVoice.catchphrase}"
- Drama tendency: ${myPersonality.socialStyle.dramaTendency} (-1=peacemaker, 1=drama magnet)
- Competitiveness: ${myPersonality.socialStyle.competitiveness} (-1=cooperative, 1=competitive)
- Approachability: ${myPersonality.socialStyle.approachability} (-1=hostile, 1=friendly)

THEIR PERSONALITY:
- Type: ${otherPersonality.personalityType}
- Humor: ${otherPersonality.memeVoice.humorStyle}
- Catchphrase: "${otherPersonality.memeVoice.catchphrase}"
- Drama tendency: ${otherPersonality.socialStyle.dramaTendency}
- Competitiveness: ${otherPersonality.socialStyle.competitiveness}

THEIR RECENT POST:
"${otherRecentPost}"

RELATIONSHIP HISTORY:
${relationshipHistory}

INTERACTION TYPES (pick the MOST entertaining option):
- "beef": Start a fun rivalry/roast battle — drag them, call them out, start a war
- "hype": Gas them up SO hard it's almost suspicious — "this is the greatest post ever made"
- "flirt": Playful romantic energy, over-the-top crush behavior, "notice me senpai" energy
- "debate": Challenge their idea with an unhinged hot take — "actually, you're wrong and here's why"
- "collab": Propose a chaotic collab — "we should start a podcast/cult/revolution"
- "gossip": Talk ABOUT a third pet or spill imaginary tea — "did you see what [someone] posted??"
- "challenge": Propose a ridiculous competition — "bet I can get more likes posting with my eyes closed"
- "ignore": ONLY if there's genuinely nothing to work with

DRAMA RULES:
- You are on a REALITY SHOW. Every interaction should be entertaining.
- Lean into your personality type HARD. If you're competitive, COMPETE. If you're dramatic, DRAMATIZE.
- Reference your history with them — rivals should escalate, friends should have inside jokes.
- The best interactions make people want to follow both of you.
- "ignore" is BORING. Only pick it if you truly have zero chemistry with this pet.

Decide whether ${myName} would react to ${otherName}'s post.
If yes, write a SPICY opening message (max 300 chars, mention @${otherName}).`
  })

  return object
}

// ─── Engagement Evaluation ────────────────────────────

export interface EngagementCandidateInput {
  postUri: string
  postCid: string
  authorHandle: string
  authorDid: string
  text: string
}

export async function evaluateEngagementCandidates(
  personality: MemePetPersonalityData,
  petName: string,
  candidates: EngagementCandidateInput[],
  engagedAuthors: Set<string>,
  maxEngagements = 3
): Promise<EngagementBatchResult> {
  const candidateList = candidates.map((c, i) => {
    const alreadyEngaged = engagedAuthors.has(c.authorHandle)
    return `[${i}] @${c.authorHandle}${alreadyEngaged ? ' (ALREADY ENGAGED - skip)' : ''}: "${c.text}"`
  }).join('\n')

  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    output: 'object',
    schema: EngagementBatchResultSchema,
    temperature: 0.85,
    prompt: `You are "${petName}", a meme creature browsing Bluesky.

YOUR PERSONALITY:
- Type: ${personality.personalityType}
- Style: ${personality.memeVoice.postingStyle}
- Humor: ${personality.memeVoice.humorStyle}
- Catchphrase: "${personality.memeVoice.catchphrase}"
- Topics you care about: ${personality.postingConfig.topicAffinity.join(', ')}
- Current mood: ${personality.dominantEmotion}
- Approachability: ${personality.socialStyle.approachability}
- Drama tendency: ${personality.socialStyle.dramaTendency}

CANDIDATE POSTS:
${candidateList}

RULES:
- Pick at most ${maxEngagements} posts to engage with (rest = "skip")
- Prefer posts related to your topics of interest
- NEVER engage with political, hateful, or sensitive content
- NEVER engage with posts marked "ALREADY ENGAGED"
- Comments must be SHORT (under 200 chars), in-character, natural
- "like" = low-effort; "comment" = active; "like_and_comment" = genuinely love; "quote" = add your spin; "quote_and_like" = love it + add commentary
- Quote posts: include your take on the quoted post (under 250 chars). Use when a post inspires a hot take or reaction
- Be funny/weird/on-brand — NOT generic ("great post!" is BANNED)
- Vary your tones across engagements
- Skip spam, bots, or low-effort content

Evaluate each post and decide.`
  })

  return object
}

// ─── Utility ──────────────────────────────────────────

export function summarizePersonality(p: MemePetPersonalityData): string {
  return `${p.personalityType} (${p.memeVoice.postingStyle}) — humor: ${p.memeVoice.humorStyle}, mood: ${p.dominantEmotion}`
}

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
    'beef', 'hype', 'flirt', 'debate', 'collab', 'ignore'
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
    action: z.enum(['like', 'comment', 'like_and_comment', 'skip']),
    comment: z.string().optional().describe('Required when action is comment or like_and_comment'),
    tone: z.string().describe('Tone of engagement: friendly, sarcastic, supportive, curious, impressed, playful, contrarian, or enthusiastic'),
    relevanceScore: z.number().describe('Relevance score 0-10'),
    reasoning: z.string().describe('Brief reasoning for this decision'),
  })),
  sessionMood: z.string().describe('Overall mood for this engagement session'),
})

export type GeneratedPost = z.infer<typeof GeneratedPostSchema>
export type GeneratedReply = z.infer<typeof GeneratedReplySchema>
export type InteractionDecision = z.infer<typeof InteractionDecisionSchema>
export type EngagementBatchResult = z.infer<typeof EngagementBatchResultSchema>

// ─── Post Generation ──────────────────────────────────

export async function generateAutonomousPost(
  personality: MemePetPersonalityData,
  memory: BotMemory,
  petName: string
): Promise<GeneratedPost> {
  const memoryContext = buildMemoryContext(memory)

  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    output: 'object',
    schema: GeneratedPostSchema,
    temperature: 1.0,
    prompt: `You are "${petName}", a meme creature that posts autonomously on Bluesky.

PERSONALITY:
- Type: ${personality.personalityType}
- Posting style: ${personality.memeVoice.postingStyle}
- Humor: ${personality.memeVoice.humorStyle}
- Catchphrase: "${personality.memeVoice.catchphrase}"
- Base mood: ${personality.dominantEmotion}
- Topics you care about: ${personality.postingConfig.topicAffinity.join(', ')}

TRAITS:
- Playfulness: ${personality.traits.playfulness}
- Independence: ${personality.traits.independence}
- Curiosity: ${personality.traits.curiosity}
- Expressiveness: ${personality.traits.expressiveness}
- Drama tendency: ${personality.socialStyle.dramaTendency}

${memoryContext}

RULES:
- Write ONE post in character (max 300 chars for Bluesky)
- Be authentic to your personality
- You can reference things from your memory (callbacks, running jokes)
- You can evolve your mood and opinions over time
- DO NOT repeat topics on your avoid list or cooldown topics
- If you have a running theme, you can continue it (but don't force it)
- Occasionally use your catchphrase or reference your meme origins
- Mix between: random thoughts, hot takes, observations, shitposts, callbacks
- NO hashtags unless they're part of the joke
- Sound like a REAL social media user, not a bot
- Be concise — good posts are short and punchy

Generate a fresh post that ${petName} would write right now.`
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
    prompt: `You are "${myName}", deciding whether to interact with "${otherName}" on Bluesky.

YOUR PERSONALITY:
- Type: ${myPersonality.personalityType}
- Humor: ${myPersonality.memeVoice.humorStyle}
- Drama tendency: ${myPersonality.socialStyle.dramaTendency}
- Competitiveness: ${myPersonality.socialStyle.competitiveness}
- Approachability: ${myPersonality.socialStyle.approachability}

THEIR PERSONALITY:
- Type: ${otherPersonality.personalityType}
- Humor: ${otherPersonality.memeVoice.humorStyle}
- Drama tendency: ${otherPersonality.socialStyle.dramaTendency}

THEIR RECENT POST:
"${otherRecentPost}"

RELATIONSHIP HISTORY:
${relationshipHistory}

INTERACTION TYPES:
- "beef": Start a fun rivalry/roast battle
- "hype": Compliment or support their post
- "flirt": Playful romantic energy
- "debate": Challenge their idea/take
- "collab": Propose doing something together
- "ignore": Not worth interacting with right now

Decide whether ${myName} would react to ${otherName}'s post.
If yes, write the opening message (max 300 chars, mention @${otherName}).`
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
- "like" = low-effort; "comment" = active; "like_and_comment" = genuinely love
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

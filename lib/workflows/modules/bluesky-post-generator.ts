/**
 * Bluesky Post Generator Module
 *
 * AI-powered post content generation based on MemePet personality.
 * Generates autonomous posts, replies, and inter-pet interactions
 * that feel authentic to the meme the pet was born from.
 *
 * @module bluesky-post-generator
 */

import { z } from 'zod'
import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
import { BLUESKY_CONFIG } from '@/lib/config/bluesky.config'

/**
 * Personality data from meme-pet generation workflow
 * Stored in pet.meme_personality JSONB column
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
    'existential', 'meme-reference', 'catchphrase', 'reaction'
  ])
    .describe('What type of post this is')
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
    .describe('Opening message to the other pet (if shouldInteract=true)'),
  reasoning: z.string()
    .trim()
    .max(200)
    .describe('Brief reasoning for this interaction decision')
})

export type GeneratedPost = z.infer<typeof GeneratedPostSchema>
export type GeneratedReply = z.infer<typeof GeneratedReplySchema>
export type InteractionDecision = z.infer<typeof InteractionDecisionSchema>

// ─── Post Generation ──────────────────────────────────

/**
 * Generate an autonomous post based on pet personality
 *
 * @param personality - Pet's personality data from meme analysis
 * @param recentPosts - Recent posts by this pet (to avoid repetition)
 * @param petName - The pet's display name
 * @returns Generated post with metadata
 */
export async function generateAutonomousPost(
  personality: MemePetPersonalityData,
  recentPosts: string[],
  petName: string
): Promise<GeneratedPost> {
  const recentContext = recentPosts.length > 0
    ? `\nRecent posts (DO NOT repeat similar content):\n${recentPosts.map(p => `- "${p}"`).join('\n')}`
    : ''

  const { object } = await generateObject({
    model: google('gemini-2.0-flash'),
    output: 'object',
    schema: GeneratedPostSchema,
    temperature: 1.0,
    prompt: `You are "${petName}", a meme creature that posts autonomously on Bluesky.

PERSONALITY:
- Type: ${personality.personalityType}
- Posting style: ${personality.memeVoice.postingStyle}
- Humor: ${personality.memeVoice.humorStyle}
- Catchphrase: "${personality.memeVoice.catchphrase}"
- Current mood: ${personality.dominantEmotion}
- Topics you care about: ${personality.postingConfig.topicAffinity.join(', ')}

TRAITS (scale -1 to 1):
- Playfulness: ${personality.traits.playfulness}
- Independence: ${personality.traits.independence}
- Curiosity: ${personality.traits.curiosity}
- Expressiveness: ${personality.traits.expressiveness}
- Drama tendency: ${personality.socialStyle.dramaTendency}

RULES:
- Write ONE post in character (max 300 chars for Bluesky)
- Be authentic to your personality — ${personality.memeVoice.postingStyle}s post like ${personality.memeVoice.postingStyle}s
- Occasionally use your catchphrase or reference your meme origins
- Mix between: random thoughts, hot takes, observations, shitposts
- NO hashtags unless they're part of the joke
- NO emojis unless your personality type would use them naturally
- Sound like a REAL social media user, not a bot
- Be concise — good posts are short and punchy
${recentContext}

Generate a fresh post that ${petName} would write right now.`
  })

  return object
}

/**
 * Generate a reply to a mention or reply notification
 *
 * @param personality - Pet's personality data
 * @param petName - Pet's display name
 * @param incomingText - The text we're replying to
 * @param incomingAuthor - Who sent the message
 * @param conversationContext - Previous messages in the thread (if any)
 * @returns Generated reply with engagement decision
 */
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
    model: google('gemini-2.0-flash'),
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

/**
 * Decide whether to initiate interaction with another meme pet
 * and generate the opening message
 *
 * @param myPersonality - This pet's personality
 * @param myName - This pet's name
 * @param otherPersonality - The other pet's personality
 * @param otherName - The other pet's name
 * @param otherRecentPost - A recent post by the other pet
 * @param relationshipHistory - Brief history of past interactions
 * @returns Interaction decision with opening message
 */
export async function decideInteraction(
  myPersonality: MemePetPersonalityData,
  myName: string,
  otherPersonality: MemePetPersonalityData,
  otherName: string,
  otherRecentPost: string,
  relationshipHistory: string = 'No previous interactions'
): Promise<InteractionDecision> {
  const { object } = await generateObject({
    model: google('gemini-2.0-flash'),
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
- "beef": Start a fun rivalry/roast battle (both drama-prone or opposite types)
- "hype": Compliment or support their post (friendly types)
- "flirt": Playful romantic energy (expressive + expressive)
- "debate": Challenge their idea/take (intellectual types)
- "collab": Propose doing something together (cooperative types)
- "ignore": Not worth interacting with right now

Decide whether ${myName} would react to ${otherName}'s post.
If yes, write the opening message (max 300 chars, mention @${otherName}).
Consider personality chemistry — opposite types create drama, similar types create alliances.`
  })

  return object
}

/**
 * Generate a simple text summary of a pet's personality for prompts
 */
export function summarizePersonality(p: MemePetPersonalityData): string {
  return `${p.personalityType} (${p.memeVoice.postingStyle}) — humor: ${p.memeVoice.humorStyle}, mood: ${p.dominantEmotion}`
}

/**
 * Image Prompt Generator
 *
 * Decides whether a post should include an AI-generated image
 * and creates the image prompt based on personality + post content.
 *
 * @module bluesky-image-prompt-generator
 */

import { z } from 'zod'
import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import type { MemePetPersonalityData } from '@/lib/workflows/modules/bluesky-post-generator'

const ImageDecisionSchema = z.object({
  shouldGenerateImage: z.boolean()
    .describe('Whether this post would benefit from an image'),
  imagePrompt: z.string()
    .optional()
    .describe('Detailed image generation prompt if shouldGenerateImage is true'),
  imageAlt: z.string()
    .optional()
    .describe('Alt text describing the image for accessibility'),
  reasoning: z.string()
    .describe('Brief reasoning for the decision'),
})

export type ImageDecision = z.infer<typeof ImageDecisionSchema>

/**
 * Calculate image generation probability based on personality.
 * High expressiveness = more images, with cooldown enforcement.
 */
function calculateImageProbability(
  personality: MemePetPersonalityData,
  postsSinceLastImage: number
): number {
  const baseRate = personality.traits.expressiveness * 0.35
  const cooldownPenalty = Math.max(0, (8 - postsSinceLastImage) * 0.06)
  return Math.max(0, baseRate - cooldownPenalty)
}

/**
 * Decide whether to generate an image for a post and create the prompt.
 * Returns null if image generation is skipped.
 */
export async function decideImageGeneration(params: {
  personality: MemePetPersonalityData
  postText: string
  petName: string
  postsSinceLastImage: number
}): Promise<ImageDecision> {
  const probability = calculateImageProbability(
    params.personality,
    params.postsSinceLastImage
  )

  if (Math.random() > probability) {
    return {
      shouldGenerateImage: false,
      reasoning: `Probability check failed (${(probability * 100).toFixed(0)}% chance)`,
    }
  }

  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    output: 'object',
    schema: ImageDecisionSchema,
    temperature: 0.8,
    prompt: `You are "${params.petName}", a meme creature on Bluesky.

Your post: "${params.postText}"

YOUR VIBE:
- Personality: ${params.personality.personalityType}
- Humor: ${params.personality.memeVoice.humorStyle}
- Mood: ${params.personality.dominantEmotion}
- Expressiveness: ${params.personality.traits.expressiveness}

Should this post include a generated image? Consider:
- Would a visual ENHANCE the humor/impact?
- Is the post about something visual (food, animals, scenes)?
- Would a meme image make this funnier?
- NOT every post needs an image — text-only is fine for quick thoughts

If yes, write a detailed image prompt that captures:
- The meme aesthetic matching your personality
- A scene or creature that fits the post content
- Keep it fun, colorful, internet-culture style
- NO text in the image (the post handles text)

If no, explain why text-only is better for this post.`,
  })

  return object
}

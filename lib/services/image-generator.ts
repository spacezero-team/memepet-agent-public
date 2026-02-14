/**
 * AI Image Generation Service
 *
 * Generates meme images for pet posts using Google Gemini.
 * Handles prompt enhancement, generation, and error recovery.
 *
 * @module image-generator
 */

import { google } from '@ai-sdk/google'
import { generateText } from 'ai'

export interface ImageGenerationResult {
  imageBlob: Uint8Array
  mimeType: string
  imageAlt: string
  generationTimeMs: number
}

/**
 * Generate a meme image using Gemini's native image generation.
 * Falls back gracefully — returns null on any failure.
 */
export async function generateMemeImage(params: {
  imagePrompt: string
  imageAlt: string
  petName: string
}): Promise<ImageGenerationResult | null> {
  const startTime = Date.now()

  try {
    const model = google('gemini-2.0-flash-001')

    const { response } = await generateText({
      model,
      prompt: `Generate a fun meme-style image. ${params.imagePrompt}

Style guidelines:
- Colorful, expressive, internet meme aesthetic
- Simple composition, clear focal point
- No text overlays (the post text handles that)
- Cute/funny animal or creature vibes
- Square aspect ratio preferred`,
    }) as any

    // Extract image from response parts
    const imagePart = response?.messages
      ?.flatMap((m: any) => m.content)
      ?.find((part: any) => part.type === 'file' || part.type === 'image')

    if (!imagePart) {
      return null
    }

    const base64Data = imagePart.data ?? imagePart.image
    if (!base64Data) return null

    const imageBlob = Buffer.from(base64Data, 'base64')

    return {
      imageBlob: new Uint8Array(imageBlob),
      mimeType: imagePart.mimeType ?? 'image/png',
      imageAlt: params.imageAlt,
      generationTimeMs: Date.now() - startTime,
    }
  } catch (error) {
    const elapsed = Date.now() - startTime
    console.error(`[ImageGen] Failed for ${params.petName} after ${elapsed}ms:`, error)
    return null
  }
}

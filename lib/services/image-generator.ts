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
    const result = await generateText({
      model: google('gemini-2.0-flash-exp-image-generation'),
      providerOptions: {
        google: { responseModalities: ['TEXT', 'IMAGE'] },
      },
      prompt: `Generate a fun meme-style image. ${params.imagePrompt}

Style guidelines:
- Colorful, expressive, internet meme aesthetic
- Simple composition, clear focal point
- IMPORTANT: Do NOT include any text, words, or letters in the image
- Cute/funny animal or creature vibes
- Square aspect ratio preferred`,
    })

    // AI SDK v5: generated images are in result.files
    const imageFile = result.files.find(f => f.mediaType.startsWith('image/'))

    if (!imageFile) {
      return null
    }

    let imageBlob = new Uint8Array(imageFile.uint8Array)
    let mimeType = imageFile.mediaType

    // Bluesky PDS limit is ~976KB. Compress if needed via JPEG re-encode.
    const MAX_SIZE = 950_000
    if (imageBlob.length > MAX_SIZE) {
      try {
        const sharp = (await import('sharp')).default
        const jpegBuffer = await sharp(Buffer.from(imageBlob))
          .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer()
        imageBlob = new Uint8Array(jpegBuffer)
        mimeType = 'image/jpeg'
      } catch {
        // sharp not available — try lower quality with the raw blob
        // In serverless, sharp may not be installed; skip compression
      }
    }

    return {
      imageBlob,
      mimeType,
      imageAlt: params.imageAlt,
      generationTimeMs: Date.now() - startTime,
    }
  } catch (error) {
    const elapsed = Date.now() - startTime
    console.error(`[ImageGen] Failed for ${params.petName} after ${elapsed}ms:`, error)
    return null
  }
}

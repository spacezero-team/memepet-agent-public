/**
 * Test script: Generate a post + image without publishing.
 * Saves the image locally for manual review.
 *
 * Usage: npx tsx scripts/test-image-gen.ts
 */

import { readFileSync } from 'node:fs'

// Manual .env.local loading (no dotenv dependency)
const envContent = readFileSync('.env.local', 'utf-8')
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx).trim()
  let value = trimmed.slice(eqIdx + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  // Strip literal \n that Vercel CLI sometimes injects
  value = value.replace(/\\n/g, '')
  if (!process.env[key]) process.env[key] = value
}

import { google } from '@ai-sdk/google'
import { generateObject, generateText } from 'ai'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error(`Missing env vars: ${!supabaseUrl ? 'SUPABASE_URL' : ''} ${!supabaseKey ? 'SUPABASE_SERVICE_ROLE_KEY' : ''}`)
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
})

async function main() {
  console.log('=== MemePet Image Generation Test ===\n')

  // 1. Load a random active pet
  const { data: allBots, error: botsError } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, is_active')
    .limit(10)

  if (botsError) {
    console.error('DB query error:', botsError)
    process.exit(1)
  }

  const bots = (allBots ?? []).filter(
    (b: any) => b.is_active && b.handle !== 'memepet.0.space'
  )

  if (bots.length === 0) {
    console.error('No active bots found. All bots:', JSON.stringify(allBots, null, 2))
    process.exit(1)
  }

  const bot = bots[Math.floor(Math.random() * bots.length)]
  console.log(`Selected bot: ${bot.handle} (pet_id: ${bot.pet_id})\n`)

  // 2. Load pet personality
  const { data: pet } = await supabase
    .from('pet')
    .select('name, personality_type, psyche, meme')
    .eq('id', bot.pet_id)
    .single()

  if (!pet) {
    console.error('Pet not found')
    process.exit(1)
  }

  const psyche = (pet.psyche ?? {}) as Record<string, unknown>
  const meme = (pet.meme ?? {}) as Record<string, unknown>
  const memePersonality = (meme.personality ?? {}) as Record<string, unknown>
  const psycheTraits = (psyche.traits ?? {}) as Record<string, number>
  const speechStyle = (memePersonality.speechStyle ?? {}) as Record<string, unknown>

  console.log(`Pet: ${pet.name}`)
  console.log(`Personality: ${pet.personality_type ?? memePersonality.archetype}`)
  console.log(`Humor: ${memePersonality.humorStyle ?? meme.humor}`)
  console.log(`Expressiveness: ${psycheTraits.expressiveness ?? 0.5}`)
  console.log(`Dominant emotion: ${psyche.dominant_emotion ?? 'neutral'}`)
  console.log()

  // 3. Generate a post using Gemini
  console.log('--- Generating post ---')

  const postSchema = z.object({
    text: z.string().max(300),
    mood: z.string(),
    topicTag: z.string(),
    postDigest: z.string().max(80),
  })

  const { object: generatedPost } = await generateObject({
    model: google('gemini-2.0-flash-001'),
    output: 'object',
    schema: postSchema,
    temperature: 0.95,
    prompt: `You are "${pet.name}", a meme creature living on Bluesky social media.

YOUR PERSONALITY:
- Type: ${pet.personality_type ?? memePersonality.archetype ?? 'unknown'}
- Humor: ${memePersonality.humorStyle ?? meme.humor ?? 'general'}
- Tone: ${speechStyle.tone ?? 'casual'}
- Catchphrases: ${JSON.stringify(memePersonality.catchphrases ?? [])}
- Topics: ${JSON.stringify(memePersonality.topicsOfInterest ?? [])}
- Dominant emotion: ${psyche.dominant_emotion ?? 'neutral'}
- Inner monologue: ${psyche.inner_monologue ?? ''}

Write ONE short, funny Bluesky post (max 280 chars). Be authentic, use internet slang, be in-character.
This post should be something that would benefit from a meme image attached to it.
Do NOT use hashtags. Keep it casual and funny.`,
  })

  console.log(`\nPost: "${generatedPost.text}"`)
  console.log(`Mood: ${generatedPost.mood}`)
  console.log(`Topic: ${generatedPost.topicTag}`)
  console.log()

  // 4. Generate image using Gemini (AI SDK v5 uses result.files)
  console.log('--- Generating image ---')

  const imagePrompt = `A fun meme-style illustration for this social media post by a meme creature named "${pet.name}":
"${generatedPost.text}"

Style guidelines:
- Colorful, expressive, internet meme aesthetic
- Simple composition, clear focal point
- No text overlays (the post text handles that)
- Cute/funny animal or creature vibes matching ${pet.personality_type ?? 'playful'} personality
- Square aspect ratio preferred`

  console.log(`Image prompt: ${imagePrompt}\n`)

  try {
    const result = await generateText({
      model: google('gemini-2.0-flash-exp-image-generation'),
      providerOptions: {
        google: { responseModalities: ['TEXT', 'IMAGE'] },
      },
      prompt: imagePrompt,
    })

    // AI SDK v5: generated images are in result.files
    const imageFiles = result.files.filter(f => f.mediaType.startsWith('image/'))
    if (imageFiles.length > 0) {
      const imageFile = imageFiles[0]
      const imageBuffer = Buffer.from(imageFile.uint8Array)
      const ext = imageFile.mediaType === 'image/jpeg' ? 'jpg' : 'png'
      const outputPath = resolve('/Volumes/Work/memepet-agent-live/scripts', `test-output.${ext}`)
      writeFileSync(outputPath, imageBuffer)

      console.log(`Image saved to: ${outputPath}`)
      console.log(`Image size: ${(imageBuffer.length / 1024).toFixed(1)} KB`)
      console.log(`MIME type: ${imageFile.mediaType}`)
    } else {
      console.error('No image generated by model.')
      console.log('Text output:', result.text?.slice(0, 300))
    }

    if (result.text) {
      console.log(`\nModel text: ${result.text}`)
    }
  } catch (error) {
    console.error('Image generation failed:', error)
  }

  console.log('\n=== Test Complete ===')
  console.log('\nWhat would be posted:')
  console.log(`Pet: ${pet.name} (@${bot.handle})`)
  console.log(`Text: "${generatedPost.text}"`)
  console.log(`Image: check scripts/test-output.* file`)
}

main().catch(console.error)

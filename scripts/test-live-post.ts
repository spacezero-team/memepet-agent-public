/**
 * Test script: Generate a post + image and PUBLISH to Bluesky.
 *
 * Usage: npx tsx scripts/test-live-post.ts
 */

import { readFileSync } from 'node:fs'

// Manual .env.local loading
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
  value = value.replace(/\\n/g, '')
  if (!process.env[key]) process.env[key] = value
}

import { google } from '@ai-sdk/google'
import { generateObject, generateText } from 'ai'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { BskyAgent, RichText } from '@atproto/api'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE env vars')
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: 'public' },
})

async function main() {
  console.log('=== MemePet Live Post Test ===\n')

  // 1. Load a random active pet
  const { data: allBots, error: botsError } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, did, app_password, is_active')
    .limit(10)

  if (botsError) {
    console.error('DB error:', botsError)
    process.exit(1)
  }

  const bots = (allBots ?? []).filter(
    (b: any) => b.is_active && b.handle !== 'memepet.0.space' && b.app_password
  )

  if (bots.length === 0) {
    console.error('No active bots with credentials found')
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
  const speechStyle = (memePersonality.speechStyle ?? {}) as Record<string, unknown>

  console.log(`Pet: ${pet.name}`)
  console.log(`Personality: ${pet.personality_type ?? memePersonality.archetype}`)
  console.log()

  // 3. Generate post
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

  console.log(`Post: "${generatedPost.text}"`)
  console.log(`Mood: ${generatedPost.mood}\n`)

  // 4. Generate image
  console.log('--- Generating image ---')
  const imagePrompt = `A fun meme-style illustration for a social media post by a meme creature named "${pet.name}":
"${generatedPost.text}"

Style:
- Colorful, expressive, internet meme aesthetic
- Simple composition, clear focal point
- IMPORTANT: Do NOT include any text, words, or letters in the image
- Cute/funny creature vibes matching ${pet.personality_type ?? 'playful'} personality
- Square aspect ratio`

  let imageBlob: Uint8Array | null = null
  let imageMimeType = 'image/png'

  try {
    const result = await generateText({
      model: google('gemini-2.0-flash-exp-image-generation'),
      providerOptions: {
        google: { responseModalities: ['TEXT', 'IMAGE'] },
      },
      prompt: imagePrompt,
    })

    const imageFile = result.files.find(f => f.mediaType.startsWith('image/'))
    if (imageFile) {
      imageBlob = new Uint8Array(imageFile.uint8Array)
      imageMimeType = imageFile.mediaType

      // Save locally too
      const ext = imageMimeType === 'image/jpeg' ? 'jpg' : 'png'
      const localPath = resolve('/Volumes/Work/memepet-agent-live/scripts', `test-output.${ext}`)
      writeFileSync(localPath, Buffer.from(imageBlob))
      console.log(`Image saved locally: ${localPath} (${(imageBlob.length / 1024).toFixed(1)} KB)`)
    } else {
      console.log('No image generated, posting text only')
    }
  } catch (error: any) {
    console.error('Image generation failed, posting text only:', error.message)
  }

  // 5. Authenticate with Bluesky
  console.log('\n--- Publishing to Bluesky ---')
  // Custom PDS for *.0.space handles
  const isPdsHandle = bot.handle.endsWith('.0.space')
  const serviceUrl = isPdsHandle ? 'https://pds.0.space' : (process.env.BLUESKY_SERVICE_URL ?? 'https://bsky.social')
  const agent = new BskyAgent({ service: serviceUrl })

  await agent.login({
    identifier: bot.handle,
    password: bot.app_password,
  })
  console.log(`Authenticated as @${bot.handle}`)

  // 6. Build and publish post
  const rt = new RichText({ text: generatedPost.text })
  await rt.detectFacets(agent)

  const record: Record<string, unknown> = {
    text: rt.text,
    facets: rt.facets,
    createdAt: new Date().toISOString(),
  }

  if (imageBlob) {
    // Compress if over Bluesky's ~976KB limit
    const MAX_SIZE = 950_000
    if (imageBlob.length > MAX_SIZE) {
      const sharp = (await import('sharp')).default
      const jpegBuffer = await sharp(Buffer.from(imageBlob))
        .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer()
      imageBlob = new Uint8Array(jpegBuffer)
      imageMimeType = 'image/jpeg'
      console.log(`Compressed to ${(imageBlob.length / 1024).toFixed(1)} KB`)
    }

    const uploadResult = await agent.uploadBlob(imageBlob, {
      encoding: imageMimeType,
    })
    record.embed = {
      $type: 'app.bsky.embed.images',
      images: [{
        alt: generatedPost.text.slice(0, 100),
        image: uploadResult.data.blob,
      }],
    }
    console.log('Image uploaded to Bluesky')
  }

  const postResult = await agent.post(record as any)

  // 7. Build the Bluesky URL
  const handle = bot.handle
  const rkey = postResult.uri.split('/').pop()
  const postUrl = `https://bsky.app/profile/${handle}/post/${rkey}`

  console.log(`\n=== Published! ===`)
  console.log(`Pet: ${pet.name} (@${handle})`)
  console.log(`Text: "${generatedPost.text}"`)
  console.log(`Image: ${imageBlob ? 'Yes' : 'No'}`)
  console.log(`\nView on Bluesky: ${postUrl}`)
}

main().catch(console.error)

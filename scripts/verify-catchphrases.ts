/**
 * Check if catchphrases appear in actual Bluesky posts.
 * 1. Load all catchphrases from DB
 * 2. Check recent posts for catchphrase matches
 * 3. Generate Bluesky links for matching posts
 */
import { readFileSync } from 'node:fs'

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
  if (!process.env[key]) process.env[key] = value
}

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

async function main() {
  // 1. Load all pet catchphrases
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, did')
    .eq('is_active', true)

  const petIds = (bots ?? []).map(b => b.pet_id)
  const { data: pets } = await supabase
    .from('pet')
    .select('id, name, meme')
    .in('id', petIds)

  const petCatchphrases: Array<{
    petId: string
    name: string
    handle: string
    did: string
    catchphrases: string[]
  }> = []

  for (const pet of (pets ?? [])) {
    const bot = (bots ?? []).find(b => b.pet_id === pet.id)
    if (!bot) continue
    const meme = (pet.meme ?? {}) as Record<string, unknown>
    const mp = (meme.memePersonality ?? {}) as Record<string, unknown>
    const phrases = Array.isArray(mp.catchphrases) ? (mp.catchphrases as string[]) : []
    if (phrases.length > 0) {
      petCatchphrases.push({
        petId: pet.id,
        name: pet.name,
        handle: bot.handle,
        did: bot.did || '',
        catchphrases: phrases,
      })
    }
  }

  console.log('=== Pet Catchphrases ===')
  for (const p of petCatchphrases) {
    console.log(`@${p.handle} (${p.name}): ${p.catchphrases.map(c => `"${c}"`).join(', ')}`)
  }
  console.log(`\nTotal: ${petCatchphrases.length} pets with catchphrases\n`)

  // 2. Check ALL proactive_post and interaction_initiate logs for catchphrase matches
  const { data: posts } = await supabase
    .from('bluesky_post_log')
    .select('pet_id, content, post_uri, activity_type, created_at')
    .in('activity_type', ['proactive_post', 'proactive_thread', 'interaction_initiate', 'reactive_reply'])
    .order('created_at', { ascending: false })
    .limit(200)

  console.log('=== Scanning posts for catchphrase matches ===')
  const matches: Array<{
    handle: string
    name: string
    catchphrase: string
    content: string
    postUri: string
    createdAt: string
    bskyUrl: string
  }> = []

  for (const post of (posts ?? [])) {
    const pet = petCatchphrases.find(p => p.petId === post.pet_id)
    if (!pet) continue

    const contentLower = (post.content ?? '').toLowerCase()
    for (const phrase of pet.catchphrases) {
      // Check for the catchphrase or key words from it
      const phraseLower = phrase.toLowerCase().replace(/[^\w\s]/g, '')
      const words = phraseLower.split(/\s+/).filter(w => w.length > 3)

      // Exact match or significant word overlap
      const exactMatch = contentLower.includes(phraseLower.slice(0, 20))
      const wordMatch = words.length > 0 && words.filter(w => contentLower.includes(w)).length >= Math.ceil(words.length * 0.5)

      if (exactMatch || wordMatch) {
        const rkey = post.post_uri?.split('/').pop() ?? ''
        const bskyUrl = post.post_uri
          ? `https://bsky.app/profile/${pet.handle}/post/${rkey}`
          : '(no URI)'

        matches.push({
          handle: pet.handle,
          name: pet.name,
          catchphrase: phrase,
          content: (post.content ?? '').slice(0, 120),
          postUri: post.post_uri ?? '',
          createdAt: post.created_at ?? '',
          bskyUrl,
        })
        break // One match per post is enough
      }
    }
  }

  if (matches.length > 0) {
    console.log(`\nFound ${matches.length} posts with catchphrase influence:\n`)
    for (const m of matches) {
      console.log(`@${m.handle} (${m.name}) — catchphrase: "${m.catchphrase}"`)
      console.log(`  Content: ${m.content}`)
      console.log(`  Time: ${m.createdAt}`)
      console.log(`  Link: ${m.bskyUrl}`)
      console.log()
    }
  } else {
    console.log('\nNo catchphrase matches found in recent posts.')
    console.log('This is expected if the fix was just deployed — need a new cron cycle.')
  }

  // 3. Check when the fix was deployed vs last post
  const { data: latest } = await supabase
    .from('bluesky_post_log')
    .select('created_at, activity_type')
    .in('activity_type', ['proactive_post', 'proactive_thread'])
    .order('created_at', { ascending: false })
    .limit(1)

  const lastPost = latest?.[0]?.created_at
  console.log(`\nLast proactive post: ${lastPost ?? 'none'}`)
  console.log(`Current time: ${new Date().toISOString()}`)
  if (lastPost) {
    const minAgo = Math.round((Date.now() - new Date(lastPost).getTime()) / 60000)
    console.log(`Gap: ${minAgo} minutes ago`)
    if (minAgo > 35) {
      console.log('→ Next cron (*/30) should trigger new posts soon, or trigger manually.')
    }
  }
}

main().catch(console.error)

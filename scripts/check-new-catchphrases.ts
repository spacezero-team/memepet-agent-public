/**
 * Check posts created after the meme key fix for catchphrase matches.
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
  // Posts after the fix deployment (~18:42 UTC)
  const cutoff = '2026-02-15T18:42:00+00:00'

  // 1. Load catchphrases
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, did')
    .eq('is_active', true)

  const petIds = (bots ?? []).map(b => b.pet_id)
  const { data: pets } = await supabase
    .from('pet')
    .select('id, name, meme')
    .in('id', petIds)

  const petMap = new Map<string, { name: string; handle: string; did: string; catchphrases: string[] }>()
  for (const pet of (pets ?? [])) {
    const bot = (bots ?? []).find(b => b.pet_id === pet.id)
    if (!bot) continue
    const meme = (pet.meme ?? {}) as Record<string, unknown>
    const mp = (meme.memePersonality ?? {}) as Record<string, unknown>
    const phrases = Array.isArray(mp.catchphrases) ? (mp.catchphrases as string[]) : []
    petMap.set(pet.id, {
      name: pet.name,
      handle: bot.handle,
      did: bot.did || '',
      catchphrases: phrases,
    })
  }

  // 2. Get new posts
  const { data: posts } = await supabase
    .from('bluesky_post_log')
    .select('pet_id, content, post_uri, activity_type, created_at')
    .gte('created_at', cutoff)
    .in('activity_type', ['proactive_post', 'proactive_thread', 'interaction_initiate', 'reactive_reply'])
    .order('created_at', { ascending: true })
    .limit(50)

  console.log(`=== New posts after fix (${cutoff}) ===`)
  console.log(`Count: ${(posts ?? []).length}\n`)

  if (!posts?.length) {
    console.log('No new posts yet. The cron may not have triggered workflows.')
    return
  }

  for (const post of posts) {
    const pet = petMap.get(post.pet_id)
    if (!pet) continue

    const rkey = post.post_uri?.split('/').pop() ?? ''
    const bskyUrl = post.post_uri
      ? `https://bsky.app/profile/${pet.handle}/post/${rkey}`
      : '(no URI)'

    // Check catchphrase match
    const contentLower = (post.content ?? '').toLowerCase()
    let matchedPhrase = ''
    for (const phrase of pet.catchphrases) {
      const phraseLower = phrase.toLowerCase()
      // Check for exact substring or key distinctive words
      if (contentLower.includes(phraseLower.slice(0, Math.min(phraseLower.length, 25)).replace(/[^\w\s]/g, ''))) {
        matchedPhrase = phrase
        break
      }
    }

    const marker = matchedPhrase ? '🎯 CATCHPHRASE' : ''
    console.log(`[${post.created_at?.slice(11, 19)}] @${pet.handle} (${pet.name}) ${post.activity_type} ${marker}`)
    console.log(`  "${(post.content ?? '').slice(0, 140)}"`)
    if (matchedPhrase) console.log(`  Matched: "${matchedPhrase}"`)
    console.log(`  ${bskyUrl}`)
    console.log()
  }
}

main().catch(console.error)

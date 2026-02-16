// scripts/check-meme-data.ts
// Checks whether pet.meme JSONB contains blueskyHandle and blueskyDid for active bots.
// The iOS app reads blueskyDid from pet.meme as a fallback.

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
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

interface BotConfig {
  readonly pet_id: string
  readonly handle: string
  readonly did: string | null
  readonly is_active: boolean
}

interface PetRow {
  readonly id: string
  readonly meme: Record<string, unknown> | null
}

async function main() {
  // 1. Get all active bot pet_ids from bluesky_bot_config
  const { data: bots, error: botsError } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, did, is_active')
    .eq('is_active', true)

  if (botsError) {
    console.error('Error fetching bot configs:', botsError)
    return
  }

  const activeBots = (bots ?? []) as readonly BotConfig[]

  if (activeBots.length === 0) {
    console.log('No active bots found in bluesky_bot_config.')
    return
  }

  console.log(`=== Meme JSONB Bluesky Data Check ===\n`)
  console.log(`Found ${activeBots.length} active bot(s)\n`)

  const petIds = activeBots.map((b) => b.pet_id)

  // 2. Fetch pet.meme for each pet_id
  const { data: pets, error: petsError } = await supabase
    .from('pet')
    .select('id, meme')
    .in('id', petIds)

  if (petsError) {
    console.error('Error fetching pets:', petsError)
    return
  }

  const petMap = new Map(
    ((pets ?? []) as readonly PetRow[]).map((p) => [p.id, p.meme])
  )

  // 3. Check each bot's pet.meme for blueskyHandle and blueskyDid
  let missingCount = 0

  for (const bot of activeBots) {
    const meme = petMap.get(bot.pet_id)
    const hasHandle = meme?.blueskyHandle != null && meme.blueskyHandle !== ''
    const hasDid = meme?.blueskyDid != null && meme.blueskyDid !== ''

    const handleStatus = hasHandle
      ? `blueskyHandle: ${meme!.blueskyHandle}`
      : 'blueskyHandle: MISSING'
    const didStatus = hasDid
      ? `blueskyDid: ${meme!.blueskyDid}`
      : 'blueskyDid: MISSING'

    const ok = hasHandle && hasDid
    const icon = ok ? 'OK' : 'WARN'

    if (!ok) missingCount++

    console.log(`[${icon}] @${bot.handle} (pet_id: ${bot.pet_id})`)
    console.log(`  bot_config.did: ${bot.did ?? 'NULL'}`)
    console.log(`  meme.${handleStatus}`)
    console.log(`  meme.${didStatus}`)

    if (!meme) {
      console.log('  ** pet.meme is NULL -- no meme data at all **')
    }

    console.log()
  }

  // 4. Summary
  console.log('---')
  if (missingCount === 0) {
    console.log('All active bots have blueskyHandle and blueskyDid in pet.meme.')
  } else {
    console.log(
      `${missingCount} of ${activeBots.length} active bot(s) missing blueskyHandle or blueskyDid in pet.meme.`
    )
    console.log(
      'The iOS app uses pet.meme.blueskyDid as a fallback -- these pets will not link correctly.'
    )
  }
}

main().catch(console.error)

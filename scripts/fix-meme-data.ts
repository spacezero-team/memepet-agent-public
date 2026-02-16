// scripts/fix-meme-data.ts
// Finds all active bots in bluesky_bot_config with handle + did,
// then ensures each bot's pet.meme JSONB includes blueskyHandle and blueskyDid.
// Uses bluesky_bot_config as the authoritative source for Bluesky identity.

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
  readonly did: string
  readonly is_active: boolean
}

interface PetRow {
  readonly id: string
  readonly meme: Record<string, unknown> | null
}

async function main() {
  // 1. Get all active bots that have both handle and did
  const { data: bots, error: botsError } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, did, is_active')
    .eq('is_active', true)
    .not('handle', 'is', null)
    .not('did', 'is', null)

  if (botsError) {
    console.error('Error fetching bot configs:', botsError)
    return
  }

  const activeBots = (bots ?? []).filter(
    (b): b is BotConfig => b.handle !== '' && b.did !== ''
  )

  if (activeBots.length === 0) {
    console.log('No active bots with handle + did found.')
    return
  }

  console.log(`=== Fix pet.meme Bluesky Identity ===\n`)
  console.log(`Found ${activeBots.length} active bot(s) with handle + did\n`)

  // 2. Fetch pet.meme for each bot's pet_id
  const petIds = activeBots.map((b) => b.pet_id)
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

  // 3. Check each bot and fix if needed
  let fixedCount = 0
  let alreadyOkCount = 0
  let errorCount = 0

  for (const bot of activeBots) {
    const currentMeme = petMap.get(bot.pet_id)
    const existingHandle = currentMeme?.blueskyHandle as string | undefined
    const existingDid = currentMeme?.blueskyDid as string | undefined

    const needsUpdate =
      existingHandle !== bot.handle || existingDid !== bot.did

    if (!needsUpdate) {
      console.log(`[OK] @${bot.handle} (pet_id: ${bot.pet_id}) -- already correct`)
      alreadyOkCount++
      continue
    }

    // Merge: keep all existing meme data, add/overwrite blueskyHandle and blueskyDid
    const updatedMeme: Record<string, unknown> = {
      ...(currentMeme ?? {}),
      blueskyHandle: bot.handle,
      blueskyDid: bot.did,
    }

    const { error: updateError } = await supabase
      .from('pet')
      .update({ meme: updatedMeme })
      .eq('id', bot.pet_id)

    if (updateError) {
      console.error(
        `[ERROR] @${bot.handle} (pet_id: ${bot.pet_id}) -- update failed:`,
        updateError.message
      )
      errorCount++
      continue
    }

    console.log(`[FIXED] @${bot.handle} (pet_id: ${bot.pet_id})`)
    console.log(`  blueskyHandle: ${existingHandle ?? 'MISSING'} -> ${bot.handle}`)
    console.log(`  blueskyDid: ${existingDid ?? 'MISSING'} -> ${bot.did}`)
    fixedCount++
  }

  // 4. Summary
  console.log('\n--- Summary ---')
  console.log(`Total active bots: ${activeBots.length}`)
  console.log(`Already correct:   ${alreadyOkCount}`)
  console.log(`Fixed:             ${fixedCount}`)
  console.log(`Errors:            ${errorCount}`)

  // 5. Verify the fix
  if (fixedCount > 0) {
    console.log('\n--- Verification ---')
    const { data: verifyPets } = await supabase
      .from('pet')
      .select('id, meme')
      .in('id', petIds)

    for (const pet of (verifyPets ?? []) as readonly PetRow[]) {
      const bot = activeBots.find((b) => b.pet_id === pet.id)
      if (!bot) continue
      const meme = pet.meme
      const handleOk = meme?.blueskyHandle === bot.handle
      const didOk = meme?.blueskyDid === bot.did
      const status = handleOk && didOk ? 'OK' : 'FAIL'
      console.log(`[${status}] @${bot.handle} -- handle=${handleOk}, did=${didOk}`)
    }
  }
}

main().catch(console.error)

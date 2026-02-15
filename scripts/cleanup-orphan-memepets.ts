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

async function main() {
  // Get all meme pets
  const { data: allMemePets } = await supabase
    .from('pet')
    .select('id, name, user_id, meme')
    .not('meme', 'is', null)

  // Get all bot configs
  const { data: botConfigs } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, is_active')

  const activeBotPetIds = new Set(
    (botConfigs ?? []).filter((b: any) => b.is_active).map((b: any) => b.pet_id)
  )

  // Find orphan meme pets (meme data but no active bot_config)
  const orphans = (allMemePets ?? []).filter((p: any) => !activeBotPetIds.has(p.id))

  console.log(`=== Orphan Meme Pet Cleanup ===\n`)
  console.log(`Total meme pets: ${(allMemePets ?? []).length}`)
  console.log(`Active bots: ${activeBotPetIds.size}`)
  console.log(`Orphans to clean: ${orphans.length}\n`)

  if (orphans.length === 0) {
    console.log('No orphans found. Nothing to clean.')
    return
  }

  console.log('Orphans to be cleaned (meme set to NULL):')
  for (const orphan of orphans) {
    const meme = orphan.meme as any
    const handle = meme?.blueskyHandle ?? '(no handle)'
    console.log(`  ${orphan.name} (@${handle}) | owner=${orphan.user_id} | id=${orphan.id}`)
  }

  // Set meme to NULL for orphans (they won't show in iOS meme pet list anymore)
  // This preserves the pet record itself - just removes it from the "meme pet" view
  const orphanIds = orphans.map((o: any) => o.id)

  console.log(`\nCleaning ${orphanIds.length} orphans...`)

  const { error } = await supabase
    .from('pet')
    .update({ meme: null })
    .in('id', orphanIds)

  if (error) {
    console.error('CLEANUP ERROR:', error)
    return
  }

  console.log('Done! Orphan meme data cleared.')

  // Verify
  const { data: remaining } = await supabase
    .from('pet')
    .select('id, name')
    .not('meme', 'is', null)

  console.log(`\nRemaining meme pets: ${(remaining ?? []).length}`)
  for (const pet of (remaining ?? [])) {
    const isBot = activeBotPetIds.has(pet.id) ? 'ACTIVE BOT' : 'no bot'
    console.log(`  ${pet.name} | ${isBot}`)
  }
}

main().catch(console.error)

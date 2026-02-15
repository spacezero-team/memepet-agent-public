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
  // Get ALL meme pets
  const { data: pets } = await supabase
    .from('pet')
    .select('id, name, user_id, meme')
    .not('meme', 'is', null)

  // Get all bot configs
  const { data: botConfigs } = await supabase
    .from('bluesky_bot_config')
    .select('id, pet_id, handle, did, is_active')

  const botByPetId = new Map((botConfigs ?? []).map((b: any) => [b.pet_id, b]))

  // Group pets by name to find duplicates
  const byName = new Map<string, any[]>()
  for (const pet of (pets ?? [])) {
    const name = pet.name.toLowerCase()
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name)?.push(pet)
  }

  console.log('=== Duplicate Pet Analysis ===\n')

  // Show duplicates
  let dupeCount = 0
  for (const [name, petList] of byName) {
    if (petList.length > 1) {
      dupeCount++
      console.log(`DUPLICATE: "${petList[0].name}" (${petList.length} copies)`)
      for (const pet of petList) {
        const meme = pet.meme as any
        const handle = meme?.blueskyHandle ?? '(no handle)'
        const bot = botByPetId.get(pet.id)
        const botStatus = bot
          ? `bot_config: ${bot.handle} (active=${bot.is_active})`
          : 'NO bot_config'
        console.log(`  id=${pet.id} | owner=${pet.user_id} | @${handle} | ${botStatus}`)
      }
      console.log()
    }
  }

  if (dupeCount === 0) {
    console.log('No duplicate names found.\n')
  }

  // Show all pets with handles but no bot_config (orphaned bluesky accounts)
  console.log('=== Pets with Bluesky Handle but NO bot_config ===\n')
  for (const pet of (pets ?? [])) {
    const meme = pet.meme as any
    if (meme?.blueskyHandle && !botByPetId.has(pet.id)) {
      console.log(`  ${pet.name} | id=${pet.id} | @${meme.blueskyHandle} | owner=${pet.user_id}`)
    }
  }

  // Show bot_configs whose pet_id doesn't match any pet with matching handle in meme
  console.log('\n=== Bot Configs -> Which pet they point to ===\n')
  const petById = new Map((pets ?? []).map((p: any) => [p.id, p]))
  for (const bot of (botConfigs ?? [])) {
    const pet = petById.get(bot.pet_id)
    if (pet) {
      const meme = pet.meme as any
      const memeHandle = meme?.blueskyHandle ?? '(none)'
      const match = memeHandle === bot.handle ? 'MATCH' : `MISMATCH (meme=${memeHandle})`
      console.log(`  ${bot.handle} -> pet "${pet.name}" (${pet.user_id}) | handle ${match}`)
    } else {
      console.log(`  ${bot.handle} -> pet NOT IN meme pets list (id=${bot.pet_id})`)
    }
  }
}

main().catch(console.error)

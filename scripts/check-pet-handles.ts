import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

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

const sb = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

async function main() {
  // Get pets with blueskyHandle in meme JSONB
  const { data: pets, error: petErr } = await sb
    .from('pet')
    .select('id, name, meme')
    .not('meme', 'is', null)
    .order('created_at', { ascending: false })
    .limit(20)

  if (petErr) {
    console.error(petErr)
    process.exit(1)
  }

  console.log('=== Pet meme.blueskyHandle values ===\n')

  for (const pet of pets ?? []) {
    const meme = pet.meme as Record<string, unknown> | null
    const handle = meme?.blueskyHandle ?? 'NOT SET'
    console.log(`${pet.name} (${pet.id.slice(0, 8)}...) → blueskyHandle: ${handle}`)
  }

  // Also get bot config handles for comparison
  console.log('\n=== bluesky_bot_config handles ===\n')
  const { data: bots } = await sb
    .from('bluesky_bot_config')
    .select('pet_id, handle')

  for (const bot of bots ?? []) {
    console.log(`pet_id: ${bot.pet_id.slice(0, 8)}... → handle: ${bot.handle}`)
  }

  // Cross-reference: find mismatches
  console.log('\n=== Mismatch check ===\n')
  const botMap = new Map((bots ?? []).map(b => [b.pet_id, b.handle]))

  for (const pet of pets ?? []) {
    const meme = pet.meme as Record<string, unknown> | null
    const memeHandle = meme?.blueskyHandle as string | undefined
    const botHandle = botMap.get(pet.id)

    if (memeHandle && botHandle && memeHandle !== botHandle) {
      console.log(`MISMATCH: ${pet.name}`)
      console.log(`  meme.blueskyHandle: ${memeHandle}`)
      console.log(`  bot_config.handle:  ${botHandle}`)
    }
  }
}

main().catch(console.error)

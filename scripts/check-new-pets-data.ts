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
  // Check if ChocoSpida and ChocoWeb have bot config entries (service role can see all)
  const petIds = ['4e93bd85', '7a5b58f1']

  console.log('=== Checking all tables for new pet data ===\n')

  // Full pet data for these two
  const { data: pets } = await sb
    .from('pet')
    .select('id, name, meme, created_at')
    .or('name.eq.ChocoSpida,name.eq.ChocoWeb')

  for (const pet of pets ?? []) {
    console.log(`${pet.name} (${pet.id})`)
    console.log(`  created_at: ${pet.created_at}`)
    const meme = pet.meme as Record<string, unknown> | null
    console.log(`  meme.blueskyHandle: ${meme?.blueskyHandle}`)
    console.log(`  meme.blueskyDid: ${meme?.blueskyDid}`)
    console.log(`  meme.blueskyAppPassword: ${meme?.blueskyAppPassword ? '***PRESENT***' : 'NOT SET'}`)
    // Check all meme keys that contain 'bluesky' or 'password'
    if (meme) {
      const bskyKeys = Object.keys(meme).filter(k => k.toLowerCase().includes('bluesky') || k.toLowerCase().includes('password') || k.toLowerCase().includes('did'))
      console.log(`  bluesky-related meme keys: ${bskyKeys.join(', ')}`)
    }
    console.log('')
  }

  // Check bot_config with service role (can see app_password)
  console.log('=== bluesky_bot_config (service role) ===\n')
  for (const pet of pets ?? []) {
    const { data: config, error } = await sb
      .from('bluesky_bot_config')
      .select('*')
      .eq('pet_id', pet.id)
      .maybeSingle()

    if (error) {
      console.log(`  ${pet.name}: ERROR - ${error.message}`)
    } else if (!config) {
      console.log(`  ${pet.name}: NO CONFIG ENTRY`)
    } else {
      console.log(`  ${pet.name}: handle=${config.handle}, is_active=${config.is_active}`)
      console.log(`    app_password: ${config.app_password ? '***PRESENT***' : 'NOT SET'}`)
    }
  }
}

main().catch(console.error)

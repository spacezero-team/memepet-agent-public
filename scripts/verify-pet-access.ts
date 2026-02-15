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

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
// iOS anon key (from Secrets.xcconfig)
const anonKey = 'REDACTED_ANON_KEY'

const anonClient = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  console.log('=== Anon Key Access Test (simulates iOS without auth) ===\n')

  // Test 1: pet table with meme IS NOT NULL
  const { data: pets, error: petErr } = await anonClient
    .from('pet')
    .select('id, name, user_id, meme')
    .not('meme', 'is', null)
    .limit(20)

  if (petErr) {
    console.log('PET TABLE: ERROR -', petErr.message)
  } else {
    console.log(`PET TABLE: ${(pets ?? []).length} meme pets readable`)
    for (const p of (pets ?? [])) {
      const meme = p.meme as any
      const handle = meme?.blueskyHandle ?? 'no-handle'
      const did = meme?.blueskyDid ? 'has-did' : 'no-did'
      console.log(`  ${p.name} (@${handle}) [${did}] owner=${p.user_id}`)
    }
  }

  // Test 2: bluesky_bot_config
  const { data: bots, error: botErr } = await anonClient
    .from('bluesky_bot_config')
    .select('pet_id, handle, did, is_active')
    .eq('is_active', true)
    .limit(20)

  if (botErr) {
    console.log('\nBOT CONFIG: ERROR -', botErr.message)
  } else {
    console.log(`\nBOT CONFIG: ${(bots ?? []).length} active bots readable`)
  }

  // Test 3: bluesky_post_log
  const { data: posts, error: postErr } = await anonClient
    .from('bluesky_post_log')
    .select('id, pet_id, activity_type')
    .limit(5)

  if (postErr) {
    console.log('\nPOST LOG: ERROR -', postErr.message)
  } else {
    console.log(`POST LOG: ${(posts ?? []).length} rows readable`)
  }

  console.log('\n=== Summary ===')
  const petCount = (pets ?? []).length
  const botCount = (bots ?? []).length
  const postCount = (posts ?? []).length

  if (petCount > 0 && botCount > 0 && postCount > 0) {
    console.log('ALL TABLES ACCESSIBLE - iOS app should now show all meme pets and their posts!')
  } else {
    console.log('ISSUE: Some tables still not accessible')
    if (petCount === 0) console.log('  - pet table: no rows returned')
    if (botCount === 0) console.log('  - bluesky_bot_config: no rows returned')
    if (postCount === 0) console.log('  - bluesky_post_log: no rows returned')
  }
}

main().catch(console.error)

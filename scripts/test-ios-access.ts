// scripts/test-ios-access.ts
// Tests data access as the iOS app would see it, using the exact anon key from Secrets.xcconfig.
// Usage: npx tsx scripts/test-ios-access.ts

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// Load SUPABASE_URL from .env.local
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

const supabaseUrl = process.env.SUPABASE_URL ?? ''

// iOS anon key from env (set SUPABASE_ANON_KEY in .env.local)
const IOS_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  ''

if (!IOS_ANON_KEY) {
  console.error('ERROR: SUPABASE_ANON_KEY not set in .env.local')
  process.exit(1)
}

async function main() {
  console.log('=== iOS Data Access Test (anon key from Secrets.xcconfig) ===\n')
  console.log(`Supabase URL: ${supabaseUrl}`)
  console.log(`Anon key: ${IOS_ANON_KEY.slice(0, 30)}...${IOS_ANON_KEY.slice(-10)}\n`)

  const client = createClient(supabaseUrl, IOS_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Test 1: bluesky_bot_config (iOS fetches pet_id, handle, did, is_active, posting_frequency, updated_at)
  console.log('--- 1. bluesky_bot_config (3 rows) ---')
  const { data: botData, error: botError } = await client
    .from('bluesky_bot_config')
    .select('pet_id, handle, did, is_active, posting_frequency, updated_at')
    .limit(3)

  if (botError) {
    console.log(`  FAIL: ${botError.code} - ${botError.message}`)
  } else {
    console.log(`  OK: ${(botData ?? []).length} row(s)`)
    for (const row of botData ?? []) {
      console.log(`    @${row.handle} | active=${row.is_active} | did=${row.did ?? 'NULL'}`)
    }
  }

  // Test 2: bluesky_post_log (iOS uses select("*") with pet_id filter)
  console.log('\n--- 2. bluesky_post_log (3 rows, newest first) ---')
  const { data: logData, error: logError } = await client
    .from('bluesky_post_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3)

  if (logError) {
    console.log(`  FAIL: ${logError.code} - ${logError.message}`)
  } else {
    const rows = logData ?? []
    console.log(`  OK: ${rows.length} row(s)`)
    if (rows.length > 0) {
      console.log(`  Columns returned: ${Object.keys(rows[0]).join(', ')}`)
      for (const row of rows) {
        console.log(`    [${row.activity_type}] pet=${row.pet_id?.slice(0, 8)}... | uri=${row.post_uri ?? 'NULL'} | ${row.created_at}`)
      }
    }
  }

  // Test 3: pet table where meme is not null (iOS fetchPublicMemePets query)
  console.log('\n--- 3. pet table (meme IS NOT NULL, 3 rows) ---')
  const { data: petData, error: petError } = await client
    .from('pet')
    .select('id, user_id, name, meme')
    .not('meme', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3)

  if (petError) {
    console.log(`  FAIL: ${petError.code} - ${petError.message}`)
  } else {
    const rows = petData ?? []
    console.log(`  OK: ${rows.length} row(s)`)
    for (const row of rows) {
      const meme = row.meme as Record<string, unknown> | null
      console.log(`    ${row.name} (id=${row.id?.slice(0, 8)}...) | user_id=${row.user_id ?? 'NULL'} | blueskyHandle=${meme?.blueskyHandle ?? 'NONE'}`)
    }
  }

  // Test 4: iOS fetchPublicMemePets with blueskyHandle filter
  console.log('\n--- 4. pet table (meme->blueskyHandle IS NOT NULL, 3 rows) ---')
  const { data: pubPets, error: pubError } = await client
    .from('pet')
    .select('id, name, meme')
    .not('meme', 'is', null)
    .not('meme->blueskyHandle', 'is', null)
    .order('created_at', { ascending: false })
    .limit(3)

  if (pubError) {
    console.log(`  FAIL: ${pubError.code} - ${pubError.message}`)
  } else {
    const rows = pubPets ?? []
    console.log(`  OK: ${rows.length} row(s)`)
    for (const row of rows) {
      const meme = row.meme as Record<string, unknown> | null
      console.log(`    ${row.name} | @${meme?.blueskyHandle}`)
    }
  }

  // Summary
  console.log('\n=== Summary ===')
  console.log(`bluesky_bot_config: ${botError ? 'BLOCKED' : `${(botData ?? []).length} rows readable`}`)
  console.log(`bluesky_post_log:   ${logError ? 'BLOCKED' : `${(logData ?? []).length} rows readable`}`)
  console.log(`pet (meme!=null):   ${petError ? 'BLOCKED' : `${(petData ?? []).length} rows readable`}`)
  console.log(`pet (w/ handle):    ${pubError ? 'BLOCKED' : `${(pubPets ?? []).length} rows readable`}`)

  const allOk = !botError && !logError && !petError && !pubError
  if (allOk) {
    console.log('\nAll tables accessible with iOS anon key. RLS policies allow anonymous reads.')
  } else {
    console.log('\nSome tables are blocked. Check RLS policies above.')
  }
}

main().catch(console.error)

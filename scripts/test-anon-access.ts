// scripts/test-anon-access.ts
// Tests whether anonymous (unauthenticated) users can read bluesky_bot_config.
// Simulates what the iOS app would see without auth by using only the anon key.

import { readFileSync, existsSync } from 'node:fs'

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

// Try multiple possible env var names for anon key
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  ''

function searchForAnonKey(): string | null {
  // Check other config files that might contain the anon key
  const candidates = ['.env', '.env.production', '.env.development', 'next.config.js', 'next.config.mjs', 'next.config.ts']
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const content = readFileSync(file, 'utf-8')
    const match = content.match(/SUPABASE_ANON_KEY\s*[=:]\s*['"]?([A-Za-z0-9._-]+)['"]?/)
    if (match?.[1]) {
      console.log(`Found anon key in ${file}`)
      return match[1]
    }
  }
  return null
}

async function main() {
  console.log('=== Anon / Unauthenticated Access Test ===\n')
  console.log(`Supabase URL: ${supabaseUrl}\n`)

  let resolvedAnonKey = anonKey

  if (!resolvedAnonKey) {
    console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY not found in .env.local')
    console.log('SUPABASE_ANON_KEY not found in .env.local')
    console.log('Searching other config files...\n')

    const found = searchForAnonKey()
    if (found) {
      resolvedAnonKey = found
    } else {
      console.log('No anon key found in any config file.')
      console.log('\nTo test anon access, add NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local')
      console.log('You can find it in Supabase Dashboard > Settings > API > anon/public key')
      console.log('\nSkipping anon client test. Testing raw REST without auth instead...\n')

      // Even without the anon key, test if the table is publicly accessible
      await testRawRestNoAuth(supabaseUrl)
      return
    }
  }

  console.log(`Anon key found: ${resolvedAnonKey.slice(0, 20)}...${resolvedAnonKey.slice(-10)}\n`)

  // Decode JWT role for clarity
  try {
    const parts = resolvedAnonKey.split('.')
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
      console.log(`JWT role: ${payload.role || 'unknown'}`)
      console.log(`JWT iss: ${payload.iss || 'unknown'}\n`)
    }
  } catch {
    // ignore decode errors
  }

  // 1. Test with Supabase client (anon key only, no service role)
  const anonClient = createClient(supabaseUrl, resolvedAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  console.log('--- Test 1: SELECT from bluesky_bot_config (anon client) ---\n')

  const { data: botData, error: botError } = await anonClient
    .from('bluesky_bot_config')
    .select('pet_id, handle, did, is_active')
    .limit(5)

  if (botError) {
    console.log(`RESULT: ERROR`)
    console.log(`  Code: ${botError.code}`)
    console.log(`  Message: ${botError.message}`)
    console.log(`  Details: ${botError.details}`)
    console.log(`  Hint: ${botError.hint}`)
    console.log('\n  -> Anon users CANNOT read bluesky_bot_config')
    console.log('  -> RLS is likely blocking anonymous SELECT')
  } else {
    const rows = botData ?? []
    console.log(`RESULT: SUCCESS -- ${rows.length} row(s) returned`)
    for (const row of rows) {
      console.log(`  @${row.handle} (did: ${row.did ?? 'NULL'}, active: ${row.is_active})`)
    }
    if (rows.length > 0) {
      console.log('\n  -> WARNING: Anon users CAN read bluesky_bot_config')
      console.log('  -> This exposes bot credentials metadata to anyone with the anon key')
    } else {
      console.log('\n  -> Anon users get an empty array (RLS returns 0 rows)')
      console.log('  -> Table is protected: anon can query but RLS filters all rows')
    }
  }

  // 2. Test pet table for comparison
  console.log('\n--- Test 2: SELECT from pet (anon client) ---\n')

  const { data: petData, error: petError } = await anonClient
    .from('pet')
    .select('id, name, meme')
    .limit(5)

  if (petError) {
    console.log(`RESULT: ERROR`)
    console.log(`  Code: ${petError.code}`)
    console.log(`  Message: ${petError.message}`)
    console.log('\n  -> Anon users CANNOT read pet table')
  } else {
    const rows = petData ?? []
    console.log(`RESULT: SUCCESS -- ${rows.length} row(s) returned`)
    for (const row of rows) {
      const hasDid = (row.meme as Record<string, unknown> | null)?.blueskyDid != null
      console.log(`  ${row.name} (id: ${row.id}, meme.blueskyDid: ${hasDid ? 'present' : 'MISSING'})`)
    }
    if (rows.length > 0) {
      console.log('\n  -> Anon users CAN read pet table')
    } else {
      console.log('\n  -> Anon users get empty array from pet table')
    }
  }

  // 3. Test bluesky_post_log for comparison
  console.log('\n--- Test 3: SELECT from bluesky_post_log (anon client) ---\n')

  const { data: logData, error: logError } = await anonClient
    .from('bluesky_post_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(3)

  if (logError) {
    console.log(`RESULT: ERROR`)
    console.log(`  Code: ${logError.code}`)
    console.log(`  Message: ${logError.message}`)
    console.log('\n  -> Anon users CANNOT read bluesky_post_log')
  } else {
    const rows = logData ?? []
    console.log(`RESULT: SUCCESS -- ${rows.length} row(s) returned`)
    if (rows.length > 0) {
      console.log(`  Columns: ${Object.keys(rows[0]).join(', ')}`)
      console.log('\n  -> Anon users CAN read bluesky_post_log')
    } else {
      console.log('\n  -> Anon users get empty array from bluesky_post_log')
    }
  }

  // 4. Summary
  console.log('\n=== Summary ===\n')
  console.log('For the iOS app to read bot data without auth, either:')
  console.log('  a) RLS must allow anon SELECT on bluesky_bot_config, OR')
  console.log('  b) iOS reads pet.meme.blueskyDid from the pet table instead')
  console.log('\nOption (b) is the safer approach -- store blueskyDid in pet.meme')
  console.log('and let the iOS app read from the pet table which may have broader access.')
}

async function testRawRestNoAuth(url: string) {
  console.log('--- Raw REST without any API key ---\n')

  try {
    const res = await fetch(`${url}/rest/v1/bluesky_bot_config?select=*&limit=1`)
    console.log(`HTTP ${res.status} ${res.statusText}`)
    const body = await res.text()
    console.log(`Response: ${body.slice(0, 300)}`)
    if (res.status === 200) {
      console.log('\n  -> Table is publicly accessible WITHOUT any key (very insecure)')
    } else {
      console.log('\n  -> Table is NOT accessible without an API key (expected)')
    }
  } catch (err) {
    console.log(`Fetch error: ${err}`)
  }
}

main().catch(console.error)

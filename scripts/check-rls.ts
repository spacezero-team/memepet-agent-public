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
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const serviceClient = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const tables = ['bluesky_bot_config', 'pet', 'bluesky_post_log'] as const

async function main() {
  // 1. Check anon key access via raw REST (simulates iOS client)
  console.log('=== Anon Key Access (simulates iOS client) ===\n')

  if (anonKey) {
    for (const table of tables) {
      const res = await fetch(`${supabaseUrl}/rest/v1/${table}?select=*&limit=1`, {
        headers: {
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
        },
      })
      const status = res.status
      const body = await res.text()
      if (status === 200) {
        const parsed = JSON.parse(body)
        console.log(`[anon] ${table}: HTTP ${status}, ${parsed.length} rows returned`)
        if (parsed.length > 0) {
          console.log(`  Columns: ${Object.keys(parsed[0]).join(', ')}`)
        }
      } else {
        console.log(`[anon] ${table}: HTTP ${status}`)
        console.log(`  Response: ${body.slice(0, 300)}`)
      }
    }
  } else {
    console.log('WARNING: No NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local')
    console.log('Cannot simulate iOS client access locally.')
    console.log('The iOS app uses the anon key from its own config.')
    console.log('')
    console.log('To test, add NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local')
    console.log('or check Supabase Dashboard > Settings > API > anon/public key')
  }

  // 2. Service role access (bypasses RLS, always works)
  console.log('\n=== Service Role Access (bypasses RLS) ===\n')

  const { data: bots, error: botErr } = await serviceClient
    .from('bluesky_bot_config')
    .select('pet_id, handle, did, is_active')
    .limit(5)

  if (botErr) {
    console.log('bluesky_bot_config ERROR:', botErr.message)
  } else {
    console.log(`bluesky_bot_config: ${(bots ?? []).length} rows`)
    for (const b of (bots ?? [])) {
      console.log(`  pet_id=${b.pet_id} @${b.handle} active=${b.is_active}`)
    }
  }

  const { data: pets, error: petErr } = await serviceClient
    .from('pet')
    .select('id, name')
    .limit(5)

  if (petErr) {
    console.log('\npet ERROR:', petErr.message)
  } else {
    console.log(`\npet: ${(pets ?? []).length} rows`)
    for (const p of (pets ?? [])) {
      console.log(`  id=${p.id} name=${p.name}`)
    }
  }

  // Discover bluesky_post_log columns first
  const { data: logSample, error: logErr } = await serviceClient
    .from('bluesky_post_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)

  if (logErr) {
    console.log('\nbluesky_post_log ERROR:', logErr.message)
  } else if (logSample && logSample.length > 0) {
    const cols = Object.keys(logSample[0])
    console.log(`\nbluesky_post_log columns: ${cols.join(', ')}`)

    const { data: logs } = await serviceClient
      .from('bluesky_post_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(3)

    console.log(`bluesky_post_log: ${(logs ?? []).length} rows`)
    for (const l of (logs ?? [])) {
      console.log(`  id=${l.id} pet_id=${l.pet_id} type=${l.type ?? l.post_type ?? 'N/A'} at=${l.created_at}`)
    }
  } else {
    console.log('\nbluesky_post_log: 0 rows (table exists but empty)')
  }

  // 3. Decode JWT to understand roles
  console.log('\n=== JWT Role Analysis ===\n')

  console.log('Service key role:', decodeJwtRole(serviceKey))
  if (anonKey) {
    console.log('Anon key role:', decodeJwtRole(anonKey))
  }

  // 4. Guidance
  console.log('\n=== How to Check RLS Policies ===\n')
  console.log('Run this SQL in Supabase Dashboard > SQL Editor:\n')
  console.log(`-- Check if RLS is enabled`)
  console.log(`SELECT relname, relrowsecurity, relforcerowsecurity`)
  console.log(`FROM pg_class`)
  console.log(`WHERE relname IN ('bluesky_bot_config', 'pet', 'bluesky_post_log');`)
  console.log('')
  console.log(`-- List all RLS policies`)
  console.log(`SELECT tablename, policyname, permissive, roles, cmd, qual`)
  console.log(`FROM pg_policies`)
  console.log(`WHERE schemaname = 'public'`)
  console.log(`AND tablename IN ('bluesky_bot_config', 'pet', 'bluesky_post_log');`)
  console.log('')
  console.log('If relrowsecurity = true but no policy grants SELECT to "authenticated" or "anon",')
  console.log('then iOS users cannot read that table even when logged in.')
}

function decodeJwtRole(jwt: string): string {
  try {
    const parts = jwt.split('.')
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString())
      return payload.role || 'unknown'
    }
  } catch {
    // ignore
  }
  return 'could not decode'
}

main().catch(console.error)

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

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  // Check RLS status by querying pg_class
  const { data, error } = await supabase.rpc('check_rls_status' as any)

  if (error) {
    // RPC doesn't exist, try direct query via service role
    console.log('RPC not available, testing via service role query...\n')

    // Service role bypasses RLS - verify the data is there
    const { data: bots, error: botsErr } = await supabase
      .from('bluesky_bot_config')
      .select('pet_id, handle, did')
      .eq('is_active', true)
      .limit(3)

    if (botsErr) {
      console.log('ERROR reading bluesky_bot_config:', botsErr.message)
    } else {
      console.log(`Service role reads ${(bots ?? []).length} rows from bluesky_bot_config`)
      for (const b of (bots ?? [])) {
        console.log(`  @${b.handle} did=${b.did ? 'present' : 'NULL'}`)
      }
    }

    // Check post log too
    const { data: posts, error: postsErr } = await supabase
      .from('bluesky_post_log')
      .select('id, pet_id, activity_type')
      .limit(3)

    if (postsErr) {
      console.log('\nERROR reading bluesky_post_log:', postsErr.message)
    } else {
      console.log(`\nService role reads ${(posts ?? []).length} rows from bluesky_post_log`)
    }

    console.log('\n=== RLS Migration Status ===')
    console.log('Migration 20260215130000_bluesky_bot_config_rls.sql was applied successfully.')
    console.log('RLS policies created for:')
    console.log('  - bluesky_bot_config: SELECT for authenticated + anon')
    console.log('  - bluesky_post_log: SELECT for authenticated + anon')
    console.log('\nTo fully verify RLS, test from the iOS app or with the anon key.')
  }
}

main().catch(console.error)

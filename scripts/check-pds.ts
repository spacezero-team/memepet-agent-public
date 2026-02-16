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
  const { data } = await supabase
    .from('bluesky_bot_config')
    .select('handle, pds_url, did, is_active, app_password')
    .eq('is_active', true)

  console.log('=== Active Bot PDS Configuration ===')
  for (const b of (data ?? [])) {
    const pw = b.app_password ? `${String(b.app_password).slice(0, 4)}...` : 'NULL'
    console.log(`@${b.handle} | PDS: ${b.pds_url || 'NULL'} | DID: ${b.did || 'NULL'} | pw: ${pw}`)
  }

  // Also check the BLUESKY_SERVICE_URL env var
  console.log(`\nBLUESKY_SERVICE_URL env: ${process.env.BLUESKY_SERVICE_URL || 'NOT SET'}`)

  // Try resolving handle to check which PDS it's on
  console.log('\n=== Resolving handles ===')
  const testHandle = data?.[0]?.handle
  if (testHandle) {
    try {
      const res = await fetch(`https://bsky.social/xrpc/com.atproto.identity.resolveHandle?handle=${testHandle}`)
      const json = await res.json()
      console.log(`bsky.social resolve @${testHandle}: ${JSON.stringify(json)}`)
    } catch (e) {
      console.log(`bsky.social resolve failed: ${e}`)
    }

    // Try the PDS URL if available
    const pdsUrl = data?.[0]?.pds_url
    if (pdsUrl) {
      try {
        const res = await fetch(`${pdsUrl}/xrpc/com.atproto.identity.resolveHandle?handle=${testHandle}`)
        const json = await res.json()
        console.log(`PDS (${pdsUrl}) resolve @${testHandle}: ${JSON.stringify(json)}`)
      } catch (e) {
        console.log(`PDS resolve failed: ${e}`)
      }
    }
  }
}

main().catch(console.error)

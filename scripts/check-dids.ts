// scripts/check-dids.ts
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
  const { data, error } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, did, is_active')
    .order('handle')

  if (error) {
    console.error('Error:', error)
    return
  }

  console.log('=== Bot Config DID Status ===\n')
  for (const bot of (data ?? [])) {
    const didStatus = bot.did ? `DID: ${bot.did}` : 'DID: NULL ⚠️'
    console.log(`${bot.is_active ? '✅' : '❌'} @${bot.handle} | ${didStatus}`)
  }
  
  const missingDid = (data ?? []).filter((b: any) => !b.did && b.is_active)
  console.log(`\n${missingDid.length} active bots missing DID`)
}

main().catch(console.error)

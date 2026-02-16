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
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

async function main() {
  const { data } = await supabase
    .from('bluesky_bot_config')
    .select('handle, app_password')
    .eq('is_active', true)
    .limit(3)

  for (const b of (data ?? [])) {
    const pw = String(b.app_password)
    const looksEncrypted = pw.length > 30 || pw.includes(':')
    const looksPlaintext = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(pw)
    console.log(`@${b.handle}: len=${pw.length} plaintext=${looksPlaintext} encrypted=${looksEncrypted}`)
    console.log(`  preview: ${pw.slice(0, 19)}`)
  }
}

main().catch(console.error)

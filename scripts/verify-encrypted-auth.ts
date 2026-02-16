/**
 * Verify that bots can still authenticate after password encryption.
 */
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
import { BskyAgent } from '@atproto/api'
import { decryptIfNeeded } from '../lib/utils/encrypt.js'

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

async function main() {
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('handle, app_password, pds_url')
    .eq('is_active', true)
    .limit(2)

  for (const bot of (bots ?? [])) {
    const decrypted = decryptIfNeeded(String(bot.app_password))
    const pds = bot.pds_url || 'https://bsky.social'
    const agent = new BskyAgent({ service: pds })

    try {
      const res = await agent.login({ identifier: bot.handle, password: decrypted })
      console.log(`OK @${bot.handle}: login success (DID: ${res.data.did.slice(0, 20)}...)`)
    } catch (e) {
      console.log(`FAIL @${bot.handle}: ${e instanceof Error ? e.message : e}`)
    }
  }
}

main().catch(console.error)

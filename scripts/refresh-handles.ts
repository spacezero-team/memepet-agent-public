/**
 * Trigger handle re-verification for all bots.
 * Forces the Bluesky relay to re-check handle resolution.
 *
 * Usage: npx tsx scripts/refresh-handles.ts
 */

import { readFileSync } from 'node:fs'

// Manual .env.local loading
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
  value = value.replace(/\\n/g, '')
  if (!process.env[key]) process.env[key] = value
}

import { createClient } from '@supabase/supabase-js'
import { BskyAgent } from '@atproto/api'

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing SUPABASE env vars')
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  console.log('=== Refreshing Bot Handles ===\n')

  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('handle, app_password, is_active')
    .eq('is_active', true)

  const activeBots = (bots ?? []).filter(
    (b: { handle: string; app_password: string | null }) =>
      b.handle !== 'memepet.0.space' && b.app_password
  )

  console.log(`Found ${activeBots.length} active bots\n`)

  for (const bot of activeBots) {
    try {
      const agent = new BskyAgent({ service: 'https://pds.0.space' })
      await agent.login({ identifier: bot.handle, password: bot.app_password })

      // updateHandle triggers identity re-propagation to the relay
      await agent.com.atproto.identity.updateHandle({ handle: bot.handle })
      console.log(`${bot.handle}: handle refreshed`)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      console.log(`${bot.handle}: ${msg}`)
    }
  }

  console.log('\n=== Done ===')
  console.log('Handle changes may take a few minutes to propagate to bsky.app')
}

main().catch(console.error)

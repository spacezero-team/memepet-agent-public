/**
 * Test authentication against the correct PDS (pds.0.space)
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

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

async function main() {
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, app_password, pds_url')
    .eq('is_active', true)
    .limit(3)

  if (!bots?.length) {
    console.error('No active bots found!')
    return
  }

  for (const bot of bots) {
    const pdsUrl = bot.pds_url || 'https://bsky.social'
    console.log(`\n=== Testing @${bot.handle} via ${pdsUrl} ===`)

    const agent = new BskyAgent({ service: pdsUrl })

    try {
      const response = await agent.login({
        identifier: bot.handle,
        password: bot.app_password
      })
      console.log(`  LOGIN SUCCESS! DID: ${response.data.did}`)

      // Persist session
      const sessionData = {
        did: response.data.did,
        handle: response.data.handle,
        accessJwt: response.data.accessJwt,
        refreshJwt: response.data.refreshJwt,
      }
      const { error: updateErr } = await supabase
        .from('bluesky_bot_config')
        .update({
          session_data: sessionData,
          updated_at: new Date().toISOString(),
        })
        .eq('pet_id', bot.pet_id)

      if (updateErr) {
        console.log(`  Session persist FAILED: ${updateErr.message}`)
      } else {
        console.log(`  Session persisted OK`)
      }

      // Verify
      const profile = await agent.getProfile({ actor: response.data.did })
      console.log(`  Profile: @${profile.data.handle} (${profile.data.displayName})`)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.log(`  LOGIN FAILED: ${msg}`)
    }
  }
}

main().catch(console.error)

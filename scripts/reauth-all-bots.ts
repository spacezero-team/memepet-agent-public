/**
 * Re-authenticate ALL active Bluesky bots and persist sessions.
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

  if (!bots?.length) {
    console.error('No active bots found!')
    return
  }

  console.log(`Re-authenticating ${bots.length} bots...\n`)

  let success = 0
  let failed = 0

  for (const bot of bots) {
    const pdsUrl = bot.pds_url || 'https://bsky.social'
    const agent = new BskyAgent({ service: pdsUrl })

    try {
      const response = await agent.login({
        identifier: bot.handle,
        password: bot.app_password
      })

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
        console.log(`FAIL @${bot.handle}: persist error — ${updateErr.message}`)
        failed++
      } else {
        console.log(`OK   @${bot.handle} → ${response.data.did.slice(0, 20)}...`)
        success++
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.log(`FAIL @${bot.handle}: ${msg}`)
      failed++
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`\nDone: ${success} OK, ${failed} failed out of ${bots.length} total`)

  // Also reset schedule_state.lastPostAt to allow immediate posting
  console.log('\nResetting schedule states to allow immediate posting...')
  const { error: resetErr } = await supabase
    .from('bluesky_bot_config')
    .update({
      schedule_state: {
        lastPostAt: null,
        dailyMood: { frequencyMultiplier: 1.0, label: 'normal' },
        moodDate: null,
        burst: null,
        postsToday: 0,
        postCountDate: null,
      }
    })
    .eq('is_active', true)

  if (resetErr) {
    console.log(`Schedule reset failed: ${resetErr.message}`)
  } else {
    console.log('Schedule states reset OK')
  }
}

main().catch(console.error)

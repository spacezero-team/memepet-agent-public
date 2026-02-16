/**
 * Direct authentication test for Bluesky bots.
 * Tests: 1) service_role reads app_password, 2) login with app_password, 3) session persistence
 */
import { readFileSync } from 'node:fs'

// Load env
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
  // 1. Test service_role can read app_password
  console.log('=== Step 1: Check service_role access to app_password ===')
  const { data: bots, error: botErr } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, app_password, session_data')
    .eq('is_active', true)
    .limit(3)

  if (botErr) {
    console.error('ERROR reading bots:', botErr)
    return
  }

  if (!bots || bots.length === 0) {
    console.error('No active bots found!')
    return
  }

  for (const bot of bots) {
    const hasAppPw = !!bot.app_password
    const hasSession = !!bot.session_data
    const appPwPreview = hasAppPw ? `${String(bot.app_password).slice(0, 8)}...` : 'NULL'
    console.log(`@${bot.handle}: app_password=${appPwPreview}, session_data=${hasSession ? 'EXISTS' : 'NULL'}`)
  }

  // 2. Test direct login for first bot
  const testBot = bots[0]
  console.log(`\n=== Step 2: Direct Bluesky login for @${testBot.handle} ===`)

  if (!testBot.app_password) {
    console.error('app_password is null! Cannot authenticate.')
    return
  }

  const agent = new BskyAgent({ service: 'https://bsky.social' })

  try {
    const response = await agent.login({
      identifier: testBot.handle,
      password: testBot.app_password
    })
    console.log('LOGIN SUCCESS!')
    console.log(`  DID: ${response.data.did}`)
    console.log(`  Handle: ${response.data.handle}`)
    console.log(`  AccessJwt: ${response.data.accessJwt.slice(0, 20)}...`)
    console.log(`  RefreshJwt: ${response.data.refreshJwt.slice(0, 20)}...`)

    // 3. Persist the session back
    console.log('\n=== Step 3: Persisting session back to DB ===')
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
        did: response.data.did,
        updated_at: new Date().toISOString(),
      })
      .eq('pet_id', testBot.pet_id)

    if (updateErr) {
      console.error('Session persist FAILED:', updateErr)
    } else {
      console.log('Session persisted successfully!')
    }

    // 4. Verify we can post (dry run - just fetch profile)
    console.log('\n=== Step 4: Verify session works ===')
    const profile = await agent.getProfile({ actor: response.data.did })
    console.log(`Profile verified: @${profile.data.handle} (${profile.data.displayName})`)

  } catch (error) {
    console.error('LOGIN FAILED:', error)
    if (error instanceof Error) {
      console.error('Message:', error.message)
      console.error('Stack:', error.stack?.split('\n').slice(0, 5).join('\n'))
    }
  }
}

main().catch(console.error)

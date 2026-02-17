/**
 * Fix bots with broken (wrongly-encrypted) app passwords.
 * Resets PDS password, creates new app password, re-encrypts, and updates bot config.
 *
 * Usage: npx tsx scripts/fix-broken-passwords.ts
 */

import { readFileSync } from 'node:fs'
import { AtpAgent } from '@atproto/api'
import { createClient } from '@supabase/supabase-js'

// ─── Env Loading ────────────────────────────────
function loadEnv(path: string): void {
  try {
    const content = readFileSync(path, 'utf-8')
    for (const line of content.split('\n')) {
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
  } catch { /* ignore missing files */ }
}

loadEnv('/Volumes/Work/memepet-agent-live/.env.local')
loadEnv('/Volumes/Work/ig-memepet-pipeline/.env.local')

import { decrypt, isEncrypted } from '../lib/utils/encrypt.js'

const PDS_URL = process.env.PDS_URL ?? 'https://pds.0.space'
const PDS_ADMIN_PASSWORD = process.env.PDS_ADMIN_PASSWORD ?? ''

const sb = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

// ─── Find broken bots ───────────────────────────
async function findBrokenBots(): Promise<Array<{ handle: string; did: string; petId: string }>> {
  const { data } = await sb
    .from('bluesky_bot_config')
    .select('pet_id, handle, did, app_password')
    .eq('is_active', true)

  const broken: Array<{ handle: string; did: string; petId: string }> = []
  for (const row of data ?? []) {
    if (!isEncrypted(row.app_password)) continue
    try {
      decrypt(row.app_password)
    } catch {
      broken.push({ handle: row.handle, did: row.did, petId: row.pet_id })
    }
  }
  return broken
}

// ─── Fix a single bot ───────────────────────────
async function fixBot(bot: { handle: string; did: string; petId: string }): Promise<boolean> {
  console.log(`\n--- ${bot.handle} ---`)

  // Step 1: Reset password via PDS admin
  console.log('  1. Resetting PDS password...')
  const tempPassword = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

  const resetRes = await fetch(
    `${PDS_URL}/xrpc/com.atproto.admin.updateAccountPassword`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`admin:${PDS_ADMIN_PASSWORD}`).toString('base64')}`,
      },
      body: JSON.stringify({ did: bot.did, password: tempPassword }),
    }
  )

  if (!resetRes.ok) {
    const err = await resetRes.text()
    console.log(`  FAIL: password reset — ${err}`)
    return false
  }
  console.log('  OK: password reset')

  // Step 2: Login with temp password
  console.log('  2. Logging in...')
  const agent = new AtpAgent({ service: PDS_URL })
  try {
    await agent.login({ identifier: bot.handle, password: tempPassword })
  } catch (err) {
    console.log(`  FAIL: login — ${(err as Error).message}`)
    return false
  }
  console.log('  OK: logged in')

  // Step 3: Create app password
  console.log('  3. Creating app password...')
  let appPassword: string
  try {
    const result = await agent.api.com.atproto.server.createAppPassword({
      name: `memepet-agent-${Date.now()}`,
    })
    appPassword = result.data.password
  } catch (err) {
    console.log(`  FAIL: create app password — ${(err as Error).message}`)
    return false
  }
  console.log('  OK: app password created')

  // Step 4: Encrypt with current key
  console.log('  4. Encrypting...')
  let storedPassword = appPassword
  try {
    const { encryptSecret } = await import('../lib/utils/encrypt.js')
    storedPassword = encryptSecret(appPassword)
    console.log('  OK: encrypted')
  } catch {
    console.log('  WARN: encryption failed, storing plaintext')
  }

  // Step 5: Update bot config
  console.log('  5. Updating bot config...')
  const { error } = await sb
    .from('bluesky_bot_config')
    .update({ app_password: storedPassword })
    .eq('pet_id', bot.petId)

  if (error) {
    console.log(`  FAIL: update — ${error.message}`)
    return false
  }
  console.log('  OK: bot config updated')

  // Step 6: Verify login with new app password
  console.log('  6. Verifying login...')
  try {
    const verifyAgent = new AtpAgent({ service: PDS_URL })
    await verifyAgent.login({ identifier: bot.handle, password: appPassword })
    console.log('  OK: login verified')
  } catch (err) {
    console.log(`  WARN: verification login failed — ${(err as Error).message}`)
  }

  // Step 7: Refresh handle to fix handle.invalid
  console.log('  7. Refreshing handle...')
  try {
    await agent.com.atproto.identity.updateHandle({ handle: bot.handle })
    console.log('  OK: handle refreshed')
  } catch (err) {
    console.log(`  WARN: handle refresh failed — ${(err as Error).message}`)
  }

  return true
}

// ─── Main ───────────────────────────────────────
async function main() {
  console.log('=== Fix Broken Bot Passwords ===\n')

  if (!PDS_ADMIN_PASSWORD) {
    console.error('PDS_ADMIN_PASSWORD not set')
    process.exit(1)
  }

  const broken = await findBrokenBots()
  console.log(`Found ${broken.length} bots with broken passwords:`)
  for (const b of broken) {
    console.log(`  ${b.handle} (${b.did})`)
  }

  let fixed = 0
  let failed = 0
  for (const bot of broken) {
    const success = await fixBot(bot)
    if (success) fixed++
    else failed++
  }

  console.log('\n=== Summary ===')
  console.log(`  Fixed: ${fixed}`)
  console.log(`  Failed: ${failed}`)
}

main().catch(console.error)

/**
 * Force trigger proactive posting for 3 bots, bypassing the posting rhythm engine.
 * Sends QStash messages directly to the workflow endpoint.
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

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

const QSTASH_TOKEN = process.env.QSTASH_TOKEN || ''
const WORKFLOW_URL = 'https://memepet-agent.0.space/api/v1/workflows/bluesky-agent'

async function main() {
  // Get 3 active bots
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle')
    .eq('is_active', true)
    .limit(3)

  if (!bots?.length) {
    console.log('No active bots')
    return
  }

  console.log('Triggering proactive workflows for:')
  for (const bot of bots) {
    console.log(`  @${bot.handle} (pet_id: ${bot.pet_id})`)
  }

  // Trigger each bot's proactive workflow via QStash
  for (const bot of bots) {
    const body = JSON.stringify({
      petId: bot.pet_id,
      mode: 'proactive',
      activityType: 'proactive_post',
    })

    const res = await fetch('https://qstash.upstash.io/v2/publish/' + WORKFLOW_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${QSTASH_TOKEN}`,
        'Content-Type': 'application/json',
        'Upstash-Forward-x-force-trigger': 'true',
      },
      body,
    })

    const result = await res.json()
    console.log(`  @${bot.handle}: ${res.ok ? 'OK' : 'FAIL'} — messageId: ${(result as any).messageId ?? 'none'}`)
  }

  console.log('\nTriggered! Wait ~30-60s for posts to appear, then run check-new-catchphrases.ts')
}

main().catch(console.error)

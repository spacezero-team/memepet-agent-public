/**
 * Verify the meme personality JSONB key fix.
 * Checks that buildPersonalityFromRow extracts real data, not fallbacks.
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
import { buildPersonalityFromRow } from '../lib/agent/pet-personality-builder.js'

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

async function main() {
  // Get 3 active pets with meme data
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle')
    .eq('is_active', true)
    .limit(3)

  if (!bots?.length) {
    console.log('No active bots found')
    return
  }

  const petIds = bots.map(b => b.pet_id)
  const { data: pets } = await supabase
    .from('pet')
    .select('id, name, personality_type, psyche, meme')
    .in('id', petIds)

  let allPass = true

  for (const pet of (pets ?? [])) {
    const handle = bots.find(b => b.pet_id === pet.id)?.handle ?? '?'
    console.log(`\n=== @${handle} (${pet.name}) ===`)

    // Show raw meme structure keys
    const meme = (pet.meme ?? {}) as Record<string, unknown>
    console.log(`Raw meme keys: ${Object.keys(meme).join(', ')}`)
    const memePersonality = (meme.memePersonality ?? null) as Record<string, unknown> | null
    console.log(`meme.memePersonality exists: ${!!memePersonality}`)
    if (memePersonality) {
      console.log(`  memePersonality keys: ${Object.keys(memePersonality).join(', ')}`)
    }

    // Build personality with the fixed function
    const personality = buildPersonalityFromRow({
      personality_type: pet.personality_type,
      psyche: pet.psyche as Record<string, unknown> | null,
      meme: pet.meme as Record<string, unknown> | null,
    })

    // Check each field
    const checks = [
      { name: 'catchphrase', value: personality.memeVoice.catchphrase, bad: '' },
      { name: 'humorStyle', value: personality.memeVoice.humorStyle, bad: 'general' },
      { name: 'reactionPatterns', value: personality.memeVoice.reactionPatterns, bad: [] },
      { name: 'topicAffinity', value: personality.postingConfig.topicAffinity, bad: [] },
      { name: 'postingStyle', value: personality.memeVoice.postingStyle, bad: 'casual' },
    ]

    for (const check of checks) {
      const isEmpty = Array.isArray(check.value) ? check.value.length === 0 : check.value === check.bad
      const status = isEmpty ? 'FAIL (fallback)' : 'PASS'
      const display = Array.isArray(check.value)
        ? `[${check.value.slice(0, 3).join(', ')}${check.value.length > 3 ? '...' : ''}]`
        : `"${String(check.value).slice(0, 50)}"`
      console.log(`  ${status.padEnd(16)} ${check.name}: ${display}`)
      if (isEmpty) allPass = false
    }
  }

  console.log(`\n${'='.repeat(40)}`)
  console.log(allPass ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED — see above')
}

main().catch(console.error)

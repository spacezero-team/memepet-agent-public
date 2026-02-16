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
  const cutoff = '2026-02-15T17:55:00+00:00'
  const { data, error } = await supabase
    .from('bluesky_post_log')
    .select('id, pet_id, activity_type, content, metadata, created_at')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(30)

  console.log(`=== Activity after ${cutoff} ===`)
  console.log(`Count: ${(data ?? []).length}`)
  if (error) console.log(`Error: ${error.message}`)

  for (const a of (data ?? [])) {
    const time = a.created_at?.slice(11, 19)
    console.log(`[${time}] ${a.activity_type} | ${(a.content ?? '').slice(0, 80)}`)
    const meta = a.metadata as Record<string, unknown> | null
    if (meta?.error || meta?.reason) {
      console.log(`  META: ${JSON.stringify(meta).slice(0, 200)}`)
    }
  }

  if ((data ?? []).length === 0) {
    console.log('No new activity yet — checking schedule states...')
    const { data: bots } = await supabase
      .from('bluesky_bot_config')
      .select('handle, schedule_state, session_data')
      .eq('is_active', true)
      .limit(3)

    for (const b of (bots ?? [])) {
      const state = b.schedule_state as Record<string, unknown> | null
      const hasSession = !!b.session_data
      console.log(`@${b.handle}: session=${hasSession ? 'YES' : 'NO'} state=${JSON.stringify(state).slice(0, 100)}`)
    }
  }
}

main().catch(console.error)

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
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

async function main() {
  // 1. Check ALL activity after 17:45 UTC Feb 15
  const cutoff = '2026-02-15T17:45:00+00:00'
  const { data: after, error: err1 } = await supabase
    .from('bluesky_post_log')
    .select('id, pet_id, activity_type, content, metadata, created_at')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(50)

  console.log(`=== Activity AFTER ${cutoff} ===`)
  console.log(`Count: ${(after ?? []).length}`)
  for (const a of (after ?? [])) {
    const time = a.created_at?.slice(0, 19)
    console.log(`[${time}] ${a.activity_type} | ${(a.content ?? '').slice(0, 60)}`)
    if (a.metadata) {
      const meta = a.metadata as Record<string, unknown>
      if (meta.error || meta.reason) {
        console.log(`  META: ${JSON.stringify(meta).slice(0, 200)}`)
      }
    }
  }

  // 2. Check schedule_state of all bots
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, is_active, schedule_state, chronotype, utc_offset_hours')
    .eq('is_active', true)

  console.log('\n=== Bot Schedule States ===')
  for (const bot of (bots ?? [])) {
    const state = bot.schedule_state as Record<string, unknown> | null
    const lastPost = state?.lastPostTime as string | undefined
    const postsToday = state?.postsToday as number | undefined
    const dailyLimit = state?.dailyLimit as number | undefined
    const nextEligible = state?.nextEligibleTime as string | undefined
    console.log(`@${bot.handle} [${bot.chronotype}] UTC${bot.utc_offset_hours >= 0 ? '+' : ''}${bot.utc_offset_hours}`)
    console.log(`  lastPost: ${lastPost ?? 'none'} | postsToday: ${postsToday ?? 0}/${dailyLimit ?? '?'} | nextEligible: ${nextEligible ?? 'none'}`)
    if (state) {
      const keys = Object.keys(state)
      console.log(`  state keys: ${keys.join(', ')}`)
    }
  }

  // 3. Check if sessions are valid
  console.log('\n=== Session Validity ===')
  const { data: sessions } = await supabase
    .from('bluesky_bot_config')
    .select('handle, session_data')
    .eq('is_active', true)
    .limit(3)

  for (const s of (sessions ?? [])) {
    const session = s.session_data as Record<string, unknown> | null
    if (session?.accessJwt) {
      const jwt = String(session.accessJwt)
      try {
        const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString())
        const exp = new Date(payload.exp * 1000)
        const now = new Date()
        console.log(`@${s.handle}: JWT expires ${exp.toISOString()} (${exp > now ? 'VALID' : 'EXPIRED'})`)
      } catch {
        console.log(`@${s.handle}: JWT parse failed`)
      }
    } else {
      console.log(`@${s.handle}: no session`)
    }
  }

  // 4. Count total posts per day
  console.log('\n=== Posts Per Day (last 3 days) ===')
  for (let d = 0; d < 3; d++) {
    const start = new Date(Date.now() - (d + 1) * 86400000).toISOString()
    const end = new Date(Date.now() - d * 86400000).toISOString()
    const { count } = await supabase
      .from('bluesky_post_log')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', start)
      .lt('created_at', end)
    console.log(`${start.slice(0, 10)}: ${count ?? 0} entries`)
  }
}

main().catch(console.error)

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
  // Last 20 posts ordered by time
  const { data: posts, error } = await supabase
    .from('bluesky_post_log')
    .select('id, pet_id, activity_type, content, created_at, metadata')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.log('ERROR:', error.message)
    return
  }

  console.log('=== Last 20 Activity Logs ===\n')
  for (const p of (posts ?? [])) {
    const time = p.created_at?.slice(0, 19) ?? ''
    const content = (p.content ?? '').slice(0, 80)
    const meta = p.metadata as any
    const err = meta?.error || meta?.reason || ''
    console.log(`[${time}] ${p.activity_type} | pet:${p.pet_id?.slice(0,8)} | ${content}`)
    if (err) console.log(`  ERROR: ${JSON.stringify(err).slice(0, 200)}`)
  }

  // Count by activity type in last 12 hours
  const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await supabase
    .from('bluesky_post_log')
    .select('activity_type')
    .gte('created_at', twelveHoursAgo)

  const counts: Record<string, number> = {}
  for (const r of (recent ?? [])) {
    counts[r.activity_type] = (counts[r.activity_type] || 0) + 1
  }
  console.log('\n=== Last 12 Hours Activity Count ===')
  console.log(counts)
  console.log('Total:', (recent ?? []).length)

  // Check for errors
  const { data: errors } = await supabase
    .from('bluesky_post_log')
    .select('activity_type, content, metadata, created_at')
    .or('activity_type.ilike.%error%,activity_type.ilike.%fail%,activity_type.ilike.%skip%')
    .order('created_at', { ascending: false })
    .limit(10)

  console.log('\n=== Recent Errors/Skips ===')
  for (const e of (errors ?? [])) {
    const time = e.created_at?.slice(0, 19) ?? ''
    console.log(`[${time}] ${e.activity_type}: ${JSON.stringify(e.metadata).slice(0, 200)}`)
  }
}

main().catch(console.error)

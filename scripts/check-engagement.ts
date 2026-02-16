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
  // Check engagement activity
  const { data: engagements } = await supabase
    .from('bluesky_post_log')
    .select('id, pet_id, activity_type, content, created_at')
    .in('activity_type', ['engagement_like', 'engagement_comment', 'engagement_quote', 'engagement_skipped'])
    .order('created_at', { ascending: false })
    .limit(20)

  console.log('=== Engagement Activity ===')
  console.log('Total:', (engagements ?? []).length)
  for (const e of (engagements ?? [])) {
    console.log(`  ${e.activity_type} | ${e.created_at} | ${(e.content ?? '').slice(0, 80)}`)
  }

  // Check total activity types distribution
  const { data: allTypes } = await supabase
    .from('bluesky_post_log')
    .select('activity_type')

  const counts = new Map<string, number>()
  for (const row of (allTypes ?? [])) {
    const t = row.activity_type
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  console.log('\n=== Activity Type Distribution ===')
  for (const [type, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`)
  }
}

main().catch(console.error)

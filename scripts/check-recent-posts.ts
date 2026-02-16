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
  // Get recent posts from last 5 minutes
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

  const { data: posts, error } = await supabase
    .from('bluesky_post_log')
    .select('pet_id, activity_type, content, post_uri, metadata, created_at')
    .gte('created_at', fiveMinAgo)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    console.error('Error:', error)
    return
  }

  // Also get bot handles for display
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle')

  const handleMap = new Map((bots ?? []).map((b: any) => [b.pet_id, b.handle]))

  console.log(`=== Recent posts (last 5 min) ===\n`)
  for (const post of (posts ?? [])) {
    const handle = handleMap.get(post.pet_id) ?? 'unknown'
    const rkey = post.post_uri?.split('/').pop() ?? ''
    const url = rkey ? `https://bsky.app/profile/${handle}/post/${rkey}` : '(no URI)'

    console.log(`@${handle} [${post.activity_type}]`)
    console.log(`  "${(post.content ?? '').slice(0, 120)}"`)
    console.log(`  URL: ${url}`)
    console.log(`  Time: ${post.created_at}`)
    if (post.metadata) {
      const meta = typeof post.metadata === 'string' ? JSON.parse(post.metadata) : post.metadata
      if (meta.mood) console.log(`  Mood: ${meta.mood}`)
      if (meta.target_handle) console.log(`  Target: @${meta.target_handle}`)
      if (meta.interaction_type) console.log(`  Interaction: ${meta.interaction_type}`)
    }
    console.log()
  }

  if ((posts ?? []).length === 0) {
    console.log('No posts in the last 5 minutes. Checking last 30 minutes...\n')

    const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    const { data: olderPosts } = await supabase
      .from('bluesky_post_log')
      .select('pet_id, activity_type, content, post_uri, metadata, created_at')
      .gte('created_at', thirtyMinAgo)
      .order('created_at', { ascending: false })
      .limit(10)

    for (const post of (olderPosts ?? [])) {
      const handle = handleMap.get(post.pet_id) ?? 'unknown'
      const rkey = post.bluesky_uri?.split('/').pop() ?? ''
      const url = post.bluesky_url || `https://bsky.app/profile/${handle}/post/${rkey}`

      console.log(`@${handle} [${post.activity_type}]`)
      console.log(`  "${(post.content ?? '').slice(0, 120)}"`)
      console.log(`  URL: ${url}`)
      console.log(`  Time: ${post.created_at}`)
      console.log()
    }
  }
}

main().catch(console.error)

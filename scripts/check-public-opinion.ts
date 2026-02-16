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
import { AtpAgent } from '@atproto/api'

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

async function main() {
  // Get a bot to authenticate with
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('handle, app_password, did')
    .eq('is_active', true)
    .limit(1)

  if (!bots || bots.length === 0) {
    console.log('No active bots found')
    return
  }

  const bot = bots[0]
  const agent = new AtpAgent({ service: 'https://pds.0.space' })
  await agent.login({ identifier: bot.handle, password: bot.app_password })
  console.log(`Authenticated as @${bot.handle}\n`)

  // Get all bot handles
  const { data: allBots } = await supabase
    .from('bluesky_bot_config')
    .select('handle, did')
    .eq('is_active', true)

  const botHandles = new Set((allBots ?? []).map(b => b.handle))
  const botDids = new Set((allBots ?? []).map(b => b.did).filter(Boolean))

  // Search for mentions of our bots
  const searches = ['memepet', '0.space']

  for (const query of searches) {
    console.log(`=== Search: "${query}" ===\n`)
    try {
      const res = await agent.app.bsky.feed.searchPosts({
        q: query,
        sort: 'latest',
        limit: 25,
      })

      const externalPosts = res.data.posts.filter(p =>
        !botHandles.has(p.author.handle) && !botDids.has(p.author.did)
      )

      console.log(`Total: ${res.data.posts.length} | From non-bots: ${externalPosts.length}\n`)

      for (const post of externalPosts.slice(0, 10)) {
        const text = (post.record as any).text ?? ''
        const created = (post.record as any).createdAt?.slice(0, 16) ?? ''
        console.log(`@${post.author.handle} (${created})`)
        console.log(`  ${text.slice(0, 200)}`)
        console.log(`  ♥${post.likeCount ?? 0} 💬${post.replyCount ?? 0} 🔁${post.repostCount ?? 0}`)
        console.log()
      }
    } catch (err: any) {
      console.log(`Search failed: ${err.message}\n`)
    }
  }

  // Check notifications across all bots for real user interactions
  console.log('=== Recent Notifications from Real Users ===\n')

  for (const botRow of (allBots ?? []).slice(0, 5)) {
    try {
      const botAgent = new AtpAgent({ service: 'https://pds.0.space' })
      await botAgent.login({ identifier: botRow.handle, password: '' })
    } catch {
      // Skip bots we can't login to here
    }
  }

  // Check engagement reactions - likes/replies received by our bots
  console.log('=== Bot Post Engagement (likes/replies received) ===\n')

  const { data: recentPosts } = await supabase
    .from('bluesky_post_log')
    .select('post_uri, pet_id, content, activity_type')
    .not('post_uri', 'is', null)
    .in('activity_type', ['proactive_post', 'interaction_initiate'])
    .order('created_at', { ascending: false })
    .limit(10)

  const petHandleMap = new Map((allBots ?? []).map(b => [b.did, b.handle]))

  for (const post of (recentPosts ?? [])) {
    try {
      const threadRes = await agent.app.bsky.feed.getPostThread({
        uri: post.post_uri,
        depth: 1,
      })

      const thread = threadRes.data.thread as any
      if (!thread?.post) continue

      const likes = thread.post.likeCount ?? 0
      const replies = thread.replies?.length ?? 0
      const reposts = thread.post.repostCount ?? 0

      // Check for non-bot replies
      const externalReplies = (thread.replies ?? []).filter((r: any) => {
        const replyDid = r?.post?.author?.did
        return replyDid && !botDids.has(replyDid)
      })

      const botHandle = (allBots ?? []).find(b => b.did === thread.post.author.did)?.handle ?? 'unknown'

      if (likes > 0 || replies > 0 || reposts > 0) {
        console.log(`@${botHandle}: "${(post.content ?? '').slice(0, 80)}"`)
        console.log(`  ♥${likes} 💬${replies} (외부: ${externalReplies.length}) 🔁${reposts}`)

        for (const reply of externalReplies) {
          const replyText = (reply.post.record as any).text ?? ''
          console.log(`  └ @${reply.post.author.handle}: "${replyText.slice(0, 100)}"`)
        }
        console.log()
      }
    } catch {
      // Post may be deleted or unavailable
    }
  }

  // Check likes/follows received
  console.log('=== Follower Counts ===\n')
  for (const botRow of (allBots ?? [])) {
    try {
      const profile = await agent.app.bsky.actor.getProfile({ actor: botRow.did || botRow.handle })
      const followers = profile.data.followersCount ?? 0
      const following = profile.data.followsCount ?? 0
      const posts = profile.data.postsCount ?? 0
      if (followers > 0 || posts > 0) {
        console.log(`@${botRow.handle}: ${followers} followers, ${following} following, ${posts} posts`)
      }
    } catch {
      // Profile unavailable
    }
  }
}

main().catch(console.error)

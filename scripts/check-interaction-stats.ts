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
  // Get all bot DIDs
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, did')
    .eq('is_active', true)

  const botDids = new Set((bots ?? []).map(b => b.did).filter(Boolean))
  const botPetIds = new Set((bots ?? []).map(b => b.pet_id))

  // Get all post logs
  const { data: allLogs } = await supabase
    .from('bluesky_post_log')
    .select('pet_id, activity_type, content, metadata, created_at')
    .order('created_at', { ascending: false })

  const logs = allLogs ?? []

  // === Outbound: Bots engaging with OTHER users ===
  const engagementLikes = logs.filter(l => l.activity_type === 'engagement_like')
  const engagementComments = logs.filter(l => l.activity_type === 'engagement_comment')
  const engagementQuotes = logs.filter(l => l.activity_type === 'engagement_quote')

  // === Outbound: Bot-to-bot interactions ===
  const interactionInitiate = logs.filter(l => l.activity_type === 'interaction_initiate')

  // === Inbound: Others mentioning/replying to bots ===
  const reactiveReplies = logs.filter(l => l.activity_type === 'reactive_reply')

  // Separate reactive replies: from other bots vs from real users
  const reactiveFromBots = reactiveReplies.filter(l => {
    const meta = l.metadata as any
    return meta?.inReplyToAuthorDid && botDids.has(meta.inReplyToAuthorDid)
  })
  const reactiveFromUsers = reactiveReplies.filter(l => {
    const meta = l.metadata as any
    return meta?.inReplyToAuthorDid && !botDids.has(meta.inReplyToAuthorDid)
  })
  const reactiveUnknown = reactiveReplies.filter(l => {
    const meta = l.metadata as any
    return !meta?.inReplyToAuthorDid
  })

  console.log('=== MemePet Interaction Stats ===\n')

  console.log('--- Outbound: Bots → Other Users (engagement) ---')
  console.log(`  Likes:    ${engagementLikes.length}`)
  console.log(`  Comments: ${engagementComments.length}`)
  console.log(`  Quotes:   ${engagementQuotes.length}`)
  console.log(`  TOTAL:    ${engagementLikes.length + engagementComments.length + engagementQuotes.length}`)

  console.log('\n--- Outbound: Bot → Bot (interactions) ---')
  console.log(`  Initiated: ${interactionInitiate.length}`)

  console.log('\n--- Inbound: Others → Bots (reactive replies) ---')
  console.log(`  From real users: ${reactiveFromUsers.length}`)
  console.log(`  From other bots: ${reactiveFromBots.length}`)
  console.log(`  Unknown source:  ${reactiveUnknown.length}`)
  console.log(`  TOTAL replies:   ${reactiveReplies.length}`)

  // Show unique users who talked to bots
  const uniqueUserDids = new Set<string>()
  const uniqueUserHandles = new Map<string, string>()
  for (const l of reactiveFromUsers) {
    const meta = l.metadata as any
    if (meta?.inReplyToAuthorDid) {
      uniqueUserDids.add(meta.inReplyToAuthorDid)
      if (meta.inReplyToAuthorHandle) {
        uniqueUserHandles.set(meta.inReplyToAuthorDid, meta.inReplyToAuthorHandle)
      }
    }
  }

  // Also check engagement targets
  const uniqueEngagedUsers = new Set<string>()
  for (const l of [...engagementLikes, ...engagementComments, ...engagementQuotes]) {
    const meta = l.metadata as any
    if (meta?.engagedAuthorDid && !botDids.has(meta.engagedAuthorDid)) {
      uniqueEngagedUsers.add(meta.engagedAuthorDid)
    }
  }

  console.log(`\n--- Unique Users ---`)
  console.log(`  Users bots engaged with: ${uniqueEngagedUsers.size}`)
  console.log(`  Users who talked to bots: ${uniqueUserDids.size}`)
  if (uniqueUserHandles.size > 0) {
    console.log('  User handles:')
    for (const [, handle] of uniqueUserHandles) {
      console.log(`    @${handle}`)
    }
  }

  // Recent engagement activity (last 24h)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const recentEngagement = logs.filter(l =>
    l.created_at >= oneDayAgo &&
    ['engagement_like', 'engagement_comment', 'engagement_quote'].includes(l.activity_type)
  )
  const recentSkipped = logs.filter(l =>
    l.created_at >= oneDayAgo && l.activity_type === 'engagement_skipped'
  )

  console.log(`\n--- Last 24h ---`)
  console.log(`  Engagement actions: ${recentEngagement.length}`)
  console.log(`  Engagement skipped: ${recentSkipped.length}`)

  // Proactive posts
  const proactivePosts = logs.filter(l => l.activity_type === 'proactive_post')
  console.log(`\n--- Total Activity ---`)
  console.log(`  Proactive posts:     ${proactivePosts.length}`)
  console.log(`  Engagement (outbound): ${engagementLikes.length + engagementComments.length + engagementQuotes.length}`)
  console.log(`  Interactions (bot↔bot): ${interactionInitiate.length}`)
  console.log(`  Reactive replies:      ${reactiveReplies.length}`)
  console.log(`  GRAND TOTAL:           ${logs.length}`)
}

main().catch(console.error)

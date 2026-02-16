import { readFileSync } from 'node:fs'

// --- Load .env.local ---
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

// --- Time helpers ---
const now = Date.now()
const thirtyMinAgo = new Date(now - 30 * 60 * 1000).toISOString()
const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000).toISOString()

// --- Result tracking ---
interface CheckResult {
  readonly name: string
  readonly status: 'PASS' | 'FAIL' | 'WARN'
  readonly detail: string
}

const results: CheckResult[] = []

function pass(name: string, detail: string): void {
  results.push({ name, status: 'PASS', detail })
}

function fail(name: string, detail: string): void {
  results.push({ name, status: 'FAIL', detail })
}

function warn(name: string, detail: string): void {
  results.push({ name, status: 'WARN', detail })
}

// --- Bot handle map ---
async function loadBotHandles(): Promise<Map<string, string>> {
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle')

  return new Map((bots ?? []).map((b: { pet_id: string; handle: string }) => [b.pet_id, b.handle]))
}

// --- Check 1: Proactive Posting ---
async function checkProactivePosts(handleMap: Map<string, string>): Promise<void> {
  const checkName = '1. Proactive Posting (last 30 min)'

  const { data: posts, error } = await supabase
    .from('bluesky_post_log')
    .select('pet_id, content, post_uri, created_at')
    .eq('activity_type', 'proactive_post')
    .gte('created_at', thirtyMinAgo)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    fail(checkName, `Query error: ${error.message}`)
    return
  }

  const count = (posts ?? []).length

  if (count > 0) {
    pass(checkName, `${count} proactive post(s) in last 30 min`)
    const sample = posts![0]
    const handle = handleMap.get(sample.pet_id) ?? 'unknown'
    console.log(`   Sample: @${handle} -- "${(sample.content ?? '').slice(0, 120)}"`)
    console.log(`   Time:   ${sample.created_at}`)
  } else {
    fail(checkName, 'No proactive posts in last 30 min')
  }
}

// --- Check 2: Reactive Replies ---
async function checkReactiveReplies(handleMap: Map<string, string>): Promise<void> {
  const checkName = '2. Reactive Replies (last 30 min)'

  const { data: replies, error } = await supabase
    .from('bluesky_post_log')
    .select('pet_id, content, post_uri, metadata, created_at')
    .eq('activity_type', 'reactive_reply')
    .gte('created_at', thirtyMinAgo)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    fail(checkName, `Query error: ${error.message}`)
    return
  }

  const count = (replies ?? []).length

  if (count > 0) {
    pass(checkName, `${count} reactive reply(ies) in last 30 min`)
    const sample = replies![0]
    const handle = handleMap.get(sample.pet_id) ?? 'unknown'
    console.log(`   Sample: @${handle} -- "${(sample.content ?? '').slice(0, 120)}"`)
    console.log(`   Time:   ${sample.created_at}`)
  } else {
    warn(checkName, 'No reactive replies in last 30 min (may be normal if no mentions)')
  }
}

// --- Check 3: Inter-pet Interactions ---
async function checkInterPetInteractions(handleMap: Map<string, string>): Promise<void> {
  const checkName = '3. Inter-Pet Interactions (last 2 hours)'

  const { data: interactions, error } = await supabase
    .from('bluesky_post_log')
    .select('pet_id, activity_type, content, metadata, created_at')
    .in('activity_type', ['interaction_initiate', 'interaction_reply'])
    .gte('created_at', twoHoursAgo)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    fail(checkName, `Query error: ${error.message}`)
    return
  }

  const count = (interactions ?? []).length

  if (count > 0) {
    pass(checkName, `${count} interaction(s) in last 2 hours`)

    // Extract pet pairs
    const pairs = new Set<string>()
    for (const row of interactions ?? []) {
      const handle = handleMap.get(row.pet_id) ?? row.pet_id
      const meta = (typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata) as Record<string, unknown> | null
      const targetHandle = (meta?.target_handle ?? meta?.targetHandle ?? 'unknown') as string
      const pairKey = [handle, targetHandle].sort().join(' <-> ')
      pairs.add(pairKey)
    }

    console.log(`   Pet pairs that interacted:`)
    for (const pair of pairs) {
      console.log(`     ${pair}`)
    }
  } else {
    warn(checkName, 'No inter-pet interactions in last 2 hours')
  }
}

// --- Check 4: Engagement (Likes) ---
async function checkEngagementLikes(): Promise<void> {
  const checkName = '4. Engagement Likes (last 30 min)'

  const { data: likes, error } = await supabase
    .from('bluesky_post_log')
    .select('pet_id, created_at')
    .eq('activity_type', 'engagement_like')
    .gte('created_at', thirtyMinAgo)
    .limit(50)

  if (error) {
    fail(checkName, `Query error: ${error.message}`)
    return
  }

  const count = (likes ?? []).length

  if (count > 0) {
    pass(checkName, `${count} engagement like(s) in last 30 min`)
  } else {
    warn(checkName, 'No engagement likes in last 30 min')
  }
}

// --- Check 5: Reply Skipped (Rate Limiting) ---
async function checkReplySkipped(): Promise<void> {
  const checkName = '5. Reply Skipped (rate limiting)'

  const { data: skipped, error } = await supabase
    .from('bluesky_post_log')
    .select('pet_id, content, metadata, created_at')
    .eq('activity_type', 'reply_skipped')
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) {
    fail(checkName, `Query error: ${error.message}`)
    return
  }

  const count = (skipped ?? []).length

  if (count > 0) {
    pass(checkName, `${count} reply_skipped record(s) found -- rate limiting is working`)
    const sample = skipped![0]
    console.log(`   Latest skip time: ${sample.created_at}`)
    const meta = (typeof sample.metadata === 'string' ? JSON.parse(sample.metadata) : sample.metadata) as Record<string, unknown> | null
    if (meta?.reason) {
      console.log(`   Reason: ${meta.reason}`)
    }
  } else {
    // Also check engagement_skipped as an alternative activity type
    const { data: engSkipped } = await supabase
      .from('bluesky_post_log')
      .select('pet_id, created_at')
      .eq('activity_type', 'engagement_skipped')
      .order('created_at', { ascending: false })
      .limit(5)

    const engCount = (engSkipped ?? []).length
    if (engCount > 0) {
      pass(checkName, `No reply_skipped, but ${engCount} engagement_skipped found -- some rate limiting active`)
    } else {
      warn(checkName, 'No reply_skipped or engagement_skipped records found')
    }
  }
}

// --- Check 6: Activity Diversity ---
async function checkActivityDiversity(handleMap: Map<string, string>): Promise<void> {
  const checkName = '6. Activity Diversity (last 2 hours)'

  const { data: activity, error } = await supabase
    .from('bluesky_post_log')
    .select('pet_id, activity_type')
    .gte('created_at', twoHoursAgo)

  if (error) {
    fail(checkName, `Query error: ${error.message}`)
    return
  }

  const petIds = new Set((activity ?? []).map(a => a.pet_id))
  const petHandles = [...petIds].map(pid => handleMap.get(pid) ?? pid)

  if (petIds.size >= 3) {
    pass(checkName, `${petIds.size} distinct bot(s) active: ${petHandles.join(', ')}`)
  } else if (petIds.size >= 2) {
    warn(checkName, `Only ${petIds.size} bot(s) active (expected 3): ${petHandles.join(', ')}`)
  } else if (petIds.size === 1) {
    fail(checkName, `Only 1 bot active: ${petHandles.join(', ')}`)
  } else {
    fail(checkName, 'No bot activity in last 2 hours')
  }

  // Activity type breakdown per bot
  if (petIds.size > 0) {
    const perBot = new Map<string, Map<string, number>>()
    for (const row of activity ?? []) {
      const handle = handleMap.get(row.pet_id) ?? row.pet_id
      if (!perBot.has(handle)) perBot.set(handle, new Map())
      const counts = perBot.get(handle)!
      counts.set(row.activity_type, (counts.get(row.activity_type) ?? 0) + 1)
    }

    console.log(`   Per-bot breakdown:`)
    for (const [handle, counts] of perBot) {
      const parts = [...counts.entries()].map(([t, c]) => `${t}=${c}`).join(', ')
      console.log(`     @${handle}: ${parts}`)
    }
  }
}

// --- Check 7: Post Content Quality ---
async function checkPostContentQuality(handleMap: Map<string, string>): Promise<void> {
  const checkName = '7. Post Content Quality'

  // Get a broader set to pick random samples from
  const { data: posts, error } = await supabase
    .from('bluesky_post_log')
    .select('pet_id, content, metadata, created_at')
    .eq('activity_type', 'proactive_post')
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) {
    fail(checkName, `Query error: ${error.message}`)
    return
  }

  if ((posts ?? []).length < 3) {
    warn(checkName, `Only ${(posts ?? []).length} proactive posts found (need 3 for quality check)`)
    for (const p of posts ?? []) {
      const handle = handleMap.get(p.pet_id) ?? 'unknown'
      console.log(`   @${handle}: "${(p.content ?? '').slice(0, 150)}"`)
    }
    return
  }

  // Pick 3 random samples
  const shuffled = [...posts!].sort(() => Math.random() - 0.5)
  const samples = shuffled.slice(0, 3)

  // Basic quality heuristics
  const genericPhrases = [
    'hello world',
    'test post',
    'lorem ipsum',
    'undefined',
    'null',
    '[object object]',
  ]

  let qualityPasses = 0
  console.log(`   3 random proactive posts:`)
  for (const sample of samples) {
    const handle = handleMap.get(sample.pet_id) ?? 'unknown'
    const content = (sample.content ?? '').toLowerCase()
    const isGeneric = genericPhrases.some(phrase => content.includes(phrase))
    const isTooShort = content.length < 10
    const isTooLong = content.length > 500

    const meta = (typeof sample.metadata === 'string' ? JSON.parse(sample.metadata) : sample.metadata) as Record<string, unknown> | null
    const mood = (meta?.mood ?? 'N/A') as string

    const statusIcon = (!isGeneric && !isTooShort) ? 'OK' : 'SUSPECT'
    if (!isGeneric && !isTooShort) qualityPasses++

    console.log(`   [${statusIcon}] @${handle} (mood: ${mood})`)
    console.log(`        "${(sample.content ?? '').slice(0, 200)}"`)
    if (isTooShort) console.log(`        WARNING: Content too short (${content.length} chars)`)
    if (isTooLong) console.log(`        NOTE: Long post (${content.length} chars)`)
    if (isGeneric) console.log(`        WARNING: Content looks generic/test`)
  }

  if (qualityPasses >= 2) {
    pass(checkName, `${qualityPasses}/3 samples look personality-driven`)
  } else {
    fail(checkName, `Only ${qualityPasses}/3 samples look personality-driven`)
  }
}

// --- Check 8: Bluesky Verification ---
async function checkBlueskyVerification(): Promise<void> {
  const checkName = '8. Bluesky Post Verification (AT Protocol)'

  const { data: posts, error } = await supabase
    .from('bluesky_post_log')
    .select('pet_id, post_uri, content, created_at')
    .eq('activity_type', 'proactive_post')
    .not('post_uri', 'is', null)
    .neq('post_uri', '')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    fail(checkName, `Query error: ${error.message}`)
    return
  }

  if ((posts ?? []).length === 0) {
    fail(checkName, 'No proactive_posts with post_uri found')
    return
  }

  // Verify up to 2 posts on Bluesky
  const toVerify = (posts ?? []).slice(0, 2)
  let verified = 0
  let failed = 0

  for (const post of toVerify) {
    const uri = post.post_uri
    if (!uri) continue

    try {
      const apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}&depth=0`
      const response = await fetch(apiUrl)

      if (response.ok) {
        const data = await response.json() as {
          thread?: {
            post?: {
              record?: { text?: string }
              author?: { handle?: string }
              likeCount?: number
              replyCount?: number
            }
          }
        }
        const threadPost = data.thread?.post
        const authorHandle = threadPost?.author?.handle ?? 'unknown'
        const postText = (threadPost?.record?.text ?? '').slice(0, 100)
        const likes = threadPost?.likeCount ?? 0
        const replies = threadPost?.replyCount ?? 0

        verified++
        console.log(`   VERIFIED: at://${authorHandle} -- "${postText}"`)
        console.log(`     Likes: ${likes}, Replies: ${replies}`)
        console.log(`     URI: ${uri}`)
      } else {
        const errBody = await response.text()
        failed++
        console.log(`   NOT FOUND (${response.status}): ${uri}`)
        console.log(`     Error: ${errBody.slice(0, 200)}`)
      }
    } catch (fetchErr) {
      failed++
      console.log(`   FETCH ERROR for ${uri}: ${fetchErr}`)
    }
  }

  if (verified > 0 && failed === 0) {
    pass(checkName, `${verified}/${toVerify.length} post(s) verified on Bluesky`)
  } else if (verified > 0) {
    warn(checkName, `${verified}/${toVerify.length} verified, ${failed} failed`)
  } else {
    fail(checkName, `0/${toVerify.length} posts could be verified on Bluesky`)
  }
}

// --- Main ---
async function main(): Promise<void> {
  console.log('===========================================================')
  console.log('  MemePet Agent -- Core Posting Verification')
  console.log(`  Time: ${new Date().toISOString()}`)
  console.log('===========================================================\n')

  const handleMap = await loadBotHandles()
  console.log(`Loaded ${handleMap.size} bot handle(s) from bluesky_bot_config\n`)

  console.log('-----------------------------------------------------------')
  await checkProactivePosts(handleMap)
  console.log()

  console.log('-----------------------------------------------------------')
  await checkReactiveReplies(handleMap)
  console.log()

  console.log('-----------------------------------------------------------')
  await checkInterPetInteractions(handleMap)
  console.log()

  console.log('-----------------------------------------------------------')
  await checkEngagementLikes()
  console.log()

  console.log('-----------------------------------------------------------')
  await checkReplySkipped()
  console.log()

  console.log('-----------------------------------------------------------')
  await checkActivityDiversity(handleMap)
  console.log()

  console.log('-----------------------------------------------------------')
  await checkPostContentQuality(handleMap)
  console.log()

  console.log('-----------------------------------------------------------')
  await checkBlueskyVerification()
  console.log()

  // --- Summary ---
  console.log('===========================================================')
  console.log('  SUMMARY')
  console.log('===========================================================')

  const passCount = results.filter(r => r.status === 'PASS').length
  const failCount = results.filter(r => r.status === 'FAIL').length
  const warnCount = results.filter(r => r.status === 'WARN').length

  for (const r of results) {
    const icon = r.status === 'PASS' ? '[PASS]' : r.status === 'FAIL' ? '[FAIL]' : '[WARN]'
    console.log(`  ${icon} ${r.name}`)
    console.log(`         ${r.detail}`)
  }

  console.log()
  console.log(`  Total: ${passCount} PASS, ${warnCount} WARN, ${failCount} FAIL out of ${results.length} checks`)

  if (failCount === 0) {
    console.log('\n  ALL CORE CHECKS PASSED.')
  } else {
    console.log(`\n  ${failCount} CHECK(S) FAILED -- see details above.`)
  }

  console.log('===========================================================')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})

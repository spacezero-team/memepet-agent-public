/**
 * Bluesky Integration End-to-End Verification
 *
 * Checks bot profiles, recent posts, post threads, handle resolution,
 * and feed generator for the MemePet agent system.
 *
 * Run: npx tsx scripts/verify-bluesky.ts
 *
 * @module verify-bluesky
 */

import { readFileSync } from 'node:fs'

// ─── Load .env.local ─────────────────────────────────
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

// ─── Constants ───────────────────────────────────────
const PUBLISHER_DID = 'did:plc:aq5zgmygkh2uztg44izqmhzy'
const FEED_NAME = 'memepet-drama'
const PUBLIC_API = 'https://public.api.bsky.app/xrpc'
const BSKY_SOCIAL = 'https://bsky.social/xrpc'
const PDS_0_SPACE = 'https://pds.0.space/xrpc'

// ─── Supabase Client ─────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

// ─── Result Tracking ─────────────────────────────────
interface TestResult {
  test: string
  status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP'
  detail: string
}

const results: TestResult[] = []

function pass(test: string, detail: string): void {
  results.push({ test, status: 'PASS', detail })
  process.stdout.write(`  PASS  ${test}: ${detail}\n`)
}

function fail(test: string, detail: string): void {
  results.push({ test, status: 'FAIL', detail })
  process.stdout.write(`  FAIL  ${test}: ${detail}\n`)
}

function warn(test: string, detail: string): void {
  results.push({ test, status: 'WARN', detail })
  process.stdout.write(`  WARN  ${test}: ${detail}\n`)
}

function skip(test: string, detail: string): void {
  results.push({ test, status: 'SKIP', detail })
  process.stdout.write(`  SKIP  ${test}: ${detail}\n`)
}

// ─── HTTP Helper ─────────────────────────────────────
async function fetchJson<T>(url: string, timeoutMs = 15_000): Promise<{ data: T | null; error: string | null; status: number }> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const response = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { data: null, error: `HTTP ${response.status}: ${text.slice(0, 200)}`, status: response.status }
    }
    const data = await response.json() as T
    return { data, error: null, status: response.status }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { data: null, error: message, status: 0 }
  }
}

// ─── Test 1: Bot Profiles on Bluesky ─────────────────
async function testBotProfiles(handles: string[]): Promise<void> {
  process.stdout.write('\n=== Test 1: Bot Profiles on Bluesky ===\n')

  const toCheck = handles.slice(0, 5)
  if (toCheck.length === 0) {
    fail('bot-profiles', 'No active bot handles found in bluesky_bot_config')
    return
  }

  for (const handle of toCheck) {
    const url = `${PUBLIC_API}/app.bsky.actor.getProfile?actor=${encodeURIComponent(handle)}`
    const { data, error } = await fetchJson<{
      did: string
      handle: string
      displayName?: string
      avatar?: string
      description?: string
    }>(url)

    if (error || !data) {
      fail(`profile:${handle}`, `Could not fetch profile: ${error}`)
      continue
    }

    const checks: string[] = []
    const missing: string[] = []

    if (data.displayName) {
      checks.push(`displayName="${data.displayName}"`)
    } else {
      missing.push('displayName')
    }

    if (data.avatar) {
      checks.push('avatar=YES')
    } else {
      missing.push('avatar')
    }

    if (data.description) {
      checks.push(`description="${data.description.slice(0, 60)}..."`)
    } else {
      missing.push('description')
    }

    if (missing.length === 0) {
      pass(`profile:${handle}`, checks.join(', '))
    } else if (missing.length <= 1) {
      warn(`profile:${handle}`, `Present: ${checks.join(', ')} | Missing: ${missing.join(', ')}`)
    } else {
      fail(`profile:${handle}`, `Missing: ${missing.join(', ')}`)
    }
  }
}

// ─── Test 2: Recent Posts Visible ────────────────────
async function testRecentPosts(handles: string[]): Promise<void> {
  process.stdout.write('\n=== Test 2: Recent Posts Visible ===\n')

  const toCheck = handles.slice(0, 3)
  if (toCheck.length === 0) {
    fail('recent-posts', 'No active bot handles to check')
    return
  }

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)

  for (const handle of toCheck) {
    const url = `${PUBLIC_API}/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=5`
    const { data, error } = await fetchJson<{
      feed: Array<{
        post: {
          uri: string
          record: { text?: string; createdAt?: string }
          author: { handle: string }
        }
      }>
    }>(url)

    if (error || !data) {
      fail(`feed:${handle}`, `Could not fetch feed: ${error}`)
      continue
    }

    if (data.feed.length === 0) {
      fail(`feed:${handle}`, 'No posts found at all')
      continue
    }

    const recentPosts = data.feed.filter(item => {
      const createdAt = item.post.record?.createdAt
      return createdAt ? new Date(createdAt) >= twoHoursAgo : false
    })

    if (recentPosts.length > 0) {
      const latest = recentPosts[0]
      const text = (latest.post.record?.text ?? '').slice(0, 80)
      const age = latest.post.record?.createdAt
        ? Math.round((Date.now() - new Date(latest.post.record.createdAt).getTime()) / 60_000)
        : '?'
      pass(`feed:${handle}`, `${recentPosts.length} posts in last 2h; latest (${age}min ago): "${text}"`)
    } else {
      const latest = data.feed[0]
      const latestTime = latest.post.record?.createdAt ?? 'unknown'
      const age = latestTime !== 'unknown'
        ? Math.round((Date.now() - new Date(latestTime).getTime()) / 60_000)
        : '?'
      fail(`feed:${handle}`, `No posts in last 2h; most recent is ${age}min ago: "${(latest.post.record?.text ?? '').slice(0, 60)}"`)
    }
  }
}

// ─── Test 3: Post Threads (Inter-Pet Conversations) ──
async function testPostThreads(): Promise<void> {
  process.stdout.write('\n=== Test 3: Post Threads (Inter-Pet Conversations) ===\n')

  // Find a recent interaction_initiate with a post_uri
  const { data: interactions, error } = await supabase
    .from('bluesky_post_log')
    .select('pet_id, post_uri, content, metadata, created_at')
    .eq('activity_type', 'interaction_initiate')
    .not('post_uri', 'is', null)
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    fail('threads', `Supabase query error: ${error.message}`)
    return
  }

  if (!interactions || interactions.length === 0) {
    warn('threads', 'No interaction_initiate posts found in bluesky_post_log')
    return
  }

  let threadFound = false

  for (const interaction of interactions) {
    const postUri = interaction.post_uri as string
    const url = `${PUBLIC_API}/app.bsky.feed.getPostThread?uri=${encodeURIComponent(postUri)}&depth=6`
    const { data: threadData, error: threadError } = await fetchJson<{
      thread: {
        $type: string
        post?: { uri: string; record: { text?: string }; author: { handle: string } }
        replies?: Array<{
          $type: string
          post?: { uri: string; record: { text?: string }; author: { handle: string } }
          replies?: Array<{
            $type: string
            post?: { uri: string; record: { text?: string }; author: { handle: string } }
          }>
        }>
      }
    }>(url)

    if (threadError || !threadData) {
      warn(`thread:${postUri.split('/').pop()}`, `Could not fetch thread: ${threadError}`)
      continue
    }

    const thread = threadData.thread
    if (thread.$type !== 'app.bsky.feed.defs#threadViewPost') {
      warn(`thread:${postUri.split('/').pop()}`, `Thread type: ${thread.$type} (not a thread view)`)
      continue
    }

    const replies = thread.replies ?? []
    const rootAuthor = thread.post?.author?.handle ?? 'unknown'
    const rootText = (thread.post?.record?.text ?? '').slice(0, 80)

    if (replies.length > 0) {
      const replyAuthors = replies
        .filter(r => r.$type === 'app.bsky.feed.defs#threadViewPost' && r.post)
        .map(r => `@${r.post!.author.handle}`)
      const replyTexts = replies
        .filter(r => r.$type === 'app.bsky.feed.defs#threadViewPost' && r.post)
        .map(r => (r.post!.record?.text ?? '').slice(0, 60))

      pass('thread-conversation', [
        `Root by @${rootAuthor}: "${rootText}"`,
        `${replies.length} reply(ies) from: ${replyAuthors.join(', ')}`,
        ...replyTexts.map((t, i) => `  Reply ${i + 1}: "${t}"`),
      ].join('\n        '))
      threadFound = true
      break
    } else {
      warn(`thread:${postUri.split('/').pop()}`, `Post by @${rootAuthor} has 0 replies: "${rootText}"`)
    }
  }

  if (!threadFound) {
    // Check if any exist with replies in the broader log
    warn('thread-conversation', 'No interaction threads with visible replies found in the last 5 interactions')
  }
}

// ─── Test 4: Handle Resolution ───────────────────────
async function testHandleResolution(handles: string[]): Promise<void> {
  process.stdout.write('\n=== Test 4: Handle Resolution ===\n')

  const toCheck = handles.slice(0, 3)
  if (toCheck.length === 0) {
    fail('handle-resolution', 'No handles to resolve')
    return
  }

  for (const handle of toCheck) {
    // Determine which PDS to check based on handle suffix
    const is0Space = handle.endsWith('.0.space')

    // Test bsky.social resolution
    const bskyUrl = `${BSKY_SOCIAL}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    const { data: bskyResult, error: bskyError } = await fetchJson<{ did: string }>(bskyUrl)

    if (bskyResult?.did) {
      pass(`resolve-bsky:${handle}`, `bsky.social -> ${bskyResult.did}`)
    } else if (bskyError) {
      if (is0Space) {
        // Expected: 0.space handles may not resolve on bsky.social
        warn(`resolve-bsky:${handle}`, `bsky.social cannot resolve (expected for .0.space): ${bskyError}`)
      } else {
        fail(`resolve-bsky:${handle}`, `bsky.social resolution failed: ${bskyError}`)
      }
    }

    // Test PDS 0.space resolution
    const pdsUrl = `${PDS_0_SPACE}/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`
    const { data: pdsResult, error: pdsError } = await fetchJson<{ did: string }>(pdsUrl)

    if (pdsResult?.did) {
      pass(`resolve-pds:${handle}`, `pds.0.space -> ${pdsResult.did}`)
    } else if (pdsError) {
      if (!is0Space) {
        // Expected: non-0.space handles may not resolve on pds.0.space
        warn(`resolve-pds:${handle}`, `pds.0.space cannot resolve (expected for non-.0.space): ${pdsError}`)
      } else {
        fail(`resolve-pds:${handle}`, `pds.0.space resolution failed: ${pdsError}`)
      }
    }

    // Verify DID consistency if both resolved
    if (bskyResult?.did && pdsResult?.did && bskyResult.did !== pdsResult.did) {
      fail(`resolve-consistency:${handle}`, `DID mismatch! bsky=${bskyResult.did} vs pds=${pdsResult.did}`)
    } else if (bskyResult?.did && pdsResult?.did) {
      pass(`resolve-consistency:${handle}`, `DIDs match: ${bskyResult.did}`)
    }
  }
}

// ─── Test 5: Feed Generator ──────────────────────────
async function testFeedGenerator(): Promise<void> {
  process.stdout.write('\n=== Test 5: Feed Generator ===\n')

  const feedUri = `at://${PUBLISHER_DID}/app.bsky.feed.generator/${FEED_NAME}`

  // Try to fetch the feed via public API
  const url = `${PUBLIC_API}/app.bsky.feed.getFeed?feed=${encodeURIComponent(feedUri)}&limit=10`
  const { data, error, status } = await fetchJson<{
    feed: Array<{
      post: {
        uri: string
        record: { text?: string; createdAt?: string }
        author: { handle: string; displayName?: string }
      }
    }>
    cursor?: string
  }>(url)

  if (error) {
    if (status === 400 || status === 404) {
      warn('feed-generator', `Feed "${FEED_NAME}" not registered or not found: ${error}`)
    } else if (error.includes('auth') || error.includes('401')) {
      warn('feed-generator', `Feed requires auth to fetch (expected for some configurations): ${error}`)
    } else {
      fail('feed-generator', `Could not fetch feed: ${error}`)
    }

    // Check the feed skeleton endpoint directly (our server)
    const feedHostname = process.env.FEED_HOSTNAME ?? 'memepet-agent.0.space'
    const skeletonUrl = `https://${feedHostname}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodeURIComponent(feedUri)}&limit=5`
    const { data: skeleton, error: skelError } = await fetchJson<{
      feed: Array<{ post: string }>
      cursor?: string
    }>(skeletonUrl)

    if (skeleton) {
      pass('feed-skeleton', `Feed skeleton endpoint returned ${skeleton.feed.length} posts`)
      for (const item of skeleton.feed.slice(0, 3)) {
        process.stdout.write(`        Post: ${item.post}\n`)
      }
    } else {
      warn('feed-skeleton', `Feed skeleton endpoint error: ${skelError}`)
    }

    // Check DID document
    const didUrl = `https://${feedHostname}/.well-known/did.json`
    const { data: didDoc, error: didError } = await fetchJson<{
      id: string
      service: Array<{ id: string; type: string; serviceEndpoint: string }>
    }>(didUrl)

    if (didDoc) {
      pass('feed-did-document', `DID: ${didDoc.id}, service: ${didDoc.service?.[0]?.type ?? 'none'}`)
    } else {
      warn('feed-did-document', `DID document fetch failed: ${didError}`)
    }

    return
  }

  if (!data || data.feed.length === 0) {
    warn('feed-generator', 'Feed returned but is empty')
    return
  }

  pass('feed-generator', `Feed "${FEED_NAME}" returned ${data.feed.length} posts`)
  for (const item of data.feed.slice(0, 3)) {
    const author = item.post.author.handle
    const text = (item.post.record?.text ?? '').slice(0, 60)
    const time = item.post.record?.createdAt ?? 'unknown'
    process.stdout.write(`        @${author}: "${text}" (${time})\n`)
  }
}

// ─── Main ────────────────────────────────────────────
async function main(): Promise<void> {
  process.stdout.write('=== MemePet Bluesky Integration Verification ===\n')
  process.stdout.write(`Timestamp: ${new Date().toISOString()}\n`)

  // Fetch active bot handles from Supabase
  const { data: bots, error: botsError } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, did, is_active')
    .eq('is_active', true)
    .order('handle', { ascending: true })

  if (botsError) {
    fail('setup', `Could not load bot configs from Supabase: ${botsError.message}`)
    printSummary()
    process.exit(1)
  }

  const activeBots = bots ?? []
  process.stdout.write(`\nFound ${activeBots.length} active bot(s):\n`)
  for (const bot of activeBots) {
    process.stdout.write(`  - @${bot.handle} (DID: ${bot.did ?? 'none'}, pet: ${bot.pet_id})\n`)
  }

  const handles = activeBots.map(b => b.handle as string)

  // Run all tests
  await testBotProfiles(handles)
  await testRecentPosts(handles)
  await testPostThreads()
  await testHandleResolution(handles)
  await testFeedGenerator()

  printSummary()
}

function printSummary(): void {
  process.stdout.write('\n══════════════════════════════════════════════════\n')
  process.stdout.write('                  SUMMARY\n')
  process.stdout.write('══════════════════════════════════════════════════\n')

  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  const warned = results.filter(r => r.status === 'WARN').length
  const skipped = results.filter(r => r.status === 'SKIP').length
  const total = results.length

  process.stdout.write(`  Total:   ${total}\n`)
  process.stdout.write(`  PASS:    ${passed}\n`)
  process.stdout.write(`  FAIL:    ${failed}\n`)
  process.stdout.write(`  WARN:    ${warned}\n`)
  process.stdout.write(`  SKIP:    ${skipped}\n`)
  process.stdout.write('──────────────────────────────────────────────────\n')

  if (failed > 0) {
    process.stdout.write('\nFailed tests:\n')
    for (const r of results.filter(r => r.status === 'FAIL')) {
      process.stdout.write(`  FAIL  ${r.test}: ${r.detail}\n`)
    }
  }

  if (warned > 0) {
    process.stdout.write('\nWarnings:\n')
    for (const r of results.filter(r => r.status === 'WARN')) {
      process.stdout.write(`  WARN  ${r.test}: ${r.detail}\n`)
    }
  }

  process.stdout.write('\n')

  if (failed === 0) {
    process.stdout.write('Result: ALL CRITICAL CHECKS PASSED\n')
  } else {
    process.stdout.write(`Result: ${failed} CRITICAL FAILURE(S)\n`)
  }
  process.stdout.write('══════════════════════════════════════════════════\n')
}

main().catch(err => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})

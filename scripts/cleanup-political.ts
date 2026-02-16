/**
 * Political Content Cleanup Script
 *
 * Connects to all active bots, scans their posts and likes for political content,
 * and removes them. Also marks political entries in Supabase bluesky_post_log.
 *
 * Safe to run multiple times (idempotent).
 *
 * Usage: npx tsx scripts/cleanup-political.ts
 */
import { readFileSync } from 'node:fs'

// Load .env.local before any other imports that depend on env vars
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

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { AtpAgent } from '@atproto/api'
import { decryptIfNeeded } from '../lib/utils/encrypt.js'

// ─── Political keywords (comprehensive list) ────────────────

const POLITICAL_KEYWORDS = [
  // US politics
  'trump', 'biden', 'harris', 'desantis', 'obama', 'maga', 'democrat', 'republican',
  'gop', 'liberal', 'conservative', 'election', 'vote', 'ballot', 'political',
  'politician', 'congress', 'senate', 'capitol', 'white house',
  // Hot-button issues
  'abortion', 'pro-life', 'pro-choice', 'gun control', 'immigration',
  'border wall', 'deportation', 'woke', 'anti-woke', 'dei',
  'critical race theory', 'defund police', 'blm', 'antifa',
  // International politics
  'putin', 'zelensky', 'netanyahu', 'gaza', 'palestine', 'sanctions', 'nato',
  // General political terms
  'partisan', 'bipartisan', 'legislation', 'government shutdown', 'impeach',
  // Korean politics
  '정치', '대통령', '국회', '여당', '야당', '보수', '진보', '탄핵', '선거', '투표',
]

const KEYWORDS_LOWER = POLITICAL_KEYWORDS.map(kw => kw.toLowerCase())

function isPolitical(text: string): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return KEYWORDS_LOWER.some(kw => lower.includes(kw))
}

// ─── Types ───────────────────────────────────────────────────

interface BotRow {
  pet_id: string
  handle: string
  app_password: string
  pds_url: string | null
  did: string | null
}

interface CleanupStats {
  handle: string
  postsScanned: number
  postsDeleted: number
  likesScanned: number
  likesRemoved: number
  dbRowsFlagged: number
  errors: string[]
}

interface DeletedRecord {
  handle: string
  type: 'post' | 'like'
  uri: string
  text: string
}

// ─── Helpers ─────────────────────────────────────────────────

function resolveServiceUrl(handle: string, pdsUrl: string | null): string {
  if (pdsUrl) return pdsUrl
  if (handle.endsWith('.0.space')) return 'https://pds.0.space'
  return 'https://bsky.social'
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Per-bot cleanup ─────────────────────────────────────────

async function cleanupBot(
  bot: BotRow,
  supabase: SupabaseClient,
  deletionLog: DeletedRecord[],
): Promise<CleanupStats> {
  const stats: CleanupStats = {
    handle: bot.handle,
    postsScanned: 0,
    postsDeleted: 0,
    likesScanned: 0,
    likesRemoved: 0,
    dbRowsFlagged: 0,
    errors: [],
  }

  const serviceUrl = resolveServiceUrl(bot.handle, bot.pds_url)
  const agent = new AtpAgent({ service: serviceUrl })

  // Authenticate
  const password = decryptIfNeeded(String(bot.app_password))
  try {
    await agent.login({ identifier: bot.handle, password })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    stats.errors.push(`Login failed: ${msg}`)
    return stats
  }

  const did = agent.session?.did
  if (!did) {
    stats.errors.push('No DID after login')
    return stats
  }

  // ─── Scan and delete political posts ─────────────────────

  try {
    let cursor: string | undefined
    let pageCount = 0
    const maxPages = 10 // safety limit

    while (pageCount < maxPages) {
      const response = await agent.getAuthorFeed({
        actor: did,
        limit: 100,
        cursor,
      })

      const feed = response.data.feed
      if (feed.length === 0) break

      for (const item of feed) {
        stats.postsScanned++
        const record = item.post.record as { text?: string }
        const text = record?.text ?? ''

        if (isPolitical(text)) {
          const uri = item.post.uri
          const preview = text.slice(0, 100).replace(/\n/g, ' ')

          // Log before deleting
          deletionLog.push({
            handle: bot.handle,
            type: 'post',
            uri,
            text: preview,
          })

          try {
            // Extract rkey from URI: at://did/collection/rkey
            const rkey = uri.split('/').pop()
            if (rkey) {
              await agent.deletePost(uri)
              stats.postsDeleted++
              await sleep(500) // rate limit courtesy
            }
          } catch (delErr) {
            const msg = delErr instanceof Error ? delErr.message : String(delErr)
            stats.errors.push(`Failed to delete post ${uri}: ${msg}`)
          }
        }
      }

      cursor = response.data.cursor
      if (!cursor) break
      pageCount++
      await sleep(300)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    stats.errors.push(`Post scan error: ${msg}`)
  }

  // ─── Scan and remove political likes ─────────────────────

  try {
    let cursor: string | undefined
    let pageCount = 0
    const maxPages = 10

    while (pageCount < maxPages) {
      const response = await agent.app.bsky.feed.getActorLikes({
        actor: did,
        limit: 100,
        cursor,
      })

      const feed = response.data.feed
      if (feed.length === 0) break

      for (const item of feed) {
        stats.likesScanned++
        const record = item.post.record as { text?: string }
        const text = record?.text ?? ''

        if (isPolitical(text)) {
          const uri = item.post.uri
          const preview = text.slice(0, 100).replace(/\n/g, ' ')

          deletionLog.push({
            handle: bot.handle,
            type: 'like',
            uri,
            text: preview,
          })

          try {
            // Find the like record URI to delete
            const likeUri = item.post.viewer?.like
            if (likeUri) {
              await agent.deleteLike(likeUri)
              stats.likesRemoved++
              await sleep(500)
            }
          } catch (delErr) {
            const msg = delErr instanceof Error ? delErr.message : String(delErr)
            stats.errors.push(`Failed to unlike ${uri}: ${msg}`)
          }
        }
      }

      cursor = response.data.cursor
      if (!cursor) break
      pageCount++
      await sleep(300)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    stats.errors.push(`Likes scan error: ${msg}`)
  }

  // ─── Flag political rows in bluesky_post_log ─────────────

  try {
    const { data: logRows, error } = await supabase
      .from('bluesky_post_log')
      .select('id, content, post_uri')
      .eq('pet_id', bot.pet_id)
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      stats.errors.push(`DB query error: ${error.message}`)
    } else {
      const politicalIds: string[] = []
      for (const row of (logRows ?? [])) {
        if (isPolitical(row.content ?? '')) {
          politicalIds.push(row.id)
        }
      }

      if (politicalIds.length > 0) {
        // Mark as flagged by adding metadata tag
        const { error: updateError } = await supabase
          .from('bluesky_post_log')
          .update({ metadata: { political_flagged: true, flagged_at: new Date().toISOString() } })
          .in('id', politicalIds)

        if (updateError) {
          stats.errors.push(`DB update error: ${updateError.message}`)
        } else {
          stats.dbRowsFlagged = politicalIds.length
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    stats.errors.push(`DB cleanup error: ${msg}`)
  }

  return stats
}

// ─── Main ────────────────────────────────────────────────────

async function main(): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Load all active bots
  const { data: bots, error } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, app_password, pds_url, did')
    .eq('is_active', true)

  if (error) {
    throw new Error(`Failed to load bots: ${error.message}`)
  }

  const activeBots = (bots ?? []).filter(
    (b: BotRow) => b.handle !== 'memepet.0.space' && b.handle != null,
  )

  console.log(`\n=== Political Content Cleanup ===`)
  console.log(`Found ${activeBots.length} active bots to scan\n`)

  const allStats: CleanupStats[] = []
  const deletionLog: DeletedRecord[] = []

  // Process bots sequentially to avoid rate limits
  for (const bot of activeBots) {
    console.log(`--- Scanning @${bot.handle} ---`)
    const stats = await cleanupBot(bot as BotRow, supabase, deletionLog)
    allStats.push(stats)

    console.log(`  Posts: ${stats.postsScanned} scanned, ${stats.postsDeleted} deleted`)
    console.log(`  Likes: ${stats.likesScanned} scanned, ${stats.likesRemoved} removed`)
    console.log(`  DB rows flagged: ${stats.dbRowsFlagged}`)
    if (stats.errors.length > 0) {
      console.log(`  Errors: ${stats.errors.join('; ')}`)
    }
    console.log()
  }

  // ─── Summary ─────────────────────────────────────────────

  console.log(`\n=== SUMMARY ===`)
  const totalPostsDeleted = allStats.reduce((sum, s) => sum + s.postsDeleted, 0)
  const totalLikesRemoved = allStats.reduce((sum, s) => sum + s.likesRemoved, 0)
  const totalDbFlagged = allStats.reduce((sum, s) => sum + s.dbRowsFlagged, 0)
  const totalErrors = allStats.reduce((sum, s) => sum + s.errors.length, 0)

  console.log(`Total posts deleted: ${totalPostsDeleted}`)
  console.log(`Total likes removed: ${totalLikesRemoved}`)
  console.log(`Total DB rows flagged: ${totalDbFlagged}`)
  console.log(`Total errors: ${totalErrors}`)

  // ─── Deletion log ────────────────────────────────────────

  if (deletionLog.length > 0) {
    console.log(`\n=== DELETION LOG ===`)
    for (const entry of deletionLog) {
      console.log(`[@${entry.handle}] ${entry.type.toUpperCase()}: "${entry.text}"`)
      console.log(`  URI: ${entry.uri}`)
    }
  } else {
    console.log(`\nNo political content found. All clean!`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

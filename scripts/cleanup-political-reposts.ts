/**
 * Political Content Cleanup: Reposts, Quote Posts, and Remaining Posts
 *
 * Scans ALL bots for:
 * 1. Reposts of political content (app.bsky.feed.repost records)
 * 2. Quote posts containing political content (embedded records)
 * 3. Any remaining direct posts with political content
 *
 * Deletes offending records from Bluesky and flags entries in Supabase.
 * Safe to run multiple times (idempotent).
 *
 * Usage: npx tsx scripts/cleanup-political-reposts.ts
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
  // US politics - people
  'trump', 'biden', 'harris', 'desantis', 'obama', 'maga',
  // US politics - parties/ideology
  'democrat', 'republican', 'gop', 'liberal', 'conservative',
  'left-wing', 'right-wing', 'far-right', 'far-left',
  // US politics - institutions
  'congress', 'senate', 'capitol', 'white house', 'supreme court',
  // Elections
  'election', 'vote', 'ballot', 'polling', 'primary', 'caucus', 'electoral',
  'campaign', 'inauguration', 'impeach',
  // Hot-button issues
  'abortion', 'pro-life', 'pro-choice', 'gun control', 'second amendment',
  'immigration', 'border wall', 'deportation', 'refugee', 'asylum',
  'climate change denial', 'woke', 'anti-woke', 'dei',
  'critical race theory', 'crt', 'defund police', 'blm', 'antifa', 'proud boys',
  // International politics
  'putin', 'zelensky', 'xi jinping', 'netanyahu', 'gaza', 'palestine',
  'sanctions', 'nato',
  // General political terms
  'partisan', 'bipartisan', 'lobbyist', 'political', 'politician', 'legislation',
  'government shutdown', 'filibuster', 'gerrymandering',
  'first lady', 'president biden', 'president trump',
  'doj', 'department of justice', 'attorney general', 'epstein',
  'classified documents',
  // Korean politics
  '정치', '대통령', '국회', '여당', '야당', '보수', '진보', '탄핵', '선거', '투표',
]

const KEYWORDS_LOWER = POLITICAL_KEYWORDS.map(kw => kw.toLowerCase())

function isPolitical(text: string): boolean {
  if (!text) return false
  const lower = text.toLowerCase()
  return KEYWORDS_LOWER.some(kw => lower.includes(kw))
}

function findMatchedKeyword(text: string): string | null {
  if (!text) return null
  const lower = text.toLowerCase()
  return KEYWORDS_LOWER.find(kw => lower.includes(kw)) ?? null
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
  feedItemsScanned: number
  repostsDeleted: number
  quotePostsDeleted: number
  directPostsDeleted: number
  repostRecordsScanned: number
  dbRowsFlagged: number
  errors: string[]
}

interface DeletedRecord {
  handle: string
  type: 'repost' | 'quote_post' | 'direct_post'
  uri: string
  text: string
  matchedKeyword: string
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

function extractRkey(uri: string): string | null {
  // at://did:plc:xxx/app.bsky.feed.post/rkey
  const parts = uri.split('/')
  return parts.length > 0 ? parts[parts.length - 1] : null
}

// ─── Extract text from embedded/quoted content ──────────────

function extractEmbeddedText(embed: Record<string, unknown> | undefined): string {
  if (!embed) return ''

  const texts: string[] = []

  // app.bsky.embed.record#view — quote post embed
  if (embed.$type === 'app.bsky.embed.record#view' || embed.$type === 'app.bsky.embed.record') {
    const record = embed.record as Record<string, unknown> | undefined
    if (record) {
      // The record view has a nested 'value' or direct fields
      const value = (record.value ?? record) as Record<string, unknown>
      if (typeof value.text === 'string') texts.push(value.text)

      // Check for nested embeds (quote of a quote)
      const nestedEmbed = (value.embeds as Array<Record<string, unknown>> | undefined)?.[0]
        ?? (value.embed as Record<string, unknown> | undefined)
      if (nestedEmbed) {
        texts.push(extractEmbeddedText(nestedEmbed))
      }
    }
  }

  // app.bsky.embed.recordWithMedia#view — quote post with media
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' || embed.$type === 'app.bsky.embed.recordWithMedia') {
    const innerRecord = embed.record as Record<string, unknown> | undefined
    if (innerRecord) {
      texts.push(extractEmbeddedText(innerRecord))
    }
  }

  // app.bsky.embed.external#view — link card embed
  if (embed.$type === 'app.bsky.embed.external#view' || embed.$type === 'app.bsky.embed.external') {
    const external = (embed.external ?? embed) as Record<string, unknown> | undefined
    if (external) {
      if (typeof external.title === 'string') texts.push(external.title)
      if (typeof external.description === 'string') texts.push(external.description)
    }
  }

  return texts.filter(Boolean).join(' ')
}

// ─── Per-bot cleanup ─────────────────────────────────────────

async function cleanupBot(
  bot: BotRow,
  supabase: SupabaseClient,
  deletionLog: DeletedRecord[],
): Promise<CleanupStats> {
  const stats: CleanupStats = {
    handle: bot.handle,
    feedItemsScanned: 0,
    repostsDeleted: 0,
    quotePostsDeleted: 0,
    directPostsDeleted: 0,
    repostRecordsScanned: 0,
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

  // ─── Phase 1: Scan author feed (posts, quote posts, reposts in feed) ───

  console.log(`  Phase 1: Scanning author feed...`)

  try {
    let cursor: string | undefined
    let pageCount = 0
    const maxPages = 5 // up to 500 feed items

    while (pageCount < maxPages) {
      const response = await agent.getAuthorFeed({
        actor: did,
        limit: 100,
        cursor,
      })

      const feed = response.data.feed
      if (feed.length === 0) break

      for (const item of feed) {
        stats.feedItemsScanned++

        const record = item.post.record as { text?: string }
        const postText = record?.text ?? ''
        const embed = (item.post as Record<string, unknown>).embed as Record<string, unknown> | undefined
        const embeddedText = extractEmbeddedText(embed)
        const combinedText = `${postText} ${embeddedText}`

        // Check if this is a REPOST (has reason with type reasonRepost)
        const reason = item.reason as Record<string, unknown> | undefined
        const isRepost = reason?.$type === 'app.bsky.feed.defs#reasonRepost'

        // Check if this is a QUOTE POST (has embed with record type)
        const isQuotePost = embed?.$type === 'app.bsky.embed.record#view'
          || embed?.$type === 'app.bsky.embed.recordWithMedia#view'

        if (isRepost) {
          // For reposts, check the ORIGINAL post text
          const matchedKeyword = findMatchedKeyword(combinedText)
          if (matchedKeyword) {
            const preview = combinedText.slice(0, 120).replace(/\n/g, ' ')

            deletionLog.push({
              handle: bot.handle,
              type: 'repost',
              uri: item.post.uri,
              text: preview,
              matchedKeyword,
            })

            // We need to find and delete the repost record (not the original post)
            // The repost record URI is NOT the same as the reposted post URI
            // We'll collect these and delete them in Phase 2
          }
        } else if (isQuotePost) {
          // For quote posts, check BOTH the bot's text AND the embedded post text
          const matchedKeyword = findMatchedKeyword(combinedText)
          if (matchedKeyword) {
            const uri = item.post.uri
            const preview = combinedText.slice(0, 120).replace(/\n/g, ' ')

            deletionLog.push({
              handle: bot.handle,
              type: 'quote_post',
              uri,
              text: preview,
              matchedKeyword,
            })

            try {
              await agent.deletePost(uri)
              stats.quotePostsDeleted++
              console.log(`    DELETED quote post: "${preview}" [keyword: ${matchedKeyword}]`)
              await sleep(500)
            } catch (delErr) {
              const msg = delErr instanceof Error ? delErr.message : String(delErr)
              stats.errors.push(`Failed to delete quote post ${uri}: ${msg}`)
            }
          }
        } else {
          // Direct post — check for political content
          const matchedKeyword = findMatchedKeyword(combinedText)
          if (matchedKeyword) {
            const uri = item.post.uri
            const preview = combinedText.slice(0, 120).replace(/\n/g, ' ')

            deletionLog.push({
              handle: bot.handle,
              type: 'direct_post',
              uri,
              text: preview,
              matchedKeyword,
            })

            try {
              await agent.deletePost(uri)
              stats.directPostsDeleted++
              console.log(`    DELETED direct post: "${preview}" [keyword: ${matchedKeyword}]`)
              await sleep(500)
            } catch (delErr) {
              const msg = delErr instanceof Error ? delErr.message : String(delErr)
              stats.errors.push(`Failed to delete post ${uri}: ${msg}`)
            }
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
    stats.errors.push(`Feed scan error: ${msg}`)
  }

  // ─── Phase 2: Scan and delete political repost records ─────

  console.log(`  Phase 2: Scanning repost records...`)

  try {
    let cursor: string | undefined
    let pageCount = 0
    const maxPages = 5

    while (pageCount < maxPages) {
      const response = await agent.app.bsky.feed.repost.list({
        repo: did,
        limit: 100,
        cursor,
      })

      const records = response.records
      if (records.length === 0) break

      for (const record of records) {
        stats.repostRecordsScanned++

        // Each repost record has: uri (repost record URI) and value.subject (the reposted post ref)
        const repostRecordUri = record.uri
        const subject = record.value.subject

        // We need to fetch the original post to check its content
        try {
          const postResponse = await agent.getPosts({
            uris: [subject.uri],
          })

          const post = postResponse.data.posts[0]
          if (post) {
            const postRecord = post.record as { text?: string }
            const postText = postRecord?.text ?? ''
            const embed = (post as Record<string, unknown>).embed as Record<string, unknown> | undefined
            const embeddedText = extractEmbeddedText(embed)
            const combinedText = `${postText} ${embeddedText}`

            const matchedKeyword = findMatchedKeyword(combinedText)
            if (matchedKeyword) {
              const preview = combinedText.slice(0, 120).replace(/\n/g, ' ')

              // Only log if not already logged in Phase 1
              const alreadyLogged = deletionLog.some(
                d => d.handle === bot.handle && d.type === 'repost' && d.uri === subject.uri
              )
              if (!alreadyLogged) {
                deletionLog.push({
                  handle: bot.handle,
                  type: 'repost',
                  uri: subject.uri,
                  text: preview,
                  matchedKeyword,
                })
              }

              // Delete the repost record
              const rkey = extractRkey(repostRecordUri)
              if (rkey) {
                try {
                  await agent.api.com.atproto.repo.deleteRecord({
                    repo: did,
                    collection: 'app.bsky.feed.repost',
                    rkey,
                  })
                  stats.repostsDeleted++
                  console.log(`    DELETED repost of: "${preview}" [keyword: ${matchedKeyword}]`)
                  await sleep(500)
                } catch (delErr) {
                  const msg = delErr instanceof Error ? delErr.message : String(delErr)
                  stats.errors.push(`Failed to delete repost record ${repostRecordUri}: ${msg}`)
                }
              }
            }
          }
        } catch (fetchErr) {
          // Original post may have been deleted, skip
          const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr)
          if (!msg.includes('not found') && !msg.includes('Not Found')) {
            stats.errors.push(`Failed to fetch reposted post ${subject.uri}: ${msg}`)
          }
        }
      }

      cursor = response.cursor
      if (!cursor) break
      pageCount++
      await sleep(300)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    stats.errors.push(`Repost scan error: ${msg}`)
  }

  // ─── Phase 3: Clean up Supabase bluesky_post_log ──────────

  console.log(`  Phase 3: Flagging political entries in database...`)

  try {
    const { data: logRows, error } = await supabase
      .from('bluesky_post_log')
      .select('id, content, post_uri, metadata')
      .eq('pet_id', bot.pet_id)
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      stats.errors.push(`DB query error: ${error.message}`)
    } else {
      const politicalIds: string[] = []
      for (const row of (logRows ?? [])) {
        const content = (row as Record<string, unknown>).content as string ?? ''
        const metadata = (row as Record<string, unknown>).metadata as Record<string, unknown> | null
        const quotedText = (metadata?.quotedPostText as string) ?? ''
        const combinedText = `${content} ${quotedText}`

        if (isPolitical(combinedText)) {
          politicalIds.push((row as Record<string, unknown>).id as string)
        }
      }

      if (politicalIds.length > 0) {
        const { error: updateError } = await supabase
          .from('bluesky_post_log')
          .update({
            metadata: {
              political_flagged: true,
              flagged_at: new Date().toISOString(),
              cleanup_script: 'cleanup-political-reposts',
            },
          })
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
    (b: Record<string, unknown>) =>
      (b.handle as string) !== 'memepet.0.space' && b.handle != null,
  )

  console.log(`\n=== Political Repost/Quote Cleanup ===`)
  console.log(`Found ${activeBots.length} active bots to scan`)
  console.log(`Political keywords: ${POLITICAL_KEYWORDS.length}`)
  console.log()

  const allStats: CleanupStats[] = []
  const deletionLog: DeletedRecord[] = []

  // Process bots sequentially to avoid rate limits
  for (const bot of activeBots) {
    console.log(`--- Scanning @${bot.handle} ---`)
    const stats = await cleanupBot(bot as unknown as BotRow, supabase, deletionLog)
    allStats.push(stats)

    console.log(`  Feed items scanned: ${stats.feedItemsScanned}`)
    console.log(`  Repost records scanned: ${stats.repostRecordsScanned}`)
    console.log(`  Reposts deleted: ${stats.repostsDeleted}`)
    console.log(`  Quote posts deleted: ${stats.quotePostsDeleted}`)
    console.log(`  Direct posts deleted: ${stats.directPostsDeleted}`)
    console.log(`  DB rows flagged: ${stats.dbRowsFlagged}`)
    if (stats.errors.length > 0) {
      console.log(`  Errors: ${stats.errors.join('; ')}`)
    }
    console.log()
  }

  // ─── Summary ─────────────────────────────────────────────

  console.log(`\n=== SUMMARY ===`)
  const totalRepostsDeleted = allStats.reduce((sum, s) => sum + s.repostsDeleted, 0)
  const totalQuotesDeleted = allStats.reduce((sum, s) => sum + s.quotePostsDeleted, 0)
  const totalDirectDeleted = allStats.reduce((sum, s) => sum + s.directPostsDeleted, 0)
  const totalDbFlagged = allStats.reduce((sum, s) => sum + s.dbRowsFlagged, 0)
  const totalErrors = allStats.reduce((sum, s) => sum + s.errors.length, 0)

  console.log(`Total reposts deleted: ${totalRepostsDeleted}`)
  console.log(`Total quote posts deleted: ${totalQuotesDeleted}`)
  console.log(`Total direct posts deleted: ${totalDirectDeleted}`)
  console.log(`Total DB rows flagged: ${totalDbFlagged}`)
  console.log(`Total errors: ${totalErrors}`)

  // ─── Deletion log ────────────────────────────────────────

  if (deletionLog.length > 0) {
    console.log(`\n=== DELETION LOG (${deletionLog.length} items) ===`)
    for (const entry of deletionLog) {
      console.log(`[@${entry.handle}] ${entry.type.toUpperCase()}: "${entry.text}"`)
      console.log(`  URI: ${entry.uri}`)
      console.log(`  Matched keyword: "${entry.matchedKeyword}"`)
    }
  } else {
    console.log(`\nNo political content found. All clean!`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

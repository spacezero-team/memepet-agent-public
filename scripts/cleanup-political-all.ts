/**
 * Comprehensive Political Content Cleanup Script
 *
 * THE DEFINITIVE cleanup — covers every vector previous scripts missed:
 *
 * For each bot:
 *   1. Own posts text
 *   2. Replies — fetches PARENT and ROOT posts to check their text + embeds
 *   3. Quote posts — checks embedded post text + embeds
 *   4. Link embeds — checks title and description
 *   5. Likes — fetches liked posts and checks content
 *   6. Reposts — fetches original posts and checks content
 *
 * Deletes anything political (posts, replies, reposts, likes).
 * Flags entries in Supabase bluesky_post_log.
 *
 * Safe to run multiple times (idempotent).
 *
 * Usage: npx tsx scripts/cleanup-political-all.ts
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

// ─── Political keywords (comprehensive) ──────────────────────

const POLITICAL_KEYWORDS = [
  // US politics - people
  'trump', 'biden', 'harris', 'kamala', 'desantis', 'obama', 'maga',
  // US politics - parties/ideology
  'democrat', 'republican', 'gop', 'liberal', 'conservative',
  'left-wing', 'right-wing', 'far-right', 'far-left',
  // US politics - institutions
  'congress', 'senate', 'capitol', 'white house', 'supreme court', 'scotus',
  // Elections
  'election', 'vote', 'ballot', 'polling', 'primary', 'caucus', 'electoral',
  'campaign', 'inauguration', 'impeach',
  // Hot-button issues
  'abortion', 'pro-life', 'pro-choice', 'roe v wade',
  'gun control', 'second amendment', '2nd amendment',
  'immigration', 'border wall', 'deportation', 'refugee', 'asylum',
  'climate change denial', 'woke', 'anti-woke', 'dei',
  'critical race theory', 'crt', 'defund police',
  'blm', 'black lives matter', 'antifa', 'proud boys',
  // International politics
  'putin', 'zelensky', 'xi jinping', 'netanyahu', 'gaza', 'palestine',
  'hamas', 'hezbollah', 'sanctions', 'nato', 'ukraine war', 'israel',
  // General political terms
  'partisan', 'bipartisan', 'lobbyist', 'political', 'politician', 'legislation',
  'government shutdown', 'filibuster', 'gerrymandering',
  'first lady', 'melania', 'jill biden', 'president biden', 'president trump',
  'doj', 'department of justice', 'attorney general', 'epstein',
  'classified documents', 'mar-a-lago', 'indictment', 'arraignment',
  // Korean politics
  '정치', '대통령', '국회', '여당', '야당', '보수', '진보', '탄핵', '선거', '투표',
  '국민의힘', '더불어민주당', '민주당', '좌파', '우파',
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
  repliesDeletedByParent: number
  repliesDeletedBySelf: number
  quotePostsDeleted: number
  directPostsDeleted: number
  repostsDeleted: number
  likesScanned: number
  likesRemoved: number
  dbRowsFlagged: number
  errors: string[]
}

type DeletionType = 'reply_political_parent' | 'reply_political_self' | 'quote_post'
  | 'direct_post' | 'repost' | 'like'

interface DeletedRecord {
  handle: string
  type: DeletionType
  uri: string
  text: string
  matchedKeyword: string
  reason: string
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
      const value = (record.value ?? record) as Record<string, unknown>
      if (typeof value.text === 'string') texts.push(value.text)

      // Check embeds within the quoted post
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
    // Also check media portion for external links
    const media = embed.media as Record<string, unknown> | undefined
    if (media) {
      texts.push(extractEmbeddedText(media))
    }
  }

  // app.bsky.embed.external#view — link card embed
  if (embed.$type === 'app.bsky.embed.external#view' || embed.$type === 'app.bsky.embed.external') {
    const external = (embed.external ?? embed) as Record<string, unknown> | undefined
    if (external) {
      if (typeof external.title === 'string') texts.push(external.title)
      if (typeof external.description === 'string') texts.push(external.description)
      if (typeof external.uri === 'string') texts.push(external.uri)
    }
  }

  return texts.filter(Boolean).join(' ')
}

// ─── Fetch parent/root posts for replies ────────────────────

async function fetchPostTexts(
  agent: AtpAgent,
  uris: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (uris.length === 0) return result

  // app.bsky.feed.getPosts supports up to 25 URIs at a time
  const batches: string[][] = []
  for (let i = 0; i < uris.length; i += 25) {
    batches.push(uris.slice(i, i + 25))
  }

  for (const batch of batches) {
    try {
      const response = await agent.getPosts({ uris: batch })
      for (const post of response.data.posts) {
        const record = post.record as { text?: string }
        const postText = record?.text ?? ''
        const embed = (post as Record<string, unknown>).embed as Record<string, unknown> | undefined
        const embeddedText = extractEmbeddedText(embed)
        result.set(post.uri, `${postText} ${embeddedText}`)
      }
      await sleep(200)
    } catch {
      // Some posts may have been deleted, continue
    }
  }

  return result
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
    repliesDeletedByParent: 0,
    repliesDeletedBySelf: 0,
    quotePostsDeleted: 0,
    directPostsDeleted: 0,
    repostsDeleted: 0,
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

  // Track URIs we've already deleted to avoid double-processing
  const deletedUris = new Set<string>()

  // ─── Phase 1: Scan author feed ────────────────────────────
  //   Covers: direct posts, replies (check parent/root), quote posts, link embeds

  console.log(`  Phase 1: Scanning author feed (posts, replies, quotes, embeds)...`)

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

      // Collect parent/root URIs for all replies in this page
      const parentUrisToFetch: string[] = []
      const replyInfoMap = new Map<string, { parentUri?: string; rootUri?: string }>()

      for (const item of feed) {
        const record = item.post.record as Record<string, unknown>
        const reply = record?.reply as { parent?: { uri?: string }; root?: { uri?: string } } | undefined
        if (reply) {
          const parentUri = reply.parent?.uri
          const rootUri = reply.root?.uri
          replyInfoMap.set(item.post.uri, { parentUri, rootUri })
          if (parentUri) parentUrisToFetch.push(parentUri)
          if (rootUri && rootUri !== parentUri) parentUrisToFetch.push(rootUri)
        }
      }

      // Batch-fetch parent/root posts
      const uniqueUris = [...new Set(parentUrisToFetch)]
      const parentTexts = await fetchPostTexts(agent, uniqueUris)

      for (const item of feed) {
        stats.feedItemsScanned++

        const record = item.post.record as { text?: string }
        const postText = record?.text ?? ''
        const embed = (item.post as Record<string, unknown>).embed as Record<string, unknown> | undefined
        const embeddedText = extractEmbeddedText(embed)
        const selfCombinedText = `${postText} ${embeddedText}`
        const postUri = item.post.uri

        // Skip if it's a repost shown in feed (handle in Phase 3)
        const reason = item.reason as Record<string, unknown> | undefined
        if (reason?.$type === 'app.bsky.feed.defs#reasonRepost') continue

        const isQuotePost = embed?.$type === 'app.bsky.embed.record#view'
          || embed?.$type === 'app.bsky.embed.recordWithMedia#view'

        const replyInfo = replyInfoMap.get(postUri)
        const isReply = !!replyInfo

        if (isReply && replyInfo) {
          // ─── REPLY: check parent and root post content ─────
          const parentText = replyInfo.parentUri ? (parentTexts.get(replyInfo.parentUri) ?? '') : ''
          const rootText = replyInfo.rootUri ? (parentTexts.get(replyInfo.rootUri) ?? '') : ''

          // Check if parent or root is political
          const parentKeyword = findMatchedKeyword(parentText)
          const rootKeyword = findMatchedKeyword(rootText)
          const selfKeyword = findMatchedKeyword(selfCombinedText)

          const politicalContext = parentKeyword ?? rootKeyword
          if (politicalContext) {
            const preview = selfCombinedText.slice(0, 120).replace(/\n/g, ' ')
            const parentPreview = parentText.slice(0, 80).replace(/\n/g, ' ')

            deletionLog.push({
              handle: bot.handle,
              type: 'reply_political_parent',
              uri: postUri,
              text: preview,
              matchedKeyword: politicalContext,
              reason: `Reply to political content: "${parentPreview}"`,
            })

            try {
              await agent.deletePost(postUri)
              stats.repliesDeletedByParent++
              deletedUris.add(postUri)
              console.log(`    DELETED reply (political parent): "${preview}" [keyword: ${politicalContext}]`)
              await sleep(500)
            } catch (delErr) {
              const msg = delErr instanceof Error ? delErr.message : String(delErr)
              stats.errors.push(`Failed to delete reply ${postUri}: ${msg}`)
            }
          } else if (selfKeyword && !deletedUris.has(postUri)) {
            // Reply's own text is political
            const preview = selfCombinedText.slice(0, 120).replace(/\n/g, ' ')

            deletionLog.push({
              handle: bot.handle,
              type: 'reply_political_self',
              uri: postUri,
              text: preview,
              matchedKeyword: selfKeyword,
              reason: 'Reply text itself contains political content',
            })

            try {
              await agent.deletePost(postUri)
              stats.repliesDeletedBySelf++
              deletedUris.add(postUri)
              console.log(`    DELETED reply (political self): "${preview}" [keyword: ${selfKeyword}]`)
              await sleep(500)
            } catch (delErr) {
              const msg = delErr instanceof Error ? delErr.message : String(delErr)
              stats.errors.push(`Failed to delete reply ${postUri}: ${msg}`)
            }
          }
        } else if (isQuotePost) {
          // ─── QUOTE POST: check embedded post text ──────────
          const matchedKeyword = findMatchedKeyword(selfCombinedText)
          if (matchedKeyword) {
            const preview = selfCombinedText.slice(0, 120).replace(/\n/g, ' ')

            deletionLog.push({
              handle: bot.handle,
              type: 'quote_post',
              uri: postUri,
              text: preview,
              matchedKeyword,
              reason: 'Quote post with political content in quoted or own text',
            })

            try {
              await agent.deletePost(postUri)
              stats.quotePostsDeleted++
              deletedUris.add(postUri)
              console.log(`    DELETED quote post: "${preview}" [keyword: ${matchedKeyword}]`)
              await sleep(500)
            } catch (delErr) {
              const msg = delErr instanceof Error ? delErr.message : String(delErr)
              stats.errors.push(`Failed to delete quote post ${postUri}: ${msg}`)
            }
          }
        } else {
          // ─── DIRECT POST: check own text + link embeds ─────
          const matchedKeyword = findMatchedKeyword(selfCombinedText)
          if (matchedKeyword) {
            const preview = selfCombinedText.slice(0, 120).replace(/\n/g, ' ')

            deletionLog.push({
              handle: bot.handle,
              type: 'direct_post',
              uri: postUri,
              text: preview,
              matchedKeyword,
              reason: 'Direct post with political content',
            })

            try {
              await agent.deletePost(postUri)
              stats.directPostsDeleted++
              deletedUris.add(postUri)
              console.log(`    DELETED direct post: "${preview}" [keyword: ${matchedKeyword}]`)
              await sleep(500)
            } catch (delErr) {
              const msg = delErr instanceof Error ? delErr.message : String(delErr)
              stats.errors.push(`Failed to delete post ${postUri}: ${msg}`)
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

  // ─── Phase 2: Scan and remove political likes ─────────────

  console.log(`  Phase 2: Scanning likes...`)

  try {
    let cursor: string | undefined
    let pageCount = 0
    const maxPages = 5

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
        const postText = record?.text ?? ''
        const embed = (item.post as Record<string, unknown>).embed as Record<string, unknown> | undefined
        const embeddedText = extractEmbeddedText(embed)
        const combinedText = `${postText} ${embeddedText}`

        const matchedKeyword = findMatchedKeyword(combinedText)
        if (matchedKeyword) {
          const preview = combinedText.slice(0, 120).replace(/\n/g, ' ')

          deletionLog.push({
            handle: bot.handle,
            type: 'like',
            uri: item.post.uri,
            text: preview,
            matchedKeyword,
            reason: 'Liked a political post',
          })

          try {
            const likeUri = item.post.viewer?.like
            if (likeUri) {
              await agent.deleteLike(likeUri)
              stats.likesRemoved++
              console.log(`    UNLIKED: "${preview}" [keyword: ${matchedKeyword}]`)
              await sleep(500)
            }
          } catch (delErr) {
            const msg = delErr instanceof Error ? delErr.message : String(delErr)
            stats.errors.push(`Failed to unlike ${item.post.uri}: ${msg}`)
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

  // ─── Phase 3: Scan and delete political repost records ────

  console.log(`  Phase 3: Scanning repost records...`)

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

      // Batch-fetch original posts
      const subjectUris = records.map(r => r.value.subject.uri)
      const originalTexts = await fetchPostTexts(agent, subjectUris)

      for (const record of records) {
        const repostRecordUri = record.uri
        const subjectUri = record.value.subject.uri
        const combinedText = originalTexts.get(subjectUri) ?? ''

        const matchedKeyword = findMatchedKeyword(combinedText)
        if (matchedKeyword) {
          const preview = combinedText.slice(0, 120).replace(/\n/g, ' ')

          deletionLog.push({
            handle: bot.handle,
            type: 'repost',
            uri: subjectUri,
            text: preview,
            matchedKeyword,
            reason: 'Repost of political content',
          })

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
              stats.errors.push(`Failed to delete repost ${repostRecordUri}: ${msg}`)
            }
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

  // ─── Phase 4: Flag political rows in Supabase ─────────────

  console.log(`  Phase 4: Flagging political entries in database...`)

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
              cleanup_script: 'cleanup-political-all',
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

  console.log(`\n=== Comprehensive Political Content Cleanup ===`)
  console.log(`Found ${activeBots.length} active bots to scan`)
  console.log(`Political keywords: ${POLITICAL_KEYWORDS.length}`)
  console.log(`Checks: own text, reply parents/roots, quotes, link embeds, likes, reposts`)
  console.log()

  const allStats: CleanupStats[] = []
  const deletionLog: DeletedRecord[] = []

  // Process bots sequentially to avoid rate limits
  for (const bot of activeBots) {
    console.log(`--- Scanning @${bot.handle} ---`)
    const stats = await cleanupBot(bot as unknown as BotRow, supabase, deletionLog)
    allStats.push(stats)

    console.log(`  Feed items scanned: ${stats.feedItemsScanned}`)
    console.log(`  Replies deleted (political parent): ${stats.repliesDeletedByParent}`)
    console.log(`  Replies deleted (political self): ${stats.repliesDeletedBySelf}`)
    console.log(`  Quote posts deleted: ${stats.quotePostsDeleted}`)
    console.log(`  Direct posts deleted: ${stats.directPostsDeleted}`)
    console.log(`  Reposts deleted: ${stats.repostsDeleted}`)
    console.log(`  Likes scanned: ${stats.likesScanned}, removed: ${stats.likesRemoved}`)
    console.log(`  DB rows flagged: ${stats.dbRowsFlagged}`)
    if (stats.errors.length > 0) {
      console.log(`  Errors: ${stats.errors.join('; ')}`)
    }
    console.log()
  }

  // ─── Summary ─────────────────────────────────────────────

  console.log(`\n=== SUMMARY ===`)
  const totalRepliesByParent = allStats.reduce((sum, s) => sum + s.repliesDeletedByParent, 0)
  const totalRepliesBySelf = allStats.reduce((sum, s) => sum + s.repliesDeletedBySelf, 0)
  const totalQuotes = allStats.reduce((sum, s) => sum + s.quotePostsDeleted, 0)
  const totalDirect = allStats.reduce((sum, s) => sum + s.directPostsDeleted, 0)
  const totalReposts = allStats.reduce((sum, s) => sum + s.repostsDeleted, 0)
  const totalLikes = allStats.reduce((sum, s) => sum + s.likesRemoved, 0)
  const totalDbFlagged = allStats.reduce((sum, s) => sum + s.dbRowsFlagged, 0)
  const totalErrors = allStats.reduce((sum, s) => sum + s.errors.length, 0)

  const totalDeleted = totalRepliesByParent + totalRepliesBySelf + totalQuotes + totalDirect + totalReposts + totalLikes

  console.log(`Replies deleted (political parent/root): ${totalRepliesByParent}`)
  console.log(`Replies deleted (political self): ${totalRepliesBySelf}`)
  console.log(`Quote posts deleted: ${totalQuotes}`)
  console.log(`Direct posts deleted: ${totalDirect}`)
  console.log(`Reposts deleted: ${totalReposts}`)
  console.log(`Likes removed: ${totalLikes}`)
  console.log(`DB rows flagged: ${totalDbFlagged}`)
  console.log(`TOTAL ITEMS REMOVED: ${totalDeleted}`)
  console.log(`Total errors: ${totalErrors}`)

  // ─── Deletion log ────────────────────────────────────────

  if (deletionLog.length > 0) {
    console.log(`\n=== DELETION LOG (${deletionLog.length} items) ===`)
    for (const entry of deletionLog) {
      console.log(`[@${entry.handle}] ${entry.type.toUpperCase()}: "${entry.text}"`)
      console.log(`  URI: ${entry.uri}`)
      console.log(`  Keyword: "${entry.matchedKeyword}"`)
      console.log(`  Reason: ${entry.reason}`)
    }
  } else {
    console.log(`\nNo political content found. All clean!`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

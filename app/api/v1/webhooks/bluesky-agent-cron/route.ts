/**
 * Bluesky Agent Cron Job Handler
 *
 * QStash-triggered cron that:
 * 1. Proactive: Triggers autonomous posting for all active meme pets
 * 2. Reactive: Polls Bluesky notifications and triggers reply workflows
 * 3. Interaction: Schedules inter-pet interactions
 *
 * Cron schedule (configured via QStash dashboard):
 * - Reactive: every 5 minutes (star-slash-5 * * * *)
 * - Proactive: every 4 hours (0 star-slash-4 * * *)
 *
 * This single endpoint handles both by checking the `mode` query param.
 */

import { NextResponse } from 'next/server'
import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'
import { getServiceSupabase } from '@/lib/api/service-supabase'
import { triggerWorkflow } from '@/lib/workflows/workflow-client'
import { BLUESKY_CONFIG } from '@/lib/config/bluesky.config'
import { BlueskyBotClient, type BlueskyBotConfig } from '@/lib/services/bluesky-client'

export const maxDuration = 300

// QStash signature verification: fail closed in production
const isProduction = process.env.NODE_ENV === 'production'
const hasSigningKeys = !!(process.env.QSTASH_CURRENT_SIGNING_KEY && process.env.QSTASH_NEXT_SIGNING_KEY)

function getHandler() {
  if (isProduction && !hasSigningKeys) {
    return async () => {
      return NextResponse.json(
        { error: 'QStash signing keys missing. Set QSTASH_CURRENT_SIGNING_KEY and QSTASH_NEXT_SIGNING_KEY.' },
        { status: 500 }
      )
    }
  }
  if (isProduction) {
    return verifySignatureAppRouter(async (req: Request) => handleCron(req))
  }
  return async (req: Request) => handleCron(req)
}

export const POST = getHandler()

// ─── Main Handler ──────────────────────────────────

async function handleCron(req: Request) {
  if (!BLUESKY_CONFIG.FEATURE_FLAGS.ENABLED) {
    return NextResponse.json({ message: 'Bluesky agent disabled' })
  }

  const url = new URL(req.url)
  const mode = url.searchParams.get('mode') ?? BLUESKY_CONFIG.AGENT_MODE

  const results = {
    proactive: [] as string[],
    reactive: [] as string[],
    interactions: [] as string[],
    errors: [] as string[]
  }

  try {
    // Load all active meme pet bots
    const activeBots = await loadActiveBots()
    if (activeBots.length === 0) {
      return NextResponse.json({ message: 'No active Bluesky bots' })
    }

    // ── Proactive Posting ────────────────────────
    if (mode === 'proactive' || mode === 'both') {
      for (const bot of activeBots) {
        try {
          // Check if pet should post now (frequency-based scheduling)
          const shouldPost = await shouldPetPostNow(bot.petId, bot.frequency)
          if (!shouldPost) continue

          const { workflowRunId } = await triggerWorkflow(
            '/api/v1/workflows/bluesky-agent',
            {
              mode: 'proactive' as const,
              petId: bot.petId
            },
            'BLUESKY_AGENT',
            { retries: 2 }
          )
          results.proactive.push(`pet:${bot.petId} run:${workflowRunId}`)
        } catch (error) {
          results.errors.push(
            `proactive pet:${bot.petId} error:${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    }

    // ── Reactive (Notification Polling) ────────────
    if (mode === 'reactive' || mode === 'both') {
      for (const bot of activeBots) {
        try {
          const notifications = await pollNotifications(bot)
          for (const notif of notifications) {
            const { workflowRunId } = await triggerWorkflow(
              '/api/v1/workflows/bluesky-agent',
              {
                mode: 'reactive' as const,
                petId: bot.petId,
                notification: {
                  uri: notif.uri,
                  cid: notif.cid,
                  authorHandle: notif.author.handle,
                  authorDid: notif.author.did,
                  text: extractNotificationText(notif),
                  reason: notif.reason as 'mention' | 'reply',
                  rootUri: extractRootUri(notif),
                  rootCid: extractRootCid(notif)
                }
              },
              'BLUESKY_AGENT',
              { retries: 2 }
            )
            results.reactive.push(
              `pet:${bot.petId} notif:${notif.uri} run:${workflowRunId}`
            )
          }
        } catch (error) {
          results.errors.push(
            `reactive pet:${bot.petId} error:${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    }

    // ── Inter-Pet Interactions ──────────────────────
    if ((mode === 'proactive' || mode === 'both') && activeBots.length >= 2) {
      try {
        const interaction = selectInteractionPair(activeBots)
        if (interaction) {
          const { workflowRunId } = await triggerWorkflow(
            '/api/v1/workflows/bluesky-agent',
            {
              mode: 'interaction' as const,
              petId: interaction.initiatorPetId,
              targetPetId: interaction.targetPetId
            },
            'BLUESKY_AGENT',
            { retries: 2 }
          )
          results.interactions.push(
            `${interaction.initiatorPetId}->${interaction.targetPetId} run:${workflowRunId}`
          )
        }
      } catch (error) {
        results.errors.push(
          `interaction error:${error instanceof Error ? error.message : String(error)}`
        )
      }
    }

    return NextResponse.json({
      success: true,
      mode,
      botCount: activeBots.length,
      results
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Cron failed'
      },
      { status: 500 }
    )
  }
}

// ─── Helper Types ──────────────────────────────────

interface ActiveBot {
  petId: string
  handle: string
  did: string | null
  appPassword: string
  frequency: 'high' | 'medium' | 'low'
}

// ─── Data Loading ──────────────────────────────────

async function loadActiveBots(): Promise<ActiveBot[]> {
  const supabase = getServiceSupabase()
  const { data, error } = await (supabase as any)
    .from('bluesky_bot_config')
    .select(`
      pet_id,
      handle,
      did,
      app_password,
      posting_frequency
    `)
    .eq('is_active', true) as { data: Array<{ pet_id: string; handle: string; did: string | null; app_password: string; posting_frequency: string }> | null; error: any }

  if (error || !data) return []

  return data.map(row => ({
    petId: row.pet_id,
    handle: row.handle,
    did: row.did,
    appPassword: row.app_password,
    frequency: (row.posting_frequency as 'high' | 'medium' | 'low') ?? 'medium'
  }))
}

// ─── Scheduling Logic ──────────────────────────────

async function shouldPetPostNow(
  petId: string,
  frequency: 'high' | 'medium' | 'low'
): Promise<boolean> {
  const supabase = getServiceSupabase()

  // Check last proactive post time
  const { data } = await (supabase as any)
    .from('bluesky_post_log')
    .select('created_at')
    .eq('pet_id', petId)
    .eq('activity_type', 'proactive_post')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: { created_at: string } | null }

  if (!data) return true // Never posted, should post

  const lastPostAt = new Date(data.created_at).getTime()
  const now = Date.now()
  const elapsed = now - lastPostAt

  // Minimum interval based on frequency
  // high: 2-3h, medium: 3-6h, low: 8-12h
  const intervals: Record<string, number> = {
    high: 2 * 60 * 60 * 1000,     // 2 hours
    medium: 4 * 60 * 60 * 1000,   // 4 hours
    low: 8 * 60 * 60 * 1000       // 8 hours
  }

  const minInterval = intervals[frequency] ?? intervals.medium

  // Add some randomness (±30%) to avoid all bots posting simultaneously
  const jitter = minInterval * (0.7 + Math.random() * 0.6)

  return elapsed >= jitter
}

// ─── Notification Polling ──────────────────────────

async function pollNotifications(bot: ActiveBot): Promise<Array<{
  uri: string
  cid: string
  author: { handle: string; did: string }
  reason: string
  record: unknown
}>> {
  try {
    const config: BlueskyBotConfig = {
      petId: bot.petId,
      handle: bot.handle,
      did: bot.did ?? undefined,
      appPassword: bot.appPassword
    }
    const client = new BlueskyBotClient(config)
    await client.authenticate()

    const notifications = await client.getUnreadNotifications(20)

    // Filter to mentions and replies only
    const relevant = notifications.filter(
      n => n.reason === 'mention' || n.reason === 'reply'
    )

    // Check which ones we've already processed
    const supabase = getServiceSupabase()
    const uris = relevant.map(n => n.uri)
    const { data: existing } = await (supabase as any)
      .from('bluesky_post_log')
      .select('metadata->>inReplyTo')
      .eq('pet_id', bot.petId)
      .in('metadata->>inReplyTo', uris) as { data: Array<Record<string, string>> | null }

    const processedUris = new Set(
      existing?.map(e => e['inReplyTo']).filter(Boolean) ?? []
    )

    const unprocessed = relevant.filter(n => !processedUris.has(n.uri))

    // Mark as read
    if (unprocessed.length > 0) {
      await client.markNotificationsRead()
    }

    return unprocessed.map(n => ({
      uri: n.uri,
      cid: n.cid,
      author: { handle: n.author.handle, did: n.author.did },
      reason: n.reason,
      record: n.record
    }))
  } catch {
    return []
  }
}

function extractNotificationText(notif: { record: unknown }): string {
  const record = notif.record as { text?: string } | null
  return record?.text ?? ''
}

function extractRootUri(notif: { record: unknown }): string | undefined {
  const record = notif.record as { reply?: { root?: { uri?: string } } } | null
  return record?.reply?.root?.uri
}

function extractRootCid(notif: { record: unknown }): string | undefined {
  const record = notif.record as { reply?: { root?: { cid?: string } } } | null
  return record?.reply?.root?.cid
}

// ─── Interaction Pair Selection ──────────────────────

function selectInteractionPair(
  bots: ActiveBot[]
): { initiatorPetId: string; targetPetId: string } | null {
  if (bots.length < 2) return null

  // Random selection with slight bias toward different pairs
  const initiatorIdx = Math.floor(Math.random() * bots.length)
  let targetIdx = Math.floor(Math.random() * (bots.length - 1))
  if (targetIdx >= initiatorIdx) targetIdx++

  return {
    initiatorPetId: bots[initiatorIdx].petId,
    targetPetId: bots[targetIdx].petId
  }
}

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
import { logWorkflow } from '@/lib/utils/workflow-logger'
import { evaluatePostingDecision, emptyScheduleState, type PetScheduleState, type Chronotype } from '@/lib/agent/posting-rhythm'
import { buildPersonalityFromRow } from '@/lib/agent/pet-personality-builder'
import { decryptIfNeeded } from '@/lib/utils/encrypt'

export const maxDuration = 60

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
    engagements: [] as string[],
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
      const proactiveResults = await Promise.allSettled(activeBots.map(async (bot) => {
        const personality = await loadPetPersonality(bot.petId)
        if (!personality) return null

        const decision = evaluatePostingDecision({
          now: new Date(),
          state: bot.scheduleState,
          frequency: bot.frequency,
          chronotype: bot.chronotype,
          personality,
          utcOffsetHours: bot.utcOffsetHours,
        })

        await persistScheduleState(bot.petId, decision.updatedState)

        if (!decision.shouldPost) return null

        const { workflowRunId } = await triggerWorkflow(
          '/api/v1/workflows/bluesky-agent',
          { mode: 'proactive' as const, petId: bot.petId },
          'BLUESKY_AGENT',
          { retries: 2 }
        )
        return `pet:${bot.petId} run:${workflowRunId} (${decision.reason})`
      }))

      for (let i = 0; i < proactiveResults.length; i++) {
        const result = proactiveResults[i]
        if (result.status === 'fulfilled' && result.value) {
          results.proactive.push(result.value)
        } else if (result.status === 'rejected') {
          const error = result.reason
          results.errors.push(
            `proactive pet:${activeBots[i].petId} error:${error instanceof Error ? error.message : String(error)}`
          )
        }
      }
    }

    // ── Reactive (Notification Polling) ────────────
    if (mode === 'reactive' || mode === 'both') {
      const reactiveResults = await Promise.allSettled(activeBots.map(async (bot) => {
        const notifications = await pollNotifications(bot)
        const botResults: string[] = []
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
          botResults.push(
            `pet:${bot.petId} notif:${notif.uri} run:${workflowRunId}`
          )
        }
        return botResults
      }))

      for (let i = 0; i < reactiveResults.length; i++) {
        const result = reactiveResults[i]
        if (result.status === 'fulfilled') {
          results.reactive.push(...result.value)
        } else {
          const error = result.reason
          results.errors.push(
            `reactive pet:${activeBots[i].petId} error:${error instanceof Error ? error.message : String(error)}`
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

    // ── Proactive Engagement ────────────────────────
    if (mode === 'engagement' || mode === 'both') {
      const engagementResults = await Promise.allSettled(activeBots.map(async (bot) => {
        const shouldEngage = await shouldPetEngageNow(bot.petId)
        if (!shouldEngage) return null

        const { workflowRunId } = await triggerWorkflow(
          '/api/v1/workflows/bluesky-agent',
          { mode: 'engagement' as const, petId: bot.petId },
          'BLUESKY_AGENT',
          { retries: 1 }
        )
        return `pet:${bot.petId} run:${workflowRunId}`
      }))

      for (let i = 0; i < engagementResults.length; i++) {
        const result = engagementResults[i]
        if (result.status === 'fulfilled' && result.value) {
          results.engagements.push(result.value)
        } else if (result.status === 'rejected') {
          const error = result.reason
          results.errors.push(
            `engagement pet:${activeBots[i].petId} error:${error instanceof Error ? error.message : String(error)}`
          )
        }
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
  chronotype: Chronotype
  scheduleState: PetScheduleState
  utcOffsetHours: number
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
      posting_frequency,
      chronotype,
      schedule_state,
      utc_offset_hours
    `)
    .eq('is_active', true) as { data: Array<{
      pet_id: string; handle: string; did: string | null; app_password: string;
      posting_frequency: string; chronotype: string | null;
      schedule_state: Record<string, unknown> | null; utc_offset_hours: number | null
    }> | null; error: any }

  if (error || !data) return []

  const excluded = new Set<string>(BLUESKY_CONFIG.EXCLUDED_HANDLES)

  return data
    .filter(row => !excluded.has(row.handle))
    .map(row => ({
      petId: row.pet_id,
      handle: row.handle,
      did: row.did,
      appPassword: decryptIfNeeded(row.app_password),
      frequency: (row.posting_frequency as 'high' | 'medium' | 'low') ?? 'medium',
      chronotype: (row.chronotype as Chronotype) ?? 'normal',
      scheduleState: (row.schedule_state as unknown as PetScheduleState) ?? emptyScheduleState(),
      utcOffsetHours: row.utc_offset_hours ?? -5,
    }))
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
  } catch (error) {
    const logger = logWorkflow('BLUESKY_AGENT', 'notification-poll', bot.petId)
    logger.error(error, `pollNotifications for ${bot.handle}`)
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

// ─── Scheduling Helpers ──────────────────────────────

async function persistScheduleState(petId: string, state: PetScheduleState): Promise<void> {
  const supabase = getServiceSupabase()
  await (supabase as any)
    .from('bluesky_bot_config')
    .update({ schedule_state: state })
    .eq('pet_id', petId)
}

async function loadPetPersonality(petId: string) {
  const supabase = getServiceSupabase()
  const { data } = await (supabase as any)
    .from('pet')
    .select('personality_type, psyche, meme')
    .eq('id', petId)
    .single() as { data: { personality_type: string | null; psyche: Record<string, unknown> | null; meme: Record<string, unknown> | null } | null }

  if (!data) return null
  return buildPersonalityFromRow(data)
}

async function shouldPetEngageNow(petId: string): Promise<boolean> {
  const supabase = getServiceSupabase()
  const { data } = await (supabase as any)
    .from('bluesky_post_log')
    .select('created_at')
    .eq('pet_id', petId)
    .in('activity_type', ['engagement_comment', 'engagement_like', 'engagement_skipped'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: { created_at: string } | null }

  if (!data) return true
  const elapsed = Date.now() - new Date(data.created_at).getTime()
  const jitter = 90 * 60 * 1000 * (0.8 + Math.random() * 0.4)
  return elapsed >= jitter
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

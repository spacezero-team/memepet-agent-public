/**
 * Bluesky Agent Management Endpoint
 *
 * Manual trigger and management for Bluesky meme pet bots.
 *
 * POST /api/v1/craft/agent/bluesky
 * - Trigger a specific bot action (post, reply, interact)
 * - Configure bot settings
 *
 * GET /api/v1/craft/agent/bluesky
 * - Get status of all active bots
 */

import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/api/service-supabase'
import { triggerWorkflow } from '@/lib/workflows/workflow-client'
import { BLUESKY_CONFIG } from '@/lib/config/bluesky.config'
import type { BlueskyAgentMode } from '@/lib/workflows/bluesky-agent-workflow'

function verifyApiKey(provided: string | null): boolean {
  const expected = process.env.API_KEY
  if (!provided || !expected) return false
  try {
    return timingSafeEqual(
      Buffer.from(provided),
      Buffer.from(expected)
    )
  } catch {
    return false
  }
}

export const maxDuration = 60

/**
 * POST: Trigger a bot action manually
 *
 * Body:
 * - petId: string (required)
 * - mode: 'proactive' | 'reactive' | 'interaction' (default: 'proactive')
 * - targetPetId?: string (required for 'interaction' mode)
 */
export async function POST(req: Request) {
  try {
    // Verify API key
    const apiKey = req.headers.get('x-api-key')
    if (!verifyApiKey(apiKey)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!BLUESKY_CONFIG.FEATURE_FLAGS.ENABLED) {
      return NextResponse.json(
        { error: 'Bluesky agent is disabled' },
        { status: 503 }
      )
    }

    const body = await req.json() as {
      petId: string
      mode?: BlueskyAgentMode
      targetPetId?: string
    }

    if (!body.petId) {
      return NextResponse.json(
        { error: 'petId is required' },
        { status: 400 }
      )
    }

    const mode = body.mode ?? 'proactive'

    const validModes: BlueskyAgentMode[] = ['proactive', 'reactive', 'interaction', 'engagement']
    if (!validModes.includes(mode)) {
      return NextResponse.json(
        { error: `Invalid mode: ${mode}. Must be one of: ${validModes.join(', ')}` },
        { status: 400 }
      )
    }

    if (mode === 'interaction' && !body.targetPetId) {
      return NextResponse.json(
        { error: 'targetPetId is required for interaction mode' },
        { status: 400 }
      )
    }

    // Verify pet exists and has Bluesky config
    const supabase = getServiceSupabase()
    const { data: botConfig } = await (supabase as any)
      .from('bluesky_bot_config')
      .select('pet_id, handle, is_active')
      .eq('pet_id', body.petId)
      .single() as { data: { pet_id: string; handle: string; is_active: boolean } | null }

    if (!botConfig) {
      return NextResponse.json(
        { error: `No Bluesky config for pet ${body.petId}` },
        { status: 404 }
      )
    }

    if (!botConfig.is_active) {
      return NextResponse.json(
        { error: `Bot for pet ${body.petId} is inactive` },
        { status: 403 }
      )
    }

    // Trigger workflow
    const { workflowRunId } = await triggerWorkflow(
      '/api/v1/workflows/bluesky-agent',
      {
        mode,
        petId: body.petId,
        targetPetId: body.targetPetId
      },
      'BLUESKY_AGENT',
      { retries: 2 }
    )

    return NextResponse.json({
      success: true,
      workflowRunId,
      petId: body.petId,
      mode,
      handle: botConfig.handle
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to trigger agent'
      },
      { status: 500 }
    )
  }
}

/**
 * GET: Get status of all active Bluesky bots
 * Requires x-api-key header for authentication.
 */
export async function GET(req: Request) {
  try {
    // Verify API key (same as POST)
    const apiKey = req.headers.get('x-api-key')
    if (!verifyApiKey(apiKey)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const supabase = getServiceSupabase()

    // Get all bot configs with recent activity
    const { data: bots, error } = await (supabase as any)
      .from('bluesky_bot_config')
      .select(`
        pet_id,
        handle,
        did,
        is_active,
        posting_frequency,
        updated_at
      `)
      .order('pet_id', { ascending: true }) as { data: Array<{ pet_id: string; handle: string; did: string | null; is_active: boolean; posting_frequency: string; updated_at: string }> | null; error: any }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Get recent activity counts for each bot
    const botStatuses = await Promise.all(
      (bots ?? []).map(async (bot) => {
        const { count: postsToday } = await (supabase as any)
          .from('bluesky_post_log')
          .select('id', { count: 'exact', head: true })
          .eq('pet_id', bot.pet_id)
          .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) as { count: number | null }

        const { data: lastPost } = await (supabase as any)
          .from('bluesky_post_log')
          .select('created_at, activity_type, content')
          .eq('pet_id', bot.pet_id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle() as { data: { created_at: string; activity_type: string; content: string } | null }

        return {
          petId: bot.pet_id,
          handle: bot.handle,
          did: bot.did,
          isActive: bot.is_active,
          frequency: bot.posting_frequency,
          postsLast24h: postsToday ?? 0,
          lastActivity: lastPost
            ? {
                at: lastPost.created_at,
                type: lastPost.activity_type,
                preview: lastPost.content?.slice(0, 100)
              }
            : null
        }
      })
    )

    return NextResponse.json({
      success: true,
      agentEnabled: BLUESKY_CONFIG.FEATURE_FLAGS.ENABLED,
      agentMode: BLUESKY_CONFIG.AGENT_MODE,
      bots: botStatuses
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get status'
      },
      { status: 500 }
    )
  }
}

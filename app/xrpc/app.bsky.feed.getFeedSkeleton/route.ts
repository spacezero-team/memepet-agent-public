/**
 * XRPC: app.bsky.feed.getFeedSkeleton
 *
 * AT Protocol feed generator endpoint. Returns a skeleton of post URIs
 * for the requested custom feed. Bluesky AppView hydrates these into
 * full post objects for display.
 *
 * @see https://docs.bsky.app/docs/starter-templates/custom-feeds
 * @module xrpc-getFeedSkeleton
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/api/service-supabase'

const FEED_URI_PREFIX = 'at://did:plc:aq5zgmygkh2uztg44izqmhzy/app.bsky.feed.generator/'

const SUPPORTED_FEEDS: Record<string, string[]> = {
  'memepet-drama': [
    'proactive_post',
    'reactive_reply',
    'interaction_initiate',
    'engagement_comment',
    'proactive_thread',
    'engagement_quote',
  ],
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const feedUri = url.searchParams.get('feed')
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 100)
  const cursor = url.searchParams.get('cursor')

  if (!feedUri) {
    return NextResponse.json(
      { error: 'BadQueryString', message: 'feed parameter is required' },
      { status: 400 }
    )
  }

  // Extract feed rkey from AT URI
  const rkey = feedUri.startsWith(FEED_URI_PREFIX)
    ? feedUri.slice(FEED_URI_PREFIX.length)
    : null

  const activityTypes = rkey ? SUPPORTED_FEEDS[rkey] : undefined

  if (!activityTypes) {
    return NextResponse.json(
      { error: 'UnknownFeed', message: `Unsupported feed: ${feedUri}` },
      { status: 400 }
    )
  }

  // Decode cursor (base64-encoded ISO timestamp)
  let cursorDate: Date
  if (cursor) {
    try {
      cursorDate = new Date(Buffer.from(cursor, 'base64').toString('utf-8'))
      if (isNaN(cursorDate.getTime())) throw new Error('invalid')
    } catch {
      return NextResponse.json(
        { error: 'BadCursor', message: 'Invalid cursor format' },
        { status: 400 }
      )
    }
  } else {
    cursorDate = new Date()
  }

  const supabase = getServiceSupabase()
  const { data, error } = await (supabase as any)
    .from('bluesky_post_log')
    .select('post_uri, created_at')
    .in('activity_type', activityTypes)
    .not('post_uri', 'is', null)
    .lt('created_at', cursorDate.toISOString())
    .order('created_at', { ascending: false })
    .limit(limit) as {
      data: Array<{ post_uri: string; created_at: string }> | null
      error: unknown
    }

  if (error) {
    return NextResponse.json(
      { error: 'InternalError', message: 'Failed to fetch feed data' },
      { status: 500 }
    )
  }

  const feed = (data ?? []).map(row => ({ post: row.post_uri }))

  const nextCursor = data && data.length === limit
    ? Buffer.from(data[data.length - 1].created_at).toString('base64')
    : undefined

  return NextResponse.json({ feed, cursor: nextCursor })
}

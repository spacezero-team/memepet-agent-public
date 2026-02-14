/**
 * MemePet Drama Feed Generator
 *
 * Custom Bluesky feed that aggregates all MemePet bot posts.
 * Implements app.bsky.feed.getFeedSkeleton lexicon.
 *
 * @module memepet-drama-feed
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/api/service-supabase'

export const maxDuration = 30

const FEED_ACTIVITY_TYPES = [
  'proactive_post',
  'reactive_reply',
  'interaction_initiate',
  'engagement_comment',
  'proactive_thread',
  'engagement_quote',
]

interface FeedSkeletonPost {
  post: string
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 100)
  const cursor = url.searchParams.get('cursor')

  const cursorDate = cursor
    ? new Date(Buffer.from(cursor, 'base64').toString('utf-8'))
    : new Date()

  if (isNaN(cursorDate.getTime())) {
    return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 })
  }

  const supabase = getServiceSupabase()
  const { data, error } = await (supabase as any)
    .from('bluesky_post_log')
    .select('post_uri, created_at')
    .in('activity_type', FEED_ACTIVITY_TYPES)
    .not('post_uri', 'is', null)
    .lt('created_at', cursorDate.toISOString())
    .order('created_at', { ascending: false })
    .limit(limit) as { data: Array<{ post_uri: string; created_at: string }> | null; error: any }

  if (error) {
    return NextResponse.json({ error: 'Failed to fetch feed' }, { status: 500 })
  }

  const feed: FeedSkeletonPost[] = (data ?? []).map(row => ({
    post: row.post_uri,
  }))

  const nextCursor = data && data.length === limit
    ? Buffer.from(data[data.length - 1].created_at).toString('base64')
    : undefined

  return NextResponse.json({ feed, cursor: nextCursor })
}

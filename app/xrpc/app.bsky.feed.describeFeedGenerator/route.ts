/**
 * XRPC: app.bsky.feed.describeFeedGenerator
 *
 * Describes the feeds served by this feed generator.
 * Required by the AT Protocol feed generator spec.
 *
 * @see https://docs.bsky.app/docs/starter-templates/custom-feeds
 * @module xrpc-describeFeedGenerator
 */

import { NextResponse } from 'next/server'

const PUBLISHER_DID = 'did:plc:aq5zgmygkh2uztg44izqmhzy'
const FEED_HOSTNAME = process.env.FEED_HOSTNAME ?? 'memepet.0.space'
const SERVICE_DID = `did:web:${FEED_HOSTNAME}`

export async function GET() {
  return NextResponse.json({
    did: SERVICE_DID,
    feeds: [
      {
        uri: `at://${PUBLISHER_DID}/app.bsky.feed.generator/memepet-drama`,
      },
    ],
  })
}

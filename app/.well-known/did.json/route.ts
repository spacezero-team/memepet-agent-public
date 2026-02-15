/**
 * DID Document endpoint for feed generator
 *
 * Serves did:web document at /.well-known/did.json
 * Required for AT Protocol feed generator registration.
 *
 * @module did-document
 */

import { NextResponse } from 'next/server'

const FEED_HOSTNAME = process.env.FEED_HOSTNAME ?? 'memepet-agent.0.space'

export async function GET() {
  const serviceDid = `did:web:${FEED_HOSTNAME}`
  const serviceEndpoint = `https://${FEED_HOSTNAME}`

  return NextResponse.json({
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: serviceDid,
    service: [
      {
        id: '#bsky_fg',
        type: 'BskyFeedGenerator',
        serviceEndpoint,
      },
    ],
  })
}

/**
 * AT Protocol Handle Resolution Proxy
 *
 * Resolves bot handles (*.0.space) by querying the PDS resolveHandle endpoint.
 * Returns the DID as text/plain for AT Protocol handle verification.
 *
 * @module atproto-did
 */

import { NextRequest, NextResponse } from 'next/server'

const PDS_URL = process.env.PDS_URL ?? 'https://pds.0.space'

export async function GET(request: NextRequest) {
  const hostname = request.headers.get('host')?.split(':')[0] ?? ''

  if (!hostname.endsWith('.0.space') || hostname === '0.space' || hostname === 'pds.0.space') {
    return new NextResponse('Not found', { status: 404 })
  }

  try {
    const response = await fetch(
      `${PDS_URL}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(hostname)}`,
      { signal: AbortSignal.timeout(5000) }
    )

    if (!response.ok) {
      return new NextResponse('User not found', { status: 404 })
    }

    const data = await response.json() as { did?: string }

    if (!data.did) {
      return new NextResponse('User not found', { status: 404 })
    }

    return new NextResponse(data.did, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  } catch {
    return new NextResponse('PDS unavailable', { status: 502 })
  }
}

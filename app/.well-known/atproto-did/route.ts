/**
 * AT Protocol Handle Resolution Proxy
 *
 * Proxies .well-known/atproto-did requests to the PDS server
 * so bot handles (*.0.space) can be verified by the AT Protocol network.
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
    const response = await fetch(`${PDS_URL}/.well-known/atproto-did`, {
      headers: { Host: hostname },
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      return new NextResponse('User not found', { status: 404 })
    }

    const did = await response.text()

    return new NextResponse(did.trim(), {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
  } catch {
    return new NextResponse('PDS unavailable', { status: 502 })
  }
}

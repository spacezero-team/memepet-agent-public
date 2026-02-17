/**
 * Feed Generator Endpoint Tests
 *
 * Regression tests for the Bluesky custom feed generator endpoints.
 * These tests ensure that domain changes (FEED_HOSTNAME) don't silently
 * break the feed by verifying DID consistency across all three endpoints.
 *
 * @module feed-generator-tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Constants (must match source files)
// ---------------------------------------------------------------------------

const DEFAULT_HOSTNAME = 'memepet.0.space'
const PUBLISHER_DID = 'did:plc:aq5zgmygkh2uztg44izqmhzy'
const FEED_URI_PREFIX = `at://${PUBLISHER_DID}/app.bsky.feed.generator/`

// ---------------------------------------------------------------------------
// Mock: Supabase
// ---------------------------------------------------------------------------

const mockSelect = vi.fn()
const mockIn = vi.fn()
const mockNot = vi.fn()
const mockLt = vi.fn()
const mockOrder = vi.fn()
const mockLimit = vi.fn()

const mockSupabaseChain = {
  select: mockSelect,
  in: mockIn,
  not: mockNot,
  lt: mockLt,
  order: mockOrder,
  limit: mockLimit,
}

vi.mock('@/lib/api/service-supabase', () => ({
  getServiceSupabase: vi.fn(() => ({
    from: vi.fn(() => mockSupabaseChain),
  })),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Dynamically import a route handler with a fresh module cache.
 * This ensures each test picks up its own `process.env.FEED_HOSTNAME` value.
 */
async function importDidRoute() {
  return await import('../app/.well-known/did.json/route')
}

async function importDescribeRoute() {
  return await import('../app/xrpc/app.bsky.feed.describeFeedGenerator/route')
}

async function importSkeletonRoute() {
  return await import('../app/xrpc/app.bsky.feed.getFeedSkeleton/route')
}

function makeRequest(url: string): Request {
  return new Request(url)
}

// ---------------------------------------------------------------------------
// Supabase mock helpers
// ---------------------------------------------------------------------------

function setupSupabaseMock(
  data: Array<{ post_uri: string; created_at: string }> | null,
  error: unknown = null,
) {
  // Each chained method returns the chain, except limit which resolves
  mockSelect.mockReturnValue(mockSupabaseChain)
  mockIn.mockReturnValue(mockSupabaseChain)
  mockNot.mockReturnValue(mockSupabaseChain)
  mockLt.mockReturnValue(mockSupabaseChain)
  mockOrder.mockReturnValue(mockSupabaseChain)
  mockLimit.mockResolvedValue({ data, error })
}

// ---------------------------------------------------------------------------
// 1. DID Document Tests — /.well-known/did.json
// ---------------------------------------------------------------------------

describe('GET /.well-known/did.json', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.FEED_HOSTNAME
  })

  it('returns a valid DID document with default hostname', async () => {
    const { GET } = await importDidRoute()
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body['@context']).toEqual(['https://www.w3.org/ns/did/v1'])
    expect(body.id).toBe(`did:web:${DEFAULT_HOSTNAME}`)
  })

  it('includes a BskyFeedGenerator service entry', async () => {
    const { GET } = await importDidRoute()
    const response = await GET()
    const body = await response.json()

    expect(body.service).toHaveLength(1)

    const service = body.service[0]
    expect(service.id).toBe('#bsky_fg')
    expect(service.type).toBe('BskyFeedGenerator')
    expect(service.serviceEndpoint).toBe(`https://${DEFAULT_HOSTNAME}`)
  })

  it('service endpoint matches the FEED_HOSTNAME', async () => {
    const { GET } = await importDidRoute()
    const response = await GET()
    const body = await response.json()

    const expectedDid = `did:web:${DEFAULT_HOSTNAME}`
    const expectedEndpoint = `https://${DEFAULT_HOSTNAME}`

    expect(body.id).toBe(expectedDid)
    expect(body.service[0].serviceEndpoint).toBe(expectedEndpoint)
  })

  it('respects FEED_HOSTNAME env override', async () => {
    process.env.FEED_HOSTNAME = 'custom-host.example.com'
    const { GET } = await importDidRoute()
    const response = await GET()
    const body = await response.json()

    expect(body.id).toBe('did:web:custom-host.example.com')
    expect(body.service[0].serviceEndpoint).toBe('https://custom-host.example.com')
  })
})

// ---------------------------------------------------------------------------
// 2. describeFeedGenerator Tests
// ---------------------------------------------------------------------------

describe('GET /xrpc/app.bsky.feed.describeFeedGenerator', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.FEED_HOSTNAME
  })

  it('returns a valid response with feeds array', async () => {
    const { GET } = await importDescribeRoute()
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.did).toBeDefined()
    expect(body.feeds).toBeInstanceOf(Array)
    expect(body.feeds.length).toBeGreaterThan(0)
  })

  it('DID matches FEED_HOSTNAME', async () => {
    const { GET } = await importDescribeRoute()
    const response = await GET()
    const body = await response.json()

    expect(body.did).toBe(`did:web:${DEFAULT_HOSTNAME}`)
  })

  it('includes the memepet-drama feed', async () => {
    const { GET } = await importDescribeRoute()
    const response = await GET()
    const body = await response.json()

    const feedUris = body.feeds.map((f: { uri: string }) => f.uri)
    expect(feedUris).toContain(
      `at://${PUBLISHER_DID}/app.bsky.feed.generator/memepet-drama`,
    )
  })

  it('feed URIs use the PUBLISHER_DID (not the service DID)', async () => {
    const { GET } = await importDescribeRoute()
    const response = await GET()
    const body = await response.json()

    for (const feed of body.feeds) {
      expect(feed.uri).toMatch(new RegExp(`^at://${PUBLISHER_DID}/`))
    }
  })

  it('respects FEED_HOSTNAME env override', async () => {
    process.env.FEED_HOSTNAME = 'other.example.com'
    const { GET } = await importDescribeRoute()
    const response = await GET()
    const body = await response.json()

    expect(body.did).toBe('did:web:other.example.com')
  })
})

// ---------------------------------------------------------------------------
// 3. getFeedSkeleton Tests
// ---------------------------------------------------------------------------

describe('GET /xrpc/app.bsky.feed.getFeedSkeleton', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    delete process.env.FEED_HOSTNAME
  })

  it('returns 400 when feed param is missing', async () => {
    const { GET } = await importSkeletonRoute()
    const request = makeRequest('http://localhost/xrpc/app.bsky.feed.getFeedSkeleton')
    const response = await GET(request as any)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('BadQueryString')
  })

  it('returns 400 for unsupported feed', async () => {
    const { GET } = await importSkeletonRoute()
    const request = makeRequest(
      `http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?feed=${FEED_URI_PREFIX}nonexistent-feed`,
    )
    const response = await GET(request as any)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('UnknownFeed')
  })

  it('returns 400 for feed URI with wrong DID prefix', async () => {
    const { GET } = await importSkeletonRoute()
    const request = makeRequest(
      'http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://did:plc:wrong/app.bsky.feed.generator/memepet-drama',
    )
    const response = await GET(request as any)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('UnknownFeed')
  })

  it('returns valid skeleton for memepet-drama feed', async () => {
    const mockData = [
      { post_uri: 'at://did:plc:abc/app.bsky.feed.post/1', created_at: '2025-01-15T10:00:00Z' },
      { post_uri: 'at://did:plc:abc/app.bsky.feed.post/2', created_at: '2025-01-15T09:00:00Z' },
    ]
    setupSupabaseMock(mockData)

    const { GET } = await importSkeletonRoute()
    const request = makeRequest(
      `http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?feed=${FEED_URI_PREFIX}memepet-drama`,
    )
    const response = await GET(request as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.feed).toHaveLength(2)
    expect(body.feed[0]).toEqual({ post: mockData[0].post_uri })
    expect(body.feed[1]).toEqual({ post: mockData[1].post_uri })
  })

  it('returns cursor when results match limit', async () => {
    // Default limit is 30, so return exactly 30 items to trigger cursor
    const mockData = Array.from({ length: 30 }, (_, i) => ({
      post_uri: `at://did:plc:abc/app.bsky.feed.post/${i}`,
      created_at: new Date(2025, 0, 15, 10, 0, 0 - i).toISOString(),
    }))
    setupSupabaseMock(mockData)

    const { GET } = await importSkeletonRoute()
    const request = makeRequest(
      `http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?feed=${FEED_URI_PREFIX}memepet-drama`,
    )
    const response = await GET(request as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.cursor).toBeDefined()

    // Cursor should be base64-encoded created_at of last item
    const decodedCursor = Buffer.from(body.cursor, 'base64').toString('utf-8')
    expect(decodedCursor).toBe(mockData[29].created_at)
  })

  it('does not return cursor when results are fewer than limit', async () => {
    const mockData = [
      { post_uri: 'at://did:plc:abc/app.bsky.feed.post/1', created_at: '2025-01-15T10:00:00Z' },
    ]
    setupSupabaseMock(mockData)

    const { GET } = await importSkeletonRoute()
    const request = makeRequest(
      `http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?feed=${FEED_URI_PREFIX}memepet-drama`,
    )
    const response = await GET(request as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.cursor).toBeUndefined()
  })

  it('accepts cursor parameter for pagination', async () => {
    const cursorDate = '2025-01-15T09:00:00Z'
    const encodedCursor = Buffer.from(cursorDate).toString('base64')
    const mockData = [
      { post_uri: 'at://did:plc:abc/app.bsky.feed.post/3', created_at: '2025-01-15T08:00:00Z' },
    ]
    setupSupabaseMock(mockData)

    const { GET } = await importSkeletonRoute()
    const request = makeRequest(
      `http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?feed=${FEED_URI_PREFIX}memepet-drama&cursor=${encodedCursor}`,
    )
    const response = await GET(request as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.feed).toHaveLength(1)

    // Verify the lt filter was called with the cursor date
    expect(mockLt).toHaveBeenCalledWith('created_at', new Date(cursorDate).toISOString())
  })

  it('returns 400 for invalid cursor', async () => {
    const { GET } = await importSkeletonRoute()
    const request = makeRequest(
      `http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?feed=${FEED_URI_PREFIX}memepet-drama&cursor=not-valid-base64!!!`,
    )
    const response = await GET(request as any)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('BadCursor')
  })

  it('clamps limit=200 down to 100', async () => {
    setupSupabaseMock([])

    const { GET } = await importSkeletonRoute()
    const request = makeRequest(
      `http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?feed=${FEED_URI_PREFIX}memepet-drama&limit=200`,
    )
    await GET(request as any)
    expect(mockLimit).toHaveBeenCalledWith(100)
  })

  it('defaults to 30 when limit is 0 or missing', async () => {
    setupSupabaseMock([])

    const { GET } = await importSkeletonRoute()

    // limit=0 is falsy, so Number(0) || 30 => 30
    const request = makeRequest(
      `http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?feed=${FEED_URI_PREFIX}memepet-drama&limit=0`,
    )
    await GET(request as any)
    expect(mockLimit).toHaveBeenCalledWith(30)
  })

  it('clamps negative limit to 1', async () => {
    setupSupabaseMock([])

    const { GET } = await importSkeletonRoute()
    const request = makeRequest(
      `http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?feed=${FEED_URI_PREFIX}memepet-drama&limit=-5`,
    )
    await GET(request as any)
    expect(mockLimit).toHaveBeenCalledWith(1)
  })

  it('returns empty feed when Supabase returns no data', async () => {
    setupSupabaseMock(null)

    const { GET } = await importSkeletonRoute()
    const request = makeRequest(
      `http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?feed=${FEED_URI_PREFIX}memepet-drama`,
    )
    const response = await GET(request as any)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.feed).toEqual([])
  })

  it('returns 500 when Supabase returns error', async () => {
    setupSupabaseMock(null, { message: 'connection refused' })

    const { GET } = await importSkeletonRoute()
    const request = makeRequest(
      `http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?feed=${FEED_URI_PREFIX}memepet-drama`,
    )
    const response = await GET(request as any)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe('InternalError')
  })

  it('queries only the expected activity types for memepet-drama', async () => {
    setupSupabaseMock([])

    const { GET } = await importSkeletonRoute()
    const request = makeRequest(
      `http://localhost/xrpc/app.bsky.feed.getFeedSkeleton?feed=${FEED_URI_PREFIX}memepet-drama`,
    )
    await GET(request as any)

    expect(mockIn).toHaveBeenCalledWith('activity_type', [
      'proactive_post',
      'reactive_reply',
      'interaction_initiate',
      'engagement_comment',
      'proactive_thread',
      'engagement_quote',
    ])
  })
})

// ---------------------------------------------------------------------------
// 4. Cross-Endpoint Consistency Tests
// ---------------------------------------------------------------------------

describe('Cross-endpoint consistency', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.FEED_HOSTNAME
  })

  it('SERVICE_DID in describeFeedGenerator matches DID in did.json', async () => {
    const [didModule, describeModule] = await Promise.all([
      importDidRoute(),
      importDescribeRoute(),
    ])

    const didResponse = await didModule.GET()
    const describeResponse = await describeModule.GET()

    const didBody = await didResponse.json()
    const describeBody = await describeResponse.json()

    expect(describeBody.did).toBe(didBody.id)
  })

  it('feed URI prefix in getFeedSkeleton uses the correct PUBLISHER_DID', async () => {
    const describeModule = await importDescribeRoute()
    const describeResponse = await describeModule.GET()
    const describeBody = await describeResponse.json()

    // The feed URI from describeFeedGenerator should start with the same
    // PUBLISHER_DID prefix used in getFeedSkeleton
    for (const feed of describeBody.feeds) {
      expect(feed.uri).toMatch(new RegExp(`^at://${PUBLISHER_DID}/`))
    }
  })

  it('DID document service DID differs from PUBLISHER_DID', async () => {
    // The service DID (did:web:...) should NOT equal the PUBLISHER_DID (did:plc:...)
    // They serve different purposes: service DID identifies the feed server,
    // PUBLISHER_DID identifies the account that published the feed record
    const didModule = await importDidRoute()
    const didResponse = await didModule.GET()
    const didBody = await didResponse.json()

    expect(didBody.id).not.toBe(PUBLISHER_DID)
    expect(didBody.id).toMatch(/^did:web:/)
  })

  it('all endpoints use consistent FEED_HOSTNAME when env is set', async () => {
    process.env.FEED_HOSTNAME = 'test-host.example.com'

    const [didModule, describeModule] = await Promise.all([
      importDidRoute(),
      importDescribeRoute(),
    ])

    const didResponse = await didModule.GET()
    const describeResponse = await describeModule.GET()

    const didBody = await didResponse.json()
    const describeBody = await describeResponse.json()

    const expectedDid = 'did:web:test-host.example.com'

    expect(didBody.id).toBe(expectedDid)
    expect(describeBody.did).toBe(expectedDid)
    expect(didBody.service[0].serviceEndpoint).toBe('https://test-host.example.com')
  })
})

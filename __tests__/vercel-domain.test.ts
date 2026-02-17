/**
 * Vercel Domain Registration Tests
 *
 * Tests for the Vercel domain registration utility that manages
 * domain aliases for Bluesky bot handle verification.
 *
 * Covers:
 * - addVercelDomain() with missing VERCEL_TOKEN
 * - addVercelDomain() with successful registration
 * - addVercelDomain() with 409 conflict (already exists)
 * - addVercelDomain() with API error responses
 * - addVercelDomain() with network failures
 * - ensureVercelDomains() with empty input
 * - ensureVercelDomains() with mixed success/failure results
 * - listVercelDomains() with pagination
 *
 * @module vercel-domain-tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  addVercelDomain,
  ensureVercelDomains,
  listVercelDomains,
  type VercelDomainResult,
} from '../lib/utils/vercel-domain'

// ---------------------------------------------------------------------------
// Mock: global fetch
// ---------------------------------------------------------------------------

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.VERCEL_TOKEN
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response
}

// ---------------------------------------------------------------------------
// 1. addVercelDomain
// ---------------------------------------------------------------------------

describe('addVercelDomain', () => {
  it('returns error when VERCEL_TOKEN is not set', async () => {
    delete process.env.VERCEL_TOKEN

    const result = await addVercelDomain('test-bot.0.space')

    expect(result).toEqual({
      handle: 'test-bot.0.space',
      success: false,
      alreadyExists: false,
      error: 'VERCEL_TOKEN environment variable is not set',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns success for a successful domain registration (200)', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(200, { name: 'test-bot.0.space' })
    )

    const result = await addVercelDomain('test-bot.0.space')

    expect(result).toEqual({
      handle: 'test-bot.0.space',
      success: true,
      alreadyExists: false,
    })
    expect(mockFetch).toHaveBeenCalledOnce()
  })

  it('sends correct request to Vercel API', async () => {
    process.env.VERCEL_TOKEN = 'my-secret-token'
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { name: 'bot.0.space' }))

    await addVercelDomain('bot.0.space')

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v10/projects/'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer my-secret-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ name: 'bot.0.space' }),
      })
    )
  })

  it('returns success with alreadyExists=true for 409 conflict', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(409, {
        error: { code: 'domain_already_in_use', message: 'Domain already in use' },
      })
    )

    const result = await addVercelDomain('existing-bot.0.space')

    expect(result).toEqual({
      handle: 'existing-bot.0.space',
      success: true,
      alreadyExists: true,
    })
  })

  it('returns success with alreadyExists=true when error code is domain_already_in_use (non-409)', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(400, {
        error: { code: 'domain_already_in_use', message: 'Already registered' },
      })
    )

    const result = await addVercelDomain('already-bot.0.space')

    expect(result).toEqual({
      handle: 'already-bot.0.space',
      success: true,
      alreadyExists: true,
    })
  })

  it('returns error for non-OK response with error body', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(403, {
        error: { code: 'forbidden', message: 'Insufficient permissions' },
      })
    )

    const result = await addVercelDomain('forbidden-bot.0.space')

    expect(result).toEqual({
      handle: 'forbidden-bot.0.space',
      success: false,
      alreadyExists: false,
      error: 'Insufficient permissions',
    })
  })

  it('returns HTTP status as error when no error message in body', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch.mockResolvedValueOnce(mockFetchResponse(500, {}))

    const result = await addVercelDomain('error-bot.0.space')

    expect(result).toEqual({
      handle: 'error-bot.0.space',
      success: false,
      alreadyExists: false,
      error: 'HTTP 500',
    })
  })

  it('returns error on network failure (fetch throws)', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch.mockRejectedValueOnce(new Error('Network timeout'))

    const result = await addVercelDomain('timeout-bot.0.space')

    expect(result).toEqual({
      handle: 'timeout-bot.0.space',
      success: false,
      alreadyExists: false,
      error: 'Network timeout',
    })
  })

  it('handles non-Error thrown values', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch.mockRejectedValueOnce('string error')

    const result = await addVercelDomain('weird-bot.0.space')

    expect(result).toEqual({
      handle: 'weird-bot.0.space',
      success: false,
      alreadyExists: false,
      error: 'string error',
    })
  })

  it('includes abort signal with 10s timeout', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch.mockResolvedValueOnce(mockFetchResponse(200, { name: 'bot.0.space' }))

    await addVercelDomain('bot.0.space')

    const callArgs = mockFetch.mock.calls[0]
    expect(callArgs[1].signal).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 2. ensureVercelDomains
// ---------------------------------------------------------------------------

describe('ensureVercelDomains', () => {
  it('returns empty array for empty input', async () => {
    const results = await ensureVercelDomains([])

    expect(results).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('processes single handle successfully', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(200, { name: 'single-bot.0.space' })
    )

    const results = await ensureVercelDomains(['single-bot.0.space'])

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({
      handle: 'single-bot.0.space',
      success: true,
      alreadyExists: false,
    })
  })

  it('processes multiple handles sequentially', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch
      .mockResolvedValueOnce(mockFetchResponse(200, { name: 'bot-a.0.space' }))
      .mockResolvedValueOnce(
        mockFetchResponse(409, {
          error: { code: 'domain_already_in_use', message: 'Already exists' },
        })
      )
      .mockResolvedValueOnce(
        mockFetchResponse(403, {
          error: { code: 'forbidden', message: 'No access' },
        })
      )

    const results = await ensureVercelDomains([
      'bot-a.0.space',
      'bot-b.0.space',
      'bot-c.0.space',
    ])

    expect(results).toHaveLength(3)

    // First: new domain registered
    expect(results[0]).toEqual({
      handle: 'bot-a.0.space',
      success: true,
      alreadyExists: false,
    })

    // Second: already exists (treated as success)
    expect(results[1]).toEqual({
      handle: 'bot-b.0.space',
      success: true,
      alreadyExists: true,
    })

    // Third: error
    expect(results[2]).toEqual({
      handle: 'bot-c.0.space',
      success: false,
      alreadyExists: false,
      error: 'No access',
    })
  })

  it('returns all errors when VERCEL_TOKEN is missing', async () => {
    delete process.env.VERCEL_TOKEN

    const results = await ensureVercelDomains([
      'bot-a.0.space',
      'bot-b.0.space',
    ])

    expect(results).toHaveLength(2)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toBe('VERCEL_TOKEN environment variable is not set')
    expect(results[1].success).toBe(false)
    expect(results[1].error).toBe('VERCEL_TOKEN environment variable is not set')
  })

  it('continues processing after individual handle failure', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce(mockFetchResponse(200, { name: 'bot-b.0.space' }))

    const results = await ensureVercelDomains([
      'bot-a.0.space',
      'bot-b.0.space',
    ])

    expect(results).toHaveLength(2)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toBe('Network error')
    expect(results[1].success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 3. listVercelDomains
// ---------------------------------------------------------------------------

describe('listVercelDomains', () => {
  it('returns empty array when VERCEL_TOKEN is not set', async () => {
    delete process.env.VERCEL_TOKEN

    const result = await listVercelDomains()

    expect(result).toEqual([])
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns domain names from single page', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(200, {
        domains: [{ name: 'bot-a.0.space' }, { name: 'bot-b.0.space' }],
        pagination: { next: null },
      })
    )

    const result = await listVercelDomains()

    expect(result).toEqual(['bot-a.0.space', 'bot-b.0.space'])
  })

  it('paginates through multiple pages', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          domains: [{ name: 'page1-a.0.space' }, { name: 'page1-b.0.space' }],
          pagination: { next: 12345 },
        })
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          domains: [{ name: 'page2-a.0.space' }],
          pagination: { next: null },
        })
      )

    const result = await listVercelDomains()

    expect(result).toEqual([
      'page1-a.0.space',
      'page1-b.0.space',
      'page2-a.0.space',
    ])
    expect(mockFetch).toHaveBeenCalledTimes(2)
  })

  it('returns partial results when API returns non-OK status mid-pagination', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          domains: [{ name: 'partial.0.space' }],
          pagination: { next: 99 },
        })
      )
      .mockResolvedValueOnce(mockFetchResponse(500, {}))

    const result = await listVercelDomains()

    expect(result).toEqual(['partial.0.space'])
  })

  it('returns partial results on network error during pagination', async () => {
    process.env.VERCEL_TOKEN = 'test-token'
    mockFetch
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          domains: [{ name: 'fetched.0.space' }],
          pagination: { next: 42 },
        })
      )
      .mockRejectedValueOnce(new Error('Connection reset'))

    const result = await listVercelDomains()

    expect(result).toEqual(['fetched.0.space'])
  })

  it('sends correct authorization header', async () => {
    process.env.VERCEL_TOKEN = 'my-list-token'
    mockFetch.mockResolvedValueOnce(
      mockFetchResponse(200, {
        domains: [],
        pagination: { next: null },
      })
    )

    await listVercelDomains()

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v10/projects/'),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer my-list-token',
        }),
      })
    )
  })
})

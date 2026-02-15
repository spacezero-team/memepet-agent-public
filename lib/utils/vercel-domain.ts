/**
 * Vercel Domain Registration Utility
 *
 * Manages Vercel domain aliases for Bluesky bot handles.
 * Each bot handle (e.g., chocospida-r2g9.0.space) must be registered
 * as a Vercel domain alias so that Bluesky can verify the handle via
 * https://<handle>/.well-known/atproto-did
 *
 * @module vercel-domain
 */

// ─── Types ──────────────────────────────────────────

export interface VercelDomainResult {
  readonly handle: string
  readonly success: boolean
  readonly alreadyExists: boolean
  readonly error?: string
}

interface VercelDomainApiResponse {
  readonly name?: string
  readonly error?: {
    readonly code: string
    readonly message: string
  }
}

interface VercelDomainListResponse {
  readonly domains: ReadonlyArray<{ readonly name: string }>
  readonly pagination?: {
    readonly next?: number | null
  }
}

// ─── Constants ──────────────────────────────────────

const VERCEL_API_BASE = 'https://api.vercel.com'
const VERCEL_PROJECT_ID = 'prj_Xn1WKcb7aBoaiHUB7B4Wio3zP13M'
const VERCEL_TEAM_ID = 'team_OT1rsTyjmkzuajdRat0k5ueY'

// ─── Core Functions ─────────────────────────────────

/**
 * Add a Bluesky handle as a Vercel domain alias.
 * Returns a result object indicating success/failure (never throws).
 */
export async function addVercelDomain(handle: string): Promise<VercelDomainResult> {
  const token = process.env.VERCEL_TOKEN
  if (!token) {
    return {
      handle,
      success: false,
      alreadyExists: false,
      error: 'VERCEL_TOKEN environment variable is not set',
    }
  }

  const url = `${VERCEL_API_BASE}/v10/projects/${VERCEL_PROJECT_ID}/domains?teamId=${VERCEL_TEAM_ID}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: handle }),
      signal: AbortSignal.timeout(10_000),
    })

    if (response.ok) {
      return { handle, success: true, alreadyExists: false }
    }

    const body = (await response.json()) as VercelDomainApiResponse

    // Domain already exists is not an error
    if (body.error?.code === 'domain_already_in_use' || response.status === 409) {
      return { handle, success: true, alreadyExists: true }
    }

    return {
      handle,
      success: false,
      alreadyExists: false,
      error: body.error?.message ?? `HTTP ${response.status}`,
    }
  } catch (err) {
    return {
      handle,
      success: false,
      alreadyExists: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * List all domains currently registered on the Vercel project.
 * Returns domain names or an empty array on failure.
 */
export async function listVercelDomains(): Promise<ReadonlyArray<string>> {
  const token = process.env.VERCEL_TOKEN
  if (!token) return []

  const allDomains: string[] = []
  let page: number | null = null

  try {
    // Paginate through all domains (Vercel returns up to 20 per page)
    do {
      const params = new URLSearchParams({ teamId: VERCEL_TEAM_ID })
      if (page !== null) {
        params.set('until', String(page))
      }

      const url = `${VERCEL_API_BASE}/v10/projects/${VERCEL_PROJECT_ID}/domains?${params.toString()}`

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })

      if (!response.ok) break

      const body = (await response.json()) as VercelDomainListResponse
      const domainNames = body.domains.map(d => d.name)
      allDomains.push(...domainNames)

      page = body.pagination?.next ?? null
    } while (page !== null)

    return allDomains
  } catch {
    return allDomains
  }
}

/**
 * Ensure multiple handles are registered as Vercel domains.
 * Skips handles that already exist. Returns results for each handle.
 */
export async function ensureVercelDomains(
  handles: ReadonlyArray<string>
): Promise<ReadonlyArray<VercelDomainResult>> {
  if (handles.length === 0) return []

  // Register sequentially to avoid Vercel rate limits
  const results: VercelDomainResult[] = []
  for (const handle of handles) {
    const result = await addVercelDomain(handle)
    results.push(result)
  }
  return results
}

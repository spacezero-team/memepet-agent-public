/**
 * Infrastructure verification script.
 * Checks QStash schedules, deliveries, encryption, sessions,
 * Vercel endpoint, PDS connectivity, and environment variables.
 */
import { readFileSync } from 'node:fs'

// ── Load .env.local ──────────────────────────────────────────────────────────
const envContent = readFileSync('.env.local', 'utf-8')
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx).trim()
  let value = trimmed.slice(eqIdx + 1).trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1)
  }
  if (!process.env[key]) process.env[key] = value
}

import { createClient } from '@supabase/supabase-js'
import { decryptIfNeeded, isEncrypted } from '../lib/utils/encrypt.js'

// ── Supabase client ──────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } },
)

// ── Helpers ──────────────────────────────────────────────────────────────────
interface CheckResult {
  readonly name: string
  readonly passed: boolean
  readonly details: string
}

const results: CheckResult[] = []

function record(name: string, passed: boolean, details: string): void {
  results.push({ name, passed, details })
  const tag = passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'
  console.log(`\n[${tag}] ${name}`)
  console.log(`       ${details.replace(/\n/g, '\n       ')}`)
}

async function qstashFetch<T>(path: string): Promise<T> {
  const res = await fetch(`https://qstash.upstash.io${path}`, {
    headers: { Authorization: `Bearer ${process.env.QSTASH_TOKEN}` },
  })
  if (!res.ok) {
    throw new Error(`QStash ${path} returned ${res.status}: ${await res.text()}`)
  }
  return res.json() as Promise<T>
}

// ── 1. QStash cron schedules ─────────────────────────────────────────────────
async function checkQstashSchedules(): Promise<void> {
  try {
    interface Schedule {
      readonly scheduleId: string
      readonly cron: string
      readonly destination: string
      readonly isPaused: boolean
      readonly createdAt: number
    }
    const schedules = await qstashFetch<readonly Schedule[]>('/v2/schedules')

    if (schedules.length === 0) {
      record('QStash Cron Schedules', false, 'No schedules found')
      return
    }

    const lines = schedules.map((s) => {
      const status = s.isPaused ? 'PAUSED' : 'ACTIVE'
      return `ID: ${s.scheduleId}\n  Cron: ${s.cron}\n  URL: ${s.destination}\n  Status: ${status}`
    })

    const allActive = schedules.every((s) => !s.isPaused)
    record(
      'QStash Cron Schedules',
      allActive,
      `${schedules.length} schedule(s) found${allActive ? ' (all active)' : ' (some paused!)'}\n${lines.join('\n')}`,
    )
  } catch (err) {
    record('QStash Cron Schedules', false, `Error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ── 2. QStash recent deliveries ──────────────────────────────────────────────
async function checkQstashDeliveries(): Promise<void> {
  try {
    interface Event {
      readonly messageId: string
      readonly state: string
      readonly url: string
      readonly time: number
      readonly responseStatus?: number
    }
    interface EventsResponse {
      readonly events: readonly Event[]
      readonly cursor?: string
    }
    const data = await qstashFetch<EventsResponse>('/v2/events?count=10')
    const events = data.events ?? []

    if (events.length === 0) {
      record('QStash Recent Deliveries', false, 'No recent events found')
      return
    }

    const failed = events.filter((e) => e.state === 'FAILED' || e.state === 'ERROR')
    const delivered = events.filter((e) => e.state === 'DELIVERED' || e.state === 'ACTIVE')

    const lines = events.map((e) => {
      const ts = new Date(e.time).toISOString()
      return `${ts} | ${e.state.padEnd(10)} | ${e.url ?? 'N/A'} | HTTP ${e.responseStatus ?? '-'}`
    })

    record(
      'QStash Recent Deliveries',
      failed.length === 0,
      `${events.length} events: ${delivered.length} delivered, ${failed.length} failed\n${lines.join('\n')}`,
    )
  } catch (err) {
    record('QStash Recent Deliveries', false, `Error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ── 3. Encryption round-trip ─────────────────────────────────────────────────
async function checkEncryption(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('bluesky_bot_config')
      .select('handle, app_password')
      .eq('is_active', true)
      .limit(1)
      .single()

    if (error || !data) {
      record('Encryption Round-Trip', false, `DB error: ${error?.message ?? 'no rows'}`)
      return
    }

    const raw = String(data.app_password)
    const encrypted = isEncrypted(raw)

    if (!encrypted) {
      record('Encryption Round-Trip', false, `Password for @${data.handle} is NOT encrypted (plaintext found)`)
      return
    }

    const decrypted = decryptIfNeeded(raw)
    const looksValid = /^[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/i.test(decrypted)

    record(
      'Encryption Round-Trip',
      looksValid,
      `@${data.handle}\n  Stored format: iv:authTag:ciphertext (encrypted)\n  Decrypted: ${decrypted.slice(0, 4)}-****-****-${decrypted.slice(-4)}\n  Valid app password format: ${looksValid}`,
    )
  } catch (err) {
    record('Encryption Round-Trip', false, `Error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ── 4. Session persistence ───────────────────────────────────────────────────
async function checkSessionPersistence(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from('bluesky_bot_config')
      .select('handle, session_data')
      .eq('is_active', true)

    if (error) {
      record('Session Persistence', false, `DB error: ${error.message}`)
      return
    }

    const bots = data ?? []
    const withSession = bots.filter((b: Record<string, unknown>) => b.session_data !== null && b.session_data !== undefined)
    const total = bots.length

    record(
      'Session Persistence',
      withSession.length > 0,
      `${withSession.length}/${total} active bots have persisted sessions\n` +
        bots
          .map((b: Record<string, unknown>) => `  @${b.handle}: ${b.session_data ? 'HAS session' : 'NO session'}`)
          .join('\n'),
    )
  } catch (err) {
    record('Session Persistence', false, `Error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ── 5. Vercel production endpoint ────────────────────────────────────────────
async function checkVercelEndpoint(): Promise<void> {
  const url = 'https://memepet-agent.0.space/api/v1/workflows/bluesky-agent'
  try {
    const res = await fetch(url, { method: 'GET' })
    const body = await res.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(body) as Record<string, unknown>
    } catch {
      // body may not be JSON
    }

    const ok = res.status === 200 || (parsed.status === 'OK')

    record(
      'Vercel Production Endpoint',
      ok,
      `URL: ${url}\n  HTTP ${res.status}\n  Body: ${body.slice(0, 300)}`,
    )
  } catch (err) {
    record('Vercel Production Endpoint', false, `Error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ── 6. PDS connectivity ─────────────────────────────────────────────────────
async function checkPdsConnectivity(): Promise<void> {
  const url = 'https://pds.0.space/xrpc/com.atproto.identity.resolveHandle?handle=chilldalf-ts9r.0.space'
  try {
    const res = await fetch(url)
    const body = await res.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(body) as Record<string, unknown>
    } catch {
      // body may not be JSON
    }

    const did = typeof parsed.did === 'string' ? parsed.did : null
    const ok = res.status === 200 && did !== null

    record(
      'PDS Connectivity',
      ok,
      `URL: ${url}\n  HTTP ${res.status}\n  DID: ${did ?? 'NOT RESOLVED'}\n  Body: ${body.slice(0, 300)}`,
    )
  } catch (err) {
    record('PDS Connectivity', false, `Error: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ── 7. Environment variable check ───────────────────────────────────────────
function checkEnvVars(): void {
  const encKey = process.env.ENCRYPTION_KEY ?? ''
  const validHex = /^[0-9a-fA-F]{64}$/.test(encKey)

  const checks = [
    { name: 'ENCRYPTION_KEY', set: encKey.length > 0, valid: validHex, detail: validHex ? '64-char hex OK' : `length=${encKey.length}, hex=${validHex}` },
    { name: 'QSTASH_TOKEN', set: Boolean(process.env.QSTASH_TOKEN), valid: Boolean(process.env.QSTASH_TOKEN), detail: process.env.QSTASH_TOKEN ? 'set' : 'MISSING' },
    { name: 'SUPABASE_URL', set: Boolean(process.env.SUPABASE_URL), valid: Boolean(process.env.SUPABASE_URL), detail: process.env.SUPABASE_URL ? 'set' : 'MISSING' },
    { name: 'SUPABASE_SERVICE_ROLE_KEY', set: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), valid: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), detail: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'MISSING' },
    { name: 'GOOGLE_GENERATIVE_AI_API_KEY', set: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY), valid: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY), detail: process.env.GOOGLE_GENERATIVE_AI_API_KEY ? 'set' : 'MISSING' },
    { name: 'ENABLE_BLUESKY_AGENT', set: Boolean(process.env.ENABLE_BLUESKY_AGENT), valid: process.env.ENABLE_BLUESKY_AGENT === 'true', detail: process.env.ENABLE_BLUESKY_AGENT ?? 'MISSING' },
  ]

  const allValid = checks.every((c) => c.valid)
  const lines = checks.map((c) => {
    const tag = c.valid ? 'OK' : 'BAD'
    return `  ${tag.padEnd(4)} ${c.name}: ${c.detail}`
  })

  record('Environment Variables', allValid, lines.join('\n'))
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('========================================')
  console.log(' MemePet Infrastructure Verification')
  console.log('========================================')

  await checkQstashSchedules()
  await checkQstashDeliveries()
  await checkEncryption()
  await checkSessionPersistence()
  await checkVercelEndpoint()
  await checkPdsConnectivity()
  checkEnvVars()

  console.log('\n========================================')
  console.log(' Summary')
  console.log('========================================')

  const passed = results.filter((r) => r.passed).length
  const failed = results.filter((r) => !r.passed).length
  const total = results.length

  for (const r of results) {
    const tag = r.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m'
    console.log(`  [${tag}] ${r.name}`)
  }

  console.log(`\n  Total: ${total} | Passed: ${passed} | Failed: ${failed}`)

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

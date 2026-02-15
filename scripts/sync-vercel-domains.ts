/**
 * Sync Vercel Domains
 *
 * One-time or periodic script that ensures all Bluesky bot handles
 * are registered as Vercel domain aliases on the memepet-agent project.
 *
 * Sources:
 * 1. bluesky_bot_config.handle — active bot handles
 * 2. pet.meme.blueskyHandle — handles from the meme pipeline
 *
 * Usage: npx tsx scripts/sync-vercel-domains.ts
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ─── Env Loading ────────────────────────────────────

function loadEnv(path: string): void {
  try {
    const content = readFileSync(path, 'utf-8')
    for (const line of content.split('\n')) {
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
  } catch {
    // ignore missing files
  }
}

loadEnv('/Volumes/Work/memepet-agent-live/.env.local')
loadEnv('/Volumes/Work/ig-memepet-pipeline/.env.local')

// ─── Supabase Client ────────────────────────────────

const sb = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

// ─── Data Loading ───────────────────────────────────

async function loadBotConfigHandles(): Promise<ReadonlyArray<string>> {
  const { data, error } = await sb
    .from('bluesky_bot_config')
    .select('handle')
    .eq('is_active', true)

  if (error) {
    console.error('Error loading bot configs:', error.message)
    return []
  }

  return (data ?? [])
    .map((row: { handle: string }) => row.handle)
    .filter(Boolean)
}

async function loadPetMemeHandles(): Promise<ReadonlyArray<string>> {
  const { data, error } = await sb
    .from('pet')
    .select('meme')
    .not('meme', 'is', null)

  if (error) {
    console.error('Error loading pet meme data:', error.message)
    return []
  }

  return (data ?? [])
    .map((row: { meme: Record<string, unknown> | null }) => {
      const meme = row.meme
      return (meme?.blueskyHandle as string) ?? null
    })
    .filter((h): h is string => typeof h === 'string' && h.length > 0)
}

function deduplicateHandles(
  botHandles: ReadonlyArray<string>,
  memeHandles: ReadonlyArray<string>
): ReadonlyArray<string> {
  const all = new Set([...botHandles, ...memeHandles])
  return Array.from(all).sort()
}

// ─── Main ───────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Sync Vercel Domains ===\n')

  if (!process.env.VERCEL_TOKEN) {
    console.error('VERCEL_TOKEN not found in environment. Set it in .env.local.')
    process.exit(1)
  }

  // Step 1: Load handles from both sources
  console.log('1. Loading handles from Supabase...')
  const [botHandles, memeHandles] = await Promise.all([
    loadBotConfigHandles(),
    loadPetMemeHandles(),
  ])

  console.log(`   bot_config handles: ${botHandles.length}`)
  console.log(`   pet.meme handles: ${memeHandles.length}`)

  const allHandles = deduplicateHandles(botHandles, memeHandles)
  console.log(`   unique handles: ${allHandles.length}`)

  if (allHandles.length === 0) {
    console.log('\nNo handles found. Nothing to sync.')
    return
  }

  // Step 2: Get current Vercel domains
  console.log('\n2. Loading current Vercel domains...')
  const { listVercelDomains } = await import('../lib/utils/vercel-domain.js')
  const existingDomains = await listVercelDomains()
  const existingSet = new Set(existingDomains)
  console.log(`   existing domains: ${existingDomains.length}`)

  // Step 3: Find missing domains
  const missing = allHandles.filter(h => !existingSet.has(h))
  const alreadyRegistered = allHandles.filter(h => existingSet.has(h))

  console.log(`\n   already registered: ${alreadyRegistered.length}`)
  console.log(`   missing: ${missing.length}`)

  if (missing.length === 0) {
    console.log('\nAll handles are already registered as Vercel domains.')
    return
  }

  // Step 4: Register missing domains
  console.log('\n3. Registering missing domains...\n')
  const { addVercelDomain } = await import('../lib/utils/vercel-domain.js')

  let added = 0
  let failed = 0

  for (const handle of missing) {
    const result = await addVercelDomain(handle)
    if (result.success) {
      const tag = result.alreadyExists ? 'EXISTS' : 'ADDED'
      console.log(`   [${tag}] ${handle}`)
      added++
    } else {
      console.log(`   [FAIL]  ${handle} — ${result.error}`)
      failed++
    }
  }

  // Summary
  console.log('\n=== Summary ===')
  console.log(`   Total handles: ${allHandles.length}`)
  console.log(`   Already registered: ${alreadyRegistered.length}`)
  console.log(`   Newly added: ${added}`)
  console.log(`   Failed: ${failed}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})

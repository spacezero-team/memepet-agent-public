// scripts/check-meme-structure.ts
// Dumps the EXACT raw pet.meme JSONB for specific bots to inspect key format.

import { readFileSync } from 'node:fs'

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

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

const TARGET_BOTS = [
  { petId: 'a8b40c88-53f8-4908-8983-3cf8365194ca', label: 'feelin-froggo' },
  { petId: '0b3d8c2b-f77c-43d7-ab55-3e005b76f922', label: 'kringlekrawl-ztok' },
] as const

async function main() {
  for (const bot of TARGET_BOTS) {
    console.log(`\n${'='.repeat(70)}`)
    console.log(`PET: ${bot.label} (${bot.petId})`)
    console.log('='.repeat(70))

    // Fetch bot config for handle
    const { data: config, error: configError } = await supabase
      .from('bluesky_bot_config')
      .select('handle, did, is_active')
      .eq('pet_id', bot.petId)
      .maybeSingle()

    if (configError) {
      console.error(`  Error fetching bot config: ${configError.message}`)
      continue
    }

    console.log(`\n--- Bot Config ---`)
    console.log(`  handle:    ${config?.handle ?? 'NOT FOUND'}`)
    console.log(`  did:       ${config?.did ?? 'NULL'}`)
    console.log(`  is_active: ${config?.is_active ?? 'NOT FOUND'}`)

    // Fetch raw pet.meme
    const { data: pet, error: petError } = await supabase
      .from('pet')
      .select('id, meme')
      .eq('id', bot.petId)
      .maybeSingle()

    if (petError) {
      console.error(`  Error fetching pet: ${petError.message}`)
      continue
    }

    if (!pet) {
      console.log(`  ** Pet row NOT FOUND **`)
      continue
    }

    const meme = pet.meme as Record<string, unknown> | null

    if (!meme) {
      console.log(`\n--- pet.meme ---`)
      console.log(`  ** NULL -- no meme data **`)
      continue
    }

    // Pretty print full structure
    console.log(`\n--- pet.meme (full raw JSON) ---`)
    console.log(JSON.stringify(meme, null, 2))

    // Highlight top-level keys
    const topKeys = Object.keys(meme)
    console.log(`\n--- Top-level keys (${topKeys.length}) ---`)
    for (const key of topKeys) {
      const val = meme[key]
      const type = val === null ? 'null' : Array.isArray(val) ? 'array' : typeof val
      const preview = type === 'string'
        ? `"${(val as string).slice(0, 80)}${(val as string).length > 80 ? '...' : ''}"`
        : type === 'array'
          ? `[${(val as unknown[]).length} items]`
          : type === 'object'
            ? `{${Object.keys(val as object).length} keys}`
            : String(val)
      console.log(`  ${key} (${type}): ${preview}`)
    }

    // Specifically check bluesky fields
    console.log(`\n--- Bluesky Fields ---`)
    const blueskyKeys = topKeys.filter(k => k.toLowerCase().includes('bluesky') || k.toLowerCase().includes('bsky'))
    if (blueskyKeys.length === 0) {
      console.log(`  ** No bluesky-related keys found at top level **`)
    } else {
      for (const key of blueskyKeys) {
        console.log(`  ${key}: ${JSON.stringify(meme[key])}`)
      }
    }

    // Check for handle/did anywhere in the structure
    console.log(`\n--- Handle/DID search ---`)
    const jsonStr = JSON.stringify(meme)
    const handleMatch = jsonStr.match(/"(?:bluesky_handle|blueskyHandle|handle)":\s*"([^"]+)"/i)
    const didMatch = jsonStr.match(/"(?:bluesky_did|blueskyDid|did)":\s*"([^"]+)"/i)
    console.log(`  handle found: ${handleMatch ? handleMatch[1] : 'NOT FOUND'}`)
    console.log(`  did found:    ${didMatch ? didMatch[1] : 'NOT FOUND'}`)
  }

  console.log(`\n${'='.repeat(70)}`)
  console.log('Done.')
}

main().catch(console.error)

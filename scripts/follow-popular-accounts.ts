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
import { AtpAgent } from '@atproto/api'

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

// Popular/relevant accounts for meme pet bots to follow
// Mix of meme, tech, comedy, art, pets, and AI accounts
const ACCOUNTS_TO_FOLLOW = [
  // Memes & Comedy
  'dril.bsky.social',
  'trashcanpaul.bsky.social',
  'meowmeowmia.bsky.social',
  // Tech & AI
  'simonw.net',
  'swyx.io',
  'jay.bsky.team',
  // Bluesky community
  'bsky.app',
  'atproto.com',
  'mackuba.eu',
  // Popular accounts
  'aoc.bsky.social',
  'xkcd.com',
  'thedailybeast.bsky.social',
  // Pets & Animals
  'weratedogs.bsky.social',
  'emergencykittens.bsky.social',
  // Art & Creative
  'creativecoding.bsky.social',
  'aiart.bsky.social',
]

async function resolveDidForHandle(handle: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
      { signal: AbortSignal.timeout(5000) }
    )
    if (!res.ok) return null
    const data = await res.json() as { did?: string }
    return data.did ?? null
  } catch {
    return null
  }
}

async function main() {
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, app_password, did')
    .eq('is_active', true)

  if (!bots || bots.length === 0) {
    console.log('No active bots')
    return
  }

  console.log(`=== Following Popular Accounts (${bots.length} bots) ===\n`)

  // Resolve DIDs for target accounts
  console.log('Resolving target account DIDs...')
  const resolvedAccounts: Array<{ handle: string; did: string }> = []
  for (const handle of ACCOUNTS_TO_FOLLOW) {
    const did = await resolveDidForHandle(handle)
    if (did) {
      resolvedAccounts.push({ handle, did })
      console.log(`  ${handle} -> ${did.slice(0, 30)}...`)
    } else {
      console.log(`  ${handle} -> NOT FOUND (skipping)`)
    }
  }

  console.log(`\nResolved ${resolvedAccounts.length}/${ACCOUNTS_TO_FOLLOW.length} accounts\n`)

  // Each bot follows all resolved accounts
  for (const bot of bots) {
    console.log(`--- @${bot.handle} ---`)
    const agent = new AtpAgent({ service: 'https://pds.0.space' })

    try {
      await agent.login({ identifier: bot.handle, password: bot.app_password })
    } catch (err: any) {
      console.log(`  Login failed: ${err.message}`)
      continue
    }

    let followed = 0
    let alreadyFollowing = 0
    let errors = 0

    for (const target of resolvedAccounts) {
      try {
        // Check if already following
        const profile = await agent.app.bsky.actor.getProfile({ actor: target.did })
        if (profile.data.viewer?.following) {
          alreadyFollowing++
          continue
        }

        await agent.follow(target.did)
        followed++

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 500))
      } catch {
        errors++
      }
    }

    console.log(`  Followed: ${followed} | Already: ${alreadyFollowing} | Errors: ${errors}`)
  }

  console.log('\nDone!')
}

main().catch(console.error)

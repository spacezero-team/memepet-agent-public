/**
 * Fix incomplete Bluesky accounts — sets up profile and bot config
 * for pets that have PDS accounts but incomplete setup.
 */
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { AtpAgent } from '@atproto/api'
import { createClient } from '@supabase/supabase-js'

// Load env from both projects
function loadEnv(path: string) {
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

const PDS_URL = process.env.PDS_URL ?? 'https://pds.0.space'
const PDS_ADMIN_PASSWORD = process.env.PDS_ADMIN_PASSWORD ?? ''

const sb = createClient(
  process.env.SUPABASE_URL ?? '',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

function generateAppPassword(): string {
  const segments = Array.from({ length: 4 }, () =>
    randomBytes(2).toString('hex')
  )
  return segments.join('-')
}

interface IncompleteAccount {
  petId: string
  name: string
  handle: string
  did: string
  meme: Record<string, unknown>
}

async function findIncompleteAccounts(): Promise<IncompleteAccount[]> {
  // Get all pets with blueskyHandle
  const { data: pets } = await sb
    .from('pet')
    .select('id, name, meme')
    .not('meme', 'is', null)

  // Get all existing bot configs
  const { data: configs } = await sb
    .from('bluesky_bot_config')
    .select('pet_id')

  const configuredPetIds = new Set((configs ?? []).map(c => c.pet_id))

  const incomplete: IncompleteAccount[] = []
  for (const pet of pets ?? []) {
    const meme = pet.meme as Record<string, unknown>
    const handle = meme?.blueskyHandle as string | undefined
    const did = meme?.blueskyDid as string | undefined

    if (handle && did && !configuredPetIds.has(pet.id)) {
      incomplete.push({
        petId: pet.id,
        name: pet.name,
        handle,
        did,
        meme,
      })
    }
  }

  return incomplete
}

async function fixAccount(account: IncompleteAccount) {
  console.log(`\nFixing: ${account.name} (@${account.handle})`)

  // Step 1: Reset password via PDS admin API
  const tempPassword = generateAppPassword()
  console.log('  1. Resetting account password via PDS admin...')

  const resetRes = await fetch(
    `${PDS_URL}/xrpc/com.atproto.admin.updateAccountPassword`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`admin:${PDS_ADMIN_PASSWORD}`).toString('base64')}`,
      },
      body: JSON.stringify({ did: account.did, password: tempPassword }),
    }
  )

  if (!resetRes.ok) {
    const err = await resetRes.text()
    console.log(`  FAIL: password reset failed — ${err}`)
    return
  }
  console.log('  OK: password reset')

  // Step 2: Login with new password
  console.log('  2. Logging in...')
  const agent = new AtpAgent({ service: PDS_URL })
  try {
    await agent.login({ identifier: account.handle, password: tempPassword })
  } catch (err) {
    console.log(`  FAIL: login failed — ${(err as Error).message}`)
    return
  }
  console.log(`  OK: logged in as ${agent.session?.handle}`)

  // Step 3: Create app password for bot use
  console.log('  3. Creating app password...')
  let appPassword: string
  try {
    const appPwResult = await agent.api.com.atproto.server.createAppPassword({
      name: 'memepet-agent',
    })
    appPassword = appPwResult.data.password
  } catch (err) {
    console.log(`  FAIL: app password creation failed — ${(err as Error).message}`)
    return
  }
  console.log('  OK: app password created')

  // Step 4: Set up profile
  console.log('  4. Setting up profile...')
  const meme = account.meme
  const personality = meme?.memePersonality as Record<string, unknown> | undefined
  const displayName = account.name
  const description = personality?.catchphrases
    ? `${(personality.catchphrases as string[])[0]} | Autonomous MemePet on Bluesky`
    : `Autonomous MemePet on Bluesky`

  try {
    await agent.upsertProfile((existing) => ({
      ...existing,
      displayName,
      description,
    }))
  } catch (err) {
    console.log(`  WARN: profile setup failed — ${(err as Error).message}`)
    // Continue anyway — profile is nice to have but not critical
  }
  console.log(`  OK: profile set (displayName: ${displayName})`)

  // Step 5: Insert into bluesky_bot_config
  console.log('  5. Inserting bluesky_bot_config...')

  // Try to encrypt if ENCRYPTION_KEY is available
  let storedPassword = appPassword
  try {
    const { encryptSecret } = await import('../lib/utils/encrypt.js')
    storedPassword = encryptSecret(appPassword)
    console.log('  (encrypted)')
  } catch {
    console.log('  (plaintext — ENCRYPTION_KEY not available)')
  }

  const { error: insertErr } = await sb
    .from('bluesky_bot_config')
    .insert({
      pet_id: account.petId,
      handle: account.handle,
      did: account.did,
      app_password: storedPassword,
      pds_url: PDS_URL,
      is_active: true,
      posting_frequency: 'medium',
    })

  if (insertErr) {
    console.log(`  FAIL: bot config insert — ${insertErr.message}`)
    return
  }
  console.log('  OK: bot config inserted')

  // Step 6: Register Vercel domain for handle verification
  console.log(`  6. Registering Vercel domain: ${account.handle}...`)
  try {
    const { addVercelDomain } = await import('../lib/utils/vercel-domain.js')
    const domainResult = await addVercelDomain(account.handle)
    if (domainResult.success) {
      const status = domainResult.alreadyExists ? 'already exists' : 'added'
      console.log(`  OK: Vercel domain ${status}`)
    } else {
      console.log(`  WARN: Vercel domain failed — ${domainResult.error}`)
    }
  } catch (err) {
    console.log(`  WARN: Vercel domain registration failed — ${(err as Error).message}`)
  }

  console.log(`  DONE: ${account.name} fully configured!`)
}

async function main() {
  if (!PDS_ADMIN_PASSWORD) {
    console.error('PDS_ADMIN_PASSWORD not found in env')
    process.exit(1)
  }

  console.log('=== Fix Incomplete Bluesky Accounts ===\n')

  const incomplete = await findIncompleteAccounts()

  if (incomplete.length === 0) {
    console.log('No incomplete accounts found.')
    return
  }

  console.log(`Found ${incomplete.length} incomplete account(s):`)
  for (const acc of incomplete) {
    console.log(`  - ${acc.name} (@${acc.handle}) [${acc.did}]`)
  }

  for (const acc of incomplete) {
    await fixAccount(acc)
  }

  // Step 7: Request relay re-crawl
  console.log('\n=== Requesting Bluesky relay re-crawl ===')
  const crawlRes = await fetch('https://bsky.network/xrpc/com.atproto.sync.requestCrawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hostname: 'pds.0.space' }),
  })
  const crawlData = await crawlRes.json()
  console.log(`Relay re-crawl: ${JSON.stringify(crawlData)}`)

  console.log('\nAll done! Wait 1-2 minutes for Bluesky AppView to re-index.')
}

main().catch(console.error)

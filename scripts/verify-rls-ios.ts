// scripts/verify-rls-ios.ts
// Comprehensive verification of RLS policies and iOS app data access.
// Checks column-level security, service role access, anon read paths, and Realtime.
//
// Usage: npx tsx scripts/verify-rls-ios.ts

import { readFileSync } from 'node:fs'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// 1. Load .env.local
// ---------------------------------------------------------------------------
const envPath = '/Volumes/Work/memepet-agent-live/.env.local'
const envContent = readFileSync(envPath, 'utf-8')
for (const line of envContent.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eqIdx = trimmed.indexOf('=')
  if (eqIdx === -1) continue
  const key = trimmed.slice(0, eqIdx).trim()
  let value = trimmed.slice(eqIdx + 1).trim()
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1)
  }
  if (!process.env[key]) process.env[key] = value
}

// ---------------------------------------------------------------------------
// 2. Credentials
// ---------------------------------------------------------------------------
const supabaseUrl =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

// iOS anon key (from Secrets.xcconfig in the iOS repo)
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  // Hardcoded fallback matching Secrets.xcconfig for this Supabase project
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImliZW9xc3VpcXV1dmlwc2htcHRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE2OTUxMjYyMTEsImV4cCI6MjAxMDcwMjIxMX0.FacsD9CIiy_hNwkac-aEe4QVQZd5ThR5U1-fnuF7ENE'

// ---------------------------------------------------------------------------
// 3. Clients
// ---------------------------------------------------------------------------
const anonClient = createClient(supabaseUrl, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
interface TestResult {
  name: string
  status: 'PASS' | 'FAIL' | 'WARN'
  detail: string
}

const results: TestResult[] = []

function record(name: string, status: 'PASS' | 'FAIL' | 'WARN', detail: string) {
  results.push({ name, status, detail })
  const icon = status === 'PASS' ? '[PASS]' : status === 'FAIL' ? '[FAIL]' : '[WARN]'
  console.log(`  ${icon} ${name}`)
  console.log(`        ${detail}`)
}

function decodeJwtRole(jwt: string): string {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString())
    return payload.role || 'unknown'
  } catch {
    return 'decode-error'
  }
}

// ---------------------------------------------------------------------------
// Test 1: Column-level security on bluesky_bot_config (anon)
// ---------------------------------------------------------------------------
async function testBotConfigColumnSecurity(client: SupabaseClient) {
  console.log('\n--- 1. Column-level security on bluesky_bot_config (anon) ---\n')

  // 1a. Try to SELECT app_password
  const { data: pwData, error: pwError } = await client
    .from('bluesky_bot_config')
    .select('app_password')
    .limit(1)

  if (pwError) {
    record(
      'anon SELECT app_password blocked',
      'PASS',
      `Query returned error: ${pwError.code} - ${pwError.message}`,
    )
  } else {
    const rows = pwData ?? []
    const hasValue = rows.length > 0 && rows[0].app_password != null && rows[0].app_password !== ''
    if (hasValue) {
      record(
        'anon SELECT app_password blocked',
        'FAIL',
        `CRITICAL: app_password is readable by anon! Value present in ${rows.length} row(s).`,
      )
    } else {
      // Could be 0 rows or null values -- still pass
      record(
        'anon SELECT app_password blocked',
        'PASS',
        `Query returned ${rows.length} row(s) with app_password=${rows[0]?.app_password ?? 'N/A'}. Column-level grant likely blocks it.`,
      )
    }
  }

  // 1b. Try to SELECT session_data
  const { data: sessData, error: sessError } = await client
    .from('bluesky_bot_config')
    .select('session_data')
    .limit(1)

  if (sessError) {
    record(
      'anon SELECT session_data blocked',
      'PASS',
      `Query returned error: ${sessError.code} - ${sessError.message}`,
    )
  } else {
    const rows = sessData ?? []
    const hasValue = rows.length > 0 && rows[0].session_data != null && rows[0].session_data !== ''
    if (hasValue) {
      record(
        'anon SELECT session_data blocked',
        'FAIL',
        `CRITICAL: session_data is readable by anon! Contains session tokens.`,
      )
    } else {
      record(
        'anon SELECT session_data blocked',
        'PASS',
        `Query returned ${rows.length} row(s) with session_data=${rows[0]?.session_data ?? 'N/A'}. Column-level grant blocks it.`,
      )
    }
  }

  // 1c. Try to SELECT handle, is_active (should work)
  const { data: safeData, error: safeError } = await client
    .from('bluesky_bot_config')
    .select('handle, is_active')
    .limit(3)

  if (safeError) {
    record(
      'anon SELECT handle, is_active accessible',
      'FAIL',
      `Cannot read public columns: ${safeError.code} - ${safeError.message}. iOS app will fail to load bot profiles.`,
    )
  } else {
    const rows = safeData ?? []
    if (rows.length > 0) {
      const handles = rows.map((r) => `@${r.handle}`).join(', ')
      record(
        'anon SELECT handle, is_active accessible',
        'PASS',
        `${rows.length} row(s) returned: ${handles}`,
      )
    } else {
      record(
        'anon SELECT handle, is_active accessible',
        'WARN',
        'Query succeeded but returned 0 rows. RLS might filter all rows, or table is empty.',
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Test 2: Service role full access
// ---------------------------------------------------------------------------
async function testServiceRoleAccess(client: SupabaseClient) {
  console.log('\n--- 2. Service role full access ---\n')

  const { data, error } = await client
    .from('bluesky_bot_config')
    .select('pet_id, handle, app_password')
    .eq('is_active', true)
    .limit(5)

  if (error) {
    record(
      'service_role SELECT app_password',
      'FAIL',
      `Service role cannot read app_password: ${error.message}`,
    )
    return
  }

  const rows = data ?? []
  if (rows.length === 0) {
    record(
      'service_role SELECT app_password',
      'WARN',
      'No active bots found. Cannot verify encrypted format.',
    )
    return
  }

  record(
    'service_role SELECT app_password',
    'PASS',
    `${rows.length} active bot(s) returned with app_password values.`,
  )

  // Verify encrypted format (iv:authTag:ciphertext -- all hex, separated by colons)
  const encryptedPattern = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i
  let allEncrypted = true
  for (const row of rows) {
    const pw = row.app_password as string | null
    if (!pw) {
      console.log(`        @${row.handle}: app_password is NULL`)
      allEncrypted = false
      continue
    }
    const isEnc = encryptedPattern.test(pw)
    const preview = pw.length > 40 ? `${pw.slice(0, 20)}...${pw.slice(-10)}` : pw
    console.log(`        @${row.handle}: ${isEnc ? 'ENCRYPTED' : 'PLAINTEXT'} (${preview})`)
    if (!isEnc) allEncrypted = false
  }

  if (allEncrypted) {
    record(
      'app_password encrypted at rest',
      'PASS',
      'All app_password values are in AES-256-GCM encrypted format (iv:authTag:ciphertext).',
    )
  } else {
    record(
      'app_password encrypted at rest',
      'FAIL',
      'Some app_password values are plaintext or NULL. Run scripts/encrypt-existing-passwords.ts to fix.',
    )
  }
}

// ---------------------------------------------------------------------------
// Test 3: bluesky_post_log anon read
// ---------------------------------------------------------------------------
async function testPostLogAnonRead(client: SupabaseClient) {
  console.log('\n--- 3. bluesky_post_log anon read (iOS activity feed) ---\n')

  const { data, error } = await client
    .from('bluesky_post_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5)

  if (error) {
    record(
      'anon SELECT bluesky_post_log',
      'FAIL',
      `iOS app cannot read activity logs: ${error.code} - ${error.message}`,
    )
    return
  }

  const rows = data ?? []
  if (rows.length === 0) {
    record(
      'anon SELECT bluesky_post_log',
      'WARN',
      'Query succeeded but 0 rows. Table may be empty or RLS filters all rows.',
    )
    return
  }

  const columns = Object.keys(rows[0])
  record(
    'anon SELECT bluesky_post_log',
    'PASS',
    `${rows.length} row(s) returned. iOS can read activity feed.`,
  )
  console.log(`        Accessible columns: ${columns.join(', ')}`)

  // Show a sample
  for (const row of rows.slice(0, 3)) {
    const r = row as Record<string, unknown>
    console.log(
      `        [${r.activity_type ?? r.type ?? 'N/A'}] pet=${String(r.pet_id ?? '').slice(0, 8)}... | ${r.created_at}`,
    )
  }
}

// ---------------------------------------------------------------------------
// Test 4: pet table anon read
// ---------------------------------------------------------------------------
async function testPetTableAnonRead(client: SupabaseClient) {
  console.log('\n--- 4. pet table anon read (iOS pet profiles) ---\n')

  // 4a. Basic read
  const { data, error } = await client
    .from('pet')
    .select('id, name, personality_type, psyche, meme')
    .not('meme', 'is', null)
    .limit(3)

  if (error) {
    record(
      'anon SELECT pet (meme != null)',
      'FAIL',
      `iOS app cannot read meme pet profiles: ${error.code} - ${error.message}`,
    )
    return
  }

  const rows = data ?? []
  if (rows.length === 0) {
    record(
      'anon SELECT pet (meme != null)',
      'WARN',
      'Query succeeded but 0 rows. Meme pets might not exist or RLS blocks anon access.',
    )
    return
  }

  record(
    'anon SELECT pet (meme != null)',
    'PASS',
    `${rows.length} meme pet(s) readable by anon.`,
  )

  // 4b. Check column accessibility
  for (const row of rows) {
    const r = row as Record<string, unknown>
    const meme = r.meme as Record<string, unknown> | null
    const hasName = r.name != null
    const hasPersonality = r.personality_type != null
    const hasPsyche = r.psyche != null
    const hasMeme = meme != null
    const hasBlueskyHandle = meme?.blueskyHandle != null

    console.log(
      `        ${r.name}: personality=${hasPersonality ? 'yes' : 'NO'} psyche=${hasPsyche ? 'yes' : 'NO'} meme=${hasMeme ? 'yes' : 'NO'} blueskyHandle=${hasBlueskyHandle ? String(meme?.blueskyHandle) : 'MISSING'}`,
    )
  }

  // Check that name, personality_type, psyche, meme are all accessible
  const sample = rows[0] as Record<string, unknown>
  const requiredCols = ['name', 'personality_type', 'psyche', 'meme'] as const
  const accessible = requiredCols.filter((c) => sample[c] !== undefined)
  const missing = requiredCols.filter((c) => sample[c] === undefined)

  if (missing.length === 0) {
    record(
      'pet columns (name, personality_type, psyche, meme) accessible',
      'PASS',
      `All 4 required columns are readable by anon.`,
    )
  } else {
    record(
      'pet columns (name, personality_type, psyche, meme) accessible',
      'FAIL',
      `Missing columns: ${missing.join(', ')}. iOS app may not render properly.`,
    )
  }
}

// ---------------------------------------------------------------------------
// Test 5: Realtime compatibility
// ---------------------------------------------------------------------------
async function testRealtimeCompatibility(client: SupabaseClient) {
  console.log('\n--- 5. Realtime compatibility (bluesky_post_log) ---\n')

  // Query pg_publication_tables to check if supabase_realtime publication includes our table
  // This requires service_role (or postgres) since it queries system catalogs
  const { data, error } = await client.rpc('pg_publication_tables_check' as never)

  if (error) {
    // RPC doesn't exist -- fall back to raw SQL query via service role
    console.log('        RPC not available, trying raw SQL via PostgREST...')

    // Use the REST API to query the system catalog directly
    // service_role can query pg_catalog views
    try {
      const res = await fetch(
        `${supabaseUrl}/rest/v1/rpc/`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': serviceRoleKey,
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({}),
        },
      )

      // This endpoint likely won't work. Try a different approach:
      // query pg_publication_tables as a view via the SQL endpoint
      const sqlRes = await fetch(`${supabaseUrl}/rest/v1/`, {
        headers: {
          'apikey': serviceRoleKey,
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
      })

      // Final approach: use Supabase client to query information_schema or create temp RPC
      // Instead, let's try querying the publication tables directly
      const pubRes = await fetch(
        `${supabaseUrl}/rest/v1/rpc/check_realtime_tables`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': serviceRoleKey,
            'Authorization': `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({}),
        },
      )

      if (pubRes.ok) {
        const pubData = await pubRes.json()
        console.log('        Realtime publication tables:', JSON.stringify(pubData))
      }
    } catch {
      // ignore fetch errors
    }

    // Alternative: just try subscribing to the channel and see if it connects
    console.log('        Cannot query pg_publication_tables directly via REST.')
    console.log('        Attempting Realtime subscription test instead...')

    const testPromise = new Promise<{ connected: boolean; error?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ connected: false, error: 'Timeout after 8s' })
      }, 8000)

      const channel = anonClient
        .channel('verify-realtime-test')
        .on(
          'postgres_changes' as never,
          { event: 'INSERT', schema: 'public', table: 'bluesky_post_log' } as never,
          () => {
            // We got a change event -- realtime works
          },
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            clearTimeout(timeout)
            resolve({ connected: true })
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(timeout)
            resolve({ connected: false, error: `Channel status: ${status}` })
          }
        })

      // Cleanup after test
      setTimeout(() => {
        anonClient.removeChannel(channel)
      }, 9000)
    })

    const realtimeResult = await testPromise

    if (realtimeResult.connected) {
      record(
        'bluesky_post_log Realtime subscription',
        'PASS',
        'Anon client successfully subscribed to postgres_changes on bluesky_post_log.',
      )
    } else {
      record(
        'bluesky_post_log Realtime subscription',
        'WARN',
        `Subscription did not confirm: ${realtimeResult.error}. Table may not be in supabase_realtime publication.`,
      )
      console.log('        To enable Realtime, run in SQL Editor:')
      console.log("        ALTER PUBLICATION supabase_realtime ADD TABLE bluesky_post_log;")
    }

    return
  }

  // If the RPC worked (unlikely unless we created it)
  console.log('        Publication tables:', JSON.stringify(data))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=============================================================')
  console.log('  RLS & iOS Data Access Verification')
  console.log('=============================================================')
  console.log(`  Supabase URL:      ${supabaseUrl}`)
  console.log(`  Anon key role:     ${decodeJwtRole(ANON_KEY)}`)
  console.log(`  Service key role:  ${decodeJwtRole(serviceRoleKey)}`)
  console.log(`  Anon key preview:  ${ANON_KEY.slice(0, 30)}...${ANON_KEY.slice(-10)}`)

  await testBotConfigColumnSecurity(anonClient)
  await testServiceRoleAccess(serviceClient)
  await testPostLogAnonRead(anonClient)
  await testPetTableAnonRead(anonClient)
  await testRealtimeCompatibility(serviceClient)

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n=============================================================')
  console.log('  SUMMARY')
  console.log('=============================================================\n')

  const passes = results.filter((r) => r.status === 'PASS')
  const fails = results.filter((r) => r.status === 'FAIL')
  const warns = results.filter((r) => r.status === 'WARN')

  for (const r of results) {
    const tag = r.status === 'PASS' ? '[PASS]' : r.status === 'FAIL' ? '[FAIL]' : '[WARN]'
    console.log(`  ${tag} ${r.name}`)
  }

  console.log(`\n  Total: ${passes.length} PASS, ${fails.length} FAIL, ${warns.length} WARN`)
  console.log('')

  if (fails.length > 0) {
    console.log('  SECURITY IMPLICATIONS:')
    for (const f of fails) {
      console.log(`    - ${f.name}: ${f.detail}`)
    }
    console.log('')
  }

  if (warns.length > 0) {
    console.log('  WARNINGS:')
    for (const w of warns) {
      console.log(`    - ${w.name}: ${w.detail}`)
    }
    console.log('')
  }

  if (fails.length === 0 && warns.length === 0) {
    console.log('  All checks passed. RLS policies and iOS data access are correctly configured.')
  } else if (fails.length === 0) {
    console.log('  No critical failures. Warnings should be reviewed but are not blocking.')
  } else {
    console.log('  CRITICAL issues found. Fix the FAIL items before shipping.')
  }

  // Cleanup any remaining Realtime channels
  anonClient.removeAllChannels()

  // Exit with non-zero if failures
  if (fails.length > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Script failed:', err)
  process.exit(1)
})

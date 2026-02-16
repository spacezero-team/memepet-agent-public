// scripts/audit-bots.ts
// Comprehensive DB data consistency audit across all 15 active bots.
// Checks: pet table, pet.meme JSONB, bluesky_bot_config, bluesky_post_log.

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

// ── Types ────────────────────────────────────────────────────────────

interface BotConfig {
  readonly id: string
  readonly pet_id: string
  readonly handle: string | null
  readonly did: string | null
  readonly app_password: string | null
  readonly is_active: boolean
}

interface PetRow {
  readonly id: string
  readonly user_id: string | null
  readonly name: string | null
  readonly meme: Record<string, unknown> | null
}

interface PostLogRow {
  readonly id: string
  readonly pet_id: string
  readonly bot_config_id: string | null
  readonly activity_type: string
  readonly created_at: string
}

interface BotAuditResult {
  readonly handle: string
  readonly petId: string
  readonly botConfigId: string
  readonly issues: readonly string[]
  readonly petExists: boolean
  readonly userId: string | null
  readonly memeHasHandle: boolean
  readonly memeHasDid: boolean
  readonly configHasHandle: boolean
  readonly configHasDid: boolean
  readonly configHasAppPassword: boolean
  readonly configIsActive: boolean
  readonly totalPosts: number
  readonly activityTypes: Record<string, number>
  readonly mostRecentPost: string | null
  readonly postsWithNullBotConfigId: number
}

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(80))
  console.log('  MEMEPET BOT DATA CONSISTENCY AUDIT')
  console.log('  ' + new Date().toISOString())
  console.log('='.repeat(80))
  console.log()

  // 1. Fetch all active bot configs
  const { data: botConfigs, error: bcError } = await supabase
    .from('bluesky_bot_config')
    .select('id, pet_id, handle, did, app_password, is_active')
    .eq('is_active', true)
    .order('handle') as { data: BotConfig[] | null; error: any }

  if (bcError) {
    console.error('FATAL: Cannot fetch bluesky_bot_config:', bcError.message)
    process.exit(1)
  }

  const bots = (botConfigs ?? []).filter(b => b.handle !== 'memepet.0.space' && b.handle != null)

  console.log(`Found ${bots.length} active bot configs (excluding memepet.0.space)\n`)

  if (bots.length === 0) {
    console.log('No active bots found. Exiting.')
    return
  }

  // 2. Fetch pet rows for all bot pet_ids
  const petIds = bots.map(b => b.pet_id)
  const { data: pets, error: petsError } = await supabase
    .from('pet')
    .select('id, user_id, name, meme')
    .in('id', petIds) as { data: PetRow[] | null; error: any }

  if (petsError) {
    console.error('FATAL: Cannot fetch pets:', petsError.message)
    process.exit(1)
  }

  const petMap = new Map((pets ?? []).map(p => [p.id, p]))

  // 3. Fetch post_log summary per pet (count + activity types + most recent)
  // We need to do this per-pet since supabase doesn't support GROUP BY directly
  const postSummaries = new Map<string, {
    total: number
    activityTypes: Record<string, number>
    mostRecent: string | null
    nullBotConfigIdCount: number
  }>()

  for (const bot of bots) {
    // Get all posts for this pet
    const { data: posts, error: postsError } = await supabase
      .from('bluesky_post_log')
      .select('id, activity_type, bot_config_id, created_at')
      .eq('pet_id', bot.pet_id)
      .order('created_at', { ascending: false })
      .limit(1000) as { data: PostLogRow[] | null; error: any }

    if (postsError) {
      console.error(`  Error fetching posts for ${bot.handle}: ${postsError.message}`)
      postSummaries.set(bot.pet_id, {
        total: 0,
        activityTypes: {},
        mostRecent: null,
        nullBotConfigIdCount: 0,
      })
      continue
    }

    const allPosts = posts ?? []
    const activityTypes: Record<string, number> = {}
    let nullBotConfigIdCount = 0

    for (const post of allPosts) {
      const at = post.activity_type ?? 'unknown'
      activityTypes[at] = (activityTypes[at] ?? 0) + 1
      if (post.bot_config_id == null) {
        nullBotConfigIdCount++
      }
    }

    postSummaries.set(bot.pet_id, {
      total: allPosts.length,
      activityTypes,
      mostRecent: allPosts.length > 0 ? allPosts[0].created_at : null,
      nullBotConfigIdCount,
    })
  }

  // 4. Audit each bot
  const results: BotAuditResult[] = []

  for (const bot of bots) {
    const issues: string[] = []
    const pet = petMap.get(bot.pet_id)
    const postSummary = postSummaries.get(bot.pet_id)!

    // Check pet existence
    const petExists = pet != null
    if (!petExists) {
      issues.push('PET_MISSING: No pet row in pet table')
    }

    // Check user_id
    const userId = pet?.user_id ?? null
    if (petExists && userId == null) {
      issues.push('USER_ID_NULL: pet.user_id is NULL')
    }

    // Check meme JSONB bluesky fields
    const meme = pet?.meme ?? null
    const memeHasHandle = meme?.blueskyHandle != null && meme.blueskyHandle !== ''
    const memeHasDid = meme?.blueskyDid != null && meme.blueskyDid !== ''

    if (petExists && !memeHasHandle) {
      issues.push('MEME_NO_HANDLE: pet.meme.blueskyHandle missing or empty')
    }
    if (petExists && !memeHasDid) {
      issues.push('MEME_NO_DID: pet.meme.blueskyDid missing or empty')
    }

    // Check bot_config fields
    const configHasHandle = bot.handle != null && bot.handle !== ''
    const configHasDid = bot.did != null && bot.did !== ''
    const configHasAppPassword = bot.app_password != null && bot.app_password !== ''

    if (!configHasHandle) {
      issues.push('CONFIG_NO_HANDLE: bluesky_bot_config.handle missing')
    }
    if (!configHasDid) {
      issues.push('CONFIG_NO_DID: bluesky_bot_config.did missing')
    }
    if (!configHasAppPassword) {
      issues.push('CONFIG_NO_APP_PWD: bluesky_bot_config.app_password missing')
    }

    // Check post data
    if (postSummary.total === 0) {
      issues.push('ZERO_POSTS: No entries in bluesky_post_log')
    }
    if (postSummary.nullBotConfigIdCount > 0) {
      issues.push(`NULL_BOT_CONFIG_ID: ${postSummary.nullBotConfigIdCount} post(s) have NULL bot_config_id`)
    }

    results.push({
      handle: bot.handle ?? '(null)',
      petId: bot.pet_id,
      botConfigId: bot.id,
      issues,
      petExists,
      userId,
      memeHasHandle,
      memeHasDid,
      configHasHandle,
      configHasDid,
      configHasAppPassword,
      configIsActive: bot.is_active,
      totalPosts: postSummary.total,
      activityTypes: postSummary.activityTypes,
      mostRecentPost: postSummary.mostRecent,
      postsWithNullBotConfigId: postSummary.nullBotConfigIdCount,
    })
  }

  // 5. Print detailed results per bot
  console.log('-'.repeat(80))
  console.log('  PER-BOT DETAILS')
  console.log('-'.repeat(80))

  for (const r of results) {
    const status = r.issues.length === 0 ? 'HEALTHY' : 'BROKEN'
    console.log(`\n[${status}] @${r.handle}`)
    console.log(`  pet_id:         ${r.petId}`)
    console.log(`  bot_config_id:  ${r.botConfigId}`)
    console.log(`  pet exists:     ${r.petExists}`)
    console.log(`  user_id:        ${r.userId ?? 'NULL'}`)
    console.log(`  meme.handle:    ${r.memeHasHandle ? 'YES' : 'MISSING'}`)
    console.log(`  meme.did:       ${r.memeHasDid ? 'YES' : 'MISSING'}`)
    console.log(`  config.handle:  ${r.configHasHandle ? 'YES' : 'MISSING'}`)
    console.log(`  config.did:     ${r.configHasDid ? 'YES' : 'MISSING'}`)
    console.log(`  config.app_pwd: ${r.configHasAppPassword ? 'YES (set)' : 'MISSING'}`)
    console.log(`  config.active:  ${r.configIsActive}`)
    console.log(`  total posts:    ${r.totalPosts}`)
    if (Object.keys(r.activityTypes).length > 0) {
      console.log(`  activity types: ${Object.entries(r.activityTypes).map(([k, v]) => `${k}=${v}`).join(', ')}`)
    }
    console.log(`  most recent:    ${r.mostRecentPost ?? 'N/A'}`)
    if (r.postsWithNullBotConfigId > 0) {
      console.log(`  null config_id: ${r.postsWithNullBotConfigId} posts`)
    }
    if (r.issues.length > 0) {
      console.log(`  ISSUES:`)
      for (const issue of r.issues) {
        console.log(`    - ${issue}`)
      }
    }
  }

  // 6. Cross-table integrity checks
  console.log('\n' + '-'.repeat(80))
  console.log('  CROSS-TABLE INTEGRITY CHECKS')
  console.log('-'.repeat(80))

  // 6a. Orphan post_log records (posts whose pet_id has no matching bot_config)
  const { data: allPostPetIds } = await supabase
    .from('bluesky_post_log')
    .select('pet_id')
    .limit(5000) as { data: Array<{ pet_id: string }> | null }

  const botPetIdSet = new Set(bots.map(b => b.pet_id))

  // Also fetch ALL bot_config pet_ids (including inactive) for orphan check
  const { data: allBotConfigs } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id')
    .limit(500) as { data: Array<{ pet_id: string }> | null }

  const allBotConfigPetIdSet = new Set((allBotConfigs ?? []).map(b => b.pet_id))
  const uniquePostPetIds = [...new Set((allPostPetIds ?? []).map(p => p.pet_id))]
  const orphanPostPetIds = uniquePostPetIds.filter(pid => !allBotConfigPetIdSet.has(pid))

  console.log(`\n[ORPHAN POSTS] Posts in post_log without matching bot_config:`)
  if (orphanPostPetIds.length === 0) {
    console.log('  None found -- all post_log pet_ids match a bot_config.')
  } else {
    for (const pid of orphanPostPetIds) {
      const count = (allPostPetIds ?? []).filter(p => p.pet_id === pid).length
      console.log(`  pet_id ${pid}: ${count} orphan post(s)`)
    }
  }

  // 6b. Bots with ZERO posts
  const zeroPosts = results.filter(r => r.totalPosts === 0)
  console.log(`\n[ZERO POSTS] Active bots with no posts:`)
  if (zeroPosts.length === 0) {
    console.log('  None -- all active bots have at least one post.')
  } else {
    for (const r of zeroPosts) {
      console.log(`  @${r.handle} (pet_id: ${r.petId})`)
    }
  }

  // 6c. Pets where user_id is NULL
  const nullUserIds = results.filter(r => r.userId == null && r.petExists)
  console.log(`\n[NULL USER_ID] Pets where user_id is NULL:`)
  if (nullUserIds.length === 0) {
    console.log('  None -- all pets have a user_id.')
  } else {
    for (const r of nullUserIds) {
      console.log(`  @${r.handle} (pet_id: ${r.petId})`)
    }
  }

  // 6d. Posts with NULL bot_config_id
  const nullConfigIdBots = results.filter(r => r.postsWithNullBotConfigId > 0)
  console.log(`\n[NULL BOT_CONFIG_ID] Posts where bot_config_id is NULL:`)
  if (nullConfigIdBots.length === 0) {
    console.log('  None -- all posts have a valid bot_config_id.')
  } else {
    for (const r of nullConfigIdBots) {
      console.log(`  @${r.handle}: ${r.postsWithNullBotConfigId} post(s) with NULL bot_config_id`)
    }
  }

  // 7. Summary table
  console.log('\n' + '='.repeat(80))
  console.log('  SUMMARY TABLE')
  console.log('='.repeat(80))

  const healthy = results.filter(r => r.issues.length === 0)
  const broken = results.filter(r => r.issues.length > 0)

  // Print table header
  const colHandle = 28
  const colStat = 8
  const colPosts = 7
  const colIssues = 30

  const pad = (s: string, n: number) => s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length)

  console.log()
  console.log(
    pad('Handle', colHandle) +
    pad('Status', colStat) +
    pad('Posts', colPosts) +
    'Issues'
  )
  console.log('-'.repeat(80))

  for (const r of results) {
    const status = r.issues.length === 0 ? 'OK' : 'BROKEN'
    const issueStr = r.issues.length === 0 ? '--' : r.issues.map(i => i.split(':')[0]).join(', ')
    console.log(
      pad(`@${r.handle}`, colHandle) +
      pad(status, colStat) +
      pad(String(r.totalPosts), colPosts) +
      issueStr
    )
  }

  console.log('-'.repeat(80))
  console.log(`HEALTHY: ${healthy.length}  |  BROKEN: ${broken.length}  |  TOTAL: ${results.length}`)
  console.log()

  // 8. Unique issue counts
  if (broken.length > 0) {
    const issueCounts: Record<string, number> = {}
    for (const r of broken) {
      for (const issue of r.issues) {
        const code = issue.split(':')[0]
        issueCounts[code] = (issueCounts[code] ?? 0) + 1
      }
    }

    console.log('Issue breakdown:')
    for (const [code, count] of Object.entries(issueCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${code}: ${count} bot(s)`)
    }
    console.log()
  }

  console.log('Audit complete.')
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})

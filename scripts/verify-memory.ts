/**
 * Memory, Mood & Personality Verification Script
 *
 * Checks all memory subsystems are working correctly:
 * 1. Bot memory (bot_memory table)
 * 2. Schedule state (bluesky_bot_config.schedule_state)
 * 3. Personality data (pet.psyche + pet.meme)
 * 4. Relationship memory (pet_relationship table)
 * 5. Activity log diversity (bluesky_post_log grouped by activity_type)
 * 6. Post content analysis (voice/personality distinctness per pet)
 *
 * Usage: npx tsx scripts/verify-memory.ts
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ─── Load .env.local ────────────────────────────────────

const scriptDir = typeof __dirname !== 'undefined' ? __dirname : new URL('.', import.meta.url).pathname
const envPath = resolve(scriptDir, '..', '.env.local')
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

import { createClient } from '@supabase/supabase-js'

// ─── Supabase Client ─────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  { auth: { persistSession: false, autoRefreshToken: false } }
)

// ─── Formatting Helpers ──────────────────────────────────

const PASS = '\x1b[32mPASS\x1b[0m'
const FAIL = '\x1b[31mFAIL\x1b[0m'
const WARN = '\x1b[33mWARN\x1b[0m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

function header(title: string): void {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`${BOLD}  ${title}${RESET}`)
  console.log('='.repeat(60))
}

function result(label: string, pass: boolean, detail?: string): void {
  const badge = pass ? PASS : FAIL
  const suffix = detail ? ` -- ${detail}` : ''
  console.log(`  [${badge}] ${label}${suffix}`)
}

function warn(label: string, detail: string): void {
  console.log(`  [${WARN}] ${label} -- ${detail}`)
}

function info(label: string): void {
  console.log(`         ${label}`)
}

// ─── Check 1: Bot Memory ─────────────────────────────────

async function checkBotMemory(): Promise<boolean> {
  header('1. Bot Memory (bot_memory table)')

  // First confirm the table exists
  const { data: tableCheck, error: tableError } = await supabase
    .from('bot_memory')
    .select('pet_id')
    .limit(1)

  if (tableError) {
    result('bot_memory table exists', false, tableError.message)
    return false
  }

  result('bot_memory table exists', true)

  // Get 2 active bot pet_ids
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle')
    .eq('is_active', true)
    .limit(3)

  const activeBots = (bots ?? []).filter((b: any) => b.handle !== 'memepet.0.space')

  if (activeBots.length < 2) {
    result('At least 2 active bots found', false, `found ${activeBots.length}`)
    return false
  }

  result('At least 2 active bots found', true, `${activeBots.length} bots`)

  let allPass = true
  for (const bot of activeBots.slice(0, 2)) {
    const { data: memRow } = await supabase
      .from('bot_memory')
      .select('memory')
      .eq('pet_id', bot.pet_id)
      .maybeSingle()

    if (!memRow?.memory) {
      result(`Memory for @${bot.handle}`, false, 'no memory row found')
      allPass = false
      continue
    }

    const memory = memRow.memory as Record<string, unknown>
    const recentPosts = Array.isArray(memory.recentPosts) ? memory.recentPosts : []
    const topicCooldowns = typeof memory.topicCooldowns === 'object' ? Object.keys(memory.topicCooldowns ?? {}) : []
    const relationships = Array.isArray(memory.relationships) ? memory.relationships : []
    const reflections = Array.isArray(memory.reflections) ? memory.reflections : []
    const moodState = memory.moodState as Record<string, unknown> | undefined
    const narrativeArc = memory.narrativeArc as string | undefined

    const hasContent = recentPosts.length > 0

    result(
      `Memory for @${bot.handle}`,
      hasContent,
      hasContent
        ? `${recentPosts.length} recent posts, ${topicCooldowns.length} cooldowns, ${relationships.length} relationships, ${reflections.length} reflections`
        : 'memory exists but recentPosts is empty'
    )

    if (recentPosts.length > 0) {
      const latest = recentPosts[0] as Record<string, unknown>
      info(`  Latest post: [${latest.mood}] "${(latest.gist as string)?.slice(0, 60)}" (topic: ${latest.topic})`)
    }

    if (moodState) {
      info(`  Mood state: P=${(moodState.pleasure as number)?.toFixed(2)} A=${(moodState.arousal as number)?.toFixed(2)} D=${(moodState.dominance as number)?.toFixed(2)} => ${moodState.currentEmotion}`)
    }

    if (narrativeArc) {
      info(`  Narrative arc: "${narrativeArc.slice(0, 80)}..."`)
    }

    if (!hasContent) allPass = false
  }

  return allPass
}

// ─── Check 2: Schedule State ─────────────────────────────

async function checkScheduleState(): Promise<boolean> {
  header('2. Schedule State (bluesky_bot_config.schedule_state)')

  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, schedule_state, chronotype, utc_offset_hours')
    .eq('is_active', true)

  const activeBots = (bots ?? []).filter((b: any) => b.handle !== 'memepet.0.space')

  if (activeBots.length < 3) {
    result('3 active bots found', false, `found ${activeBots.length}`)
    return activeBots.length >= 1
  }

  result('3 active bots found', true)

  let allPass = true
  for (const bot of activeBots.slice(0, 3)) {
    const state = bot.schedule_state as Record<string, unknown> | null

    if (!state) {
      result(`Schedule for @${bot.handle}`, false, 'schedule_state is null')
      allPass = false
      continue
    }

    const hasLastPostAt = 'lastPostAt' in state
    const hasDailyMood = 'dailyMood' in state && typeof state.dailyMood === 'object'
    const hasPostsToday = 'postsToday' in state
    const hasMoodDate = 'moodDate' in state

    const requiredFields = hasLastPostAt && hasDailyMood && hasPostsToday && hasMoodDate

    result(
      `Schedule for @${bot.handle}`,
      requiredFields,
      requiredFields
        ? 'all required fields present'
        : `missing: ${[
            !hasLastPostAt && 'lastPostAt',
            !hasDailyMood && 'dailyMood',
            !hasPostsToday && 'postsToday',
            !hasMoodDate && 'moodDate',
          ].filter(Boolean).join(', ')}`
    )

    if (hasDailyMood) {
      const mood = state.dailyMood as Record<string, unknown>
      info(`  Daily mood: label="${mood.label}", multiplier=${mood.frequencyMultiplier}`)
    }

    info(`  postsToday: ${state.postsToday ?? 0}, lastPostAt: ${state.lastPostAt ?? 'never'}`)
    info(`  chronotype: ${bot.chronotype ?? 'normal'}, UTC offset: ${bot.utc_offset_hours ?? -5}`)

    if (!requiredFields) allPass = false
  }

  return allPass
}

// ─── Check 3: Personality Data ────────────────────────────

async function checkPersonalityData(): Promise<boolean> {
  header('3. Personality Data (pet.psyche + pet.meme)')

  // Get active pet IDs from bluesky_bot_config
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle')
    .eq('is_active', true)

  const activeBots = (bots ?? []).filter((b: any) => b.handle !== 'memepet.0.space')

  if (activeBots.length === 0) {
    result('Active pets found', false, 'no active bots')
    return false
  }

  const petIds = activeBots.slice(0, 3).map((b: any) => b.pet_id)
  const handleMap = new Map(activeBots.map((b: any) => [b.pet_id, b.handle]))

  const { data: pets, error } = await supabase
    .from('pet')
    .select('id, name, personality_type, psyche, meme')
    .in('id', petIds)

  if (error || !pets || pets.length === 0) {
    result('Pet rows found', false, error?.message ?? 'no pets returned')
    return false
  }

  result('Pet rows found', true, `${pets.length} pets`)

  let allPass = true
  for (const pet of pets) {
    const handle = handleMap.get(pet.id) ?? 'unknown'
    const psyche = pet.psyche as Record<string, unknown> | null
    const meme = pet.meme as Record<string, unknown> | null

    const hasPsyche = psyche !== null && Object.keys(psyche).length > 0
    const hasMeme = meme !== null && Object.keys(meme).length > 0

    result(
      `@${handle} (${pet.name})`,
      hasPsyche && hasMeme,
      `psyche: ${hasPsyche ? 'populated' : 'EMPTY'}, meme: ${hasMeme ? 'populated' : 'EMPTY'}`
    )

    if (hasPsyche) {
      const personalityType = pet.personality_type ?? 'unknown'
      const dominantEmotion = (psyche as Record<string, unknown>).dominant_emotion ?? 'unknown'
      const traits = (psyche as Record<string, unknown>).traits as Record<string, number> | undefined
      const innerMonologue = (psyche as Record<string, unknown>).inner_monologue as string | undefined

      info(`  personality_type: ${personalityType}`)
      info(`  dominant_emotion: ${dominantEmotion}`)
      if (traits) {
        info(`  traits: playfulness=${traits.playfulness?.toFixed(2)}, curiosity=${traits.curiosity?.toFixed(2)}, expressiveness=${traits.expressiveness?.toFixed(2)}, independence=${traits.independence?.toFixed(2)}`)
      }
      if (innerMonologue) {
        info(`  inner_monologue: "${innerMonologue.slice(0, 80)}..."`)
      }
    }

    if (hasMeme) {
      const memePersonality = ((meme as Record<string, unknown>).personality ?? {}) as Record<string, unknown>
      const archetype = memePersonality.archetype ?? 'unknown'
      const humorStyle = memePersonality.humorStyle ?? 'unknown'
      const catchphrases = Array.isArray(memePersonality.catchphrases)
        ? (memePersonality.catchphrases as string[]).slice(0, 3)
        : []

      info(`  meme archetype: ${archetype}`)
      info(`  humor style: ${humorStyle}`)
      if (catchphrases.length > 0) {
        info(`  catchphrases: ${catchphrases.map(c => `"${c}"`).join(', ')}`)
      }
    }

    if (!hasPsyche || !hasMeme) allPass = false
  }

  return allPass
}

// ─── Check 4: Relationship Memory ─────────────────────────

async function checkRelationshipMemory(): Promise<boolean> {
  header('4. Relationship Memory (pet_relationship table)')

  // Check if the table exists and has data
  const { data: relRows, error: relError } = await supabase
    .from('pet_relationship')
    .select('pet_id_a, pet_id_b, sentiment, sentiment_score, interaction_count, last_interaction_type, last_interaction_at')
    .order('interaction_count', { ascending: false })
    .limit(10)

  if (relError) {
    result('pet_relationship table exists', false, relError.message)
    return false
  }

  result('pet_relationship table exists', true)

  if (!relRows || relRows.length === 0) {
    warn('Relationship entries found', 'no relationships recorded yet (may need more interactions)')
    return true // Not a failure - relationships build over time
  }

  result('Relationship entries found', true, `${relRows.length} relationships`)

  // Get pet names for display
  const allPetIds = new Set<string>()
  for (const r of relRows) {
    allPetIds.add(r.pet_id_a)
    allPetIds.add(r.pet_id_b)
  }

  const { data: petNames } = await supabase
    .from('pet')
    .select('id, name')
    .in('id', Array.from(allPetIds))

  const nameMap = new Map((petNames ?? []).map((p: any) => [p.id, p.name]))

  for (const rel of relRows.slice(0, 5)) {
    const nameA = nameMap.get(rel.pet_id_a) ?? rel.pet_id_a.slice(0, 8)
    const nameB = nameMap.get(rel.pet_id_b) ?? rel.pet_id_b.slice(0, 8)
    const score = typeof rel.sentiment_score === 'number' ? rel.sentiment_score.toFixed(2) : '?'
    const age = rel.last_interaction_at
      ? formatAge(rel.last_interaction_at)
      : 'unknown'

    info(`  ${nameA} <-> ${nameB}: ${rel.sentiment} (score: ${score}, interactions: ${rel.interaction_count}, last: ${rel.last_interaction_type ?? '?'} ${age})`)
  }

  return true
}

// ─── Check 5: Activity Log Diversity ──────────────────────

async function checkActivityLogDiversity(): Promise<boolean> {
  header('5. Activity Log Diversity (last 6 hours)')

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()

  // Get all activity types in the last 6 hours
  const { data: logs, error: logError } = await supabase
    .from('bluesky_post_log')
    .select('activity_type')
    .gte('created_at', sixHoursAgo)

  if (logError) {
    result('bluesky_post_log query', false, logError.message)
    return false
  }

  if (!logs || logs.length === 0) {
    // Expand to 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { data: logsExtended } = await supabase
      .from('bluesky_post_log')
      .select('activity_type')
      .gte('created_at', twentyFourHoursAgo)

    if (!logsExtended || logsExtended.length === 0) {
      result('Activity entries found (last 24h)', false, 'no activity in last 24 hours')
      return false
    }

    warn('Activity entries (last 6h)', 'none -- expanding to 24h window')
    return analyzeActivityDistribution(logsExtended, '24h')
  }

  return analyzeActivityDistribution(logs, '6h')
}

function analyzeActivityDistribution(
  logs: Array<{ activity_type: string }>,
  window: string
): boolean {
  // Group by activity_type
  const distribution = new Map<string, number>()
  for (const log of logs) {
    const type = log.activity_type ?? 'unknown'
    distribution.set(type, (distribution.get(type) ?? 0) + 1)
  }

  result(`Activity entries found (last ${window})`, true, `${logs.length} total entries`)

  // Sort by count descending
  const sorted = Array.from(distribution.entries()).sort((a, b) => b[1] - a[1])

  info('  Distribution:')
  for (const [type, count] of sorted) {
    const pct = ((count / logs.length) * 100).toFixed(1)
    const bar = '#'.repeat(Math.min(30, Math.round(count / logs.length * 30)))
    info(`    ${type.padEnd(25)} ${String(count).padStart(4)} (${pct.padStart(5)}%) ${bar}`)
  }

  // Check for diversity: at least 2 different activity types
  const hasProactive = distribution.has('proactive_post') || distribution.has('proactive_thread')
  const hasReactive = distribution.has('reactive_reply')
  const hasInteraction = distribution.has('interaction_initiate')

  const typeCount = distribution.size
  result(
    'Activity type diversity',
    typeCount >= 2,
    `${typeCount} distinct types (proactive: ${hasProactive ? 'yes' : 'no'}, reactive: ${hasReactive ? 'yes' : 'no'}, interaction: ${hasInteraction ? 'yes' : 'no'})`
  )

  return typeCount >= 2
}

// ─── Check 6: Post Content Analysis ──────────────────────

async function checkPostContentAnalysis(): Promise<boolean> {
  header('6. Post Content Analysis (voice distinctness)')

  // Get active pet IDs
  const { data: bots } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle')
    .eq('is_active', true)

  const activeBots = (bots ?? []).filter((b: any) => b.handle !== 'memepet.0.space')

  if (activeBots.length === 0) {
    result('Active bots found', false, 'none')
    return false
  }

  // Get pet names
  const petIds = activeBots.map((b: any) => b.pet_id)
  const { data: petNameRows } = await supabase
    .from('pet')
    .select('id, name, personality_type')
    .in('id', petIds)

  const petInfoMap = new Map(
    (petNameRows ?? []).map((p: any) => [p.id, { name: p.name, type: p.personality_type }])
  )

  const handleMap = new Map(activeBots.map((b: any) => [b.pet_id, b.handle]))

  // Get 5 proactive posts from different pet_ids
  const postsPerPet: Array<{
    petId: string
    petName: string
    handle: string
    personalityType: string
    content: string
    mood: string
    intentType: string
  }> = []

  for (const bot of activeBots.slice(0, 5)) {
    const { data: posts } = await supabase
      .from('bluesky_post_log')
      .select('content, metadata')
      .eq('pet_id', bot.pet_id)
      .eq('activity_type', 'proactive_post')
      .order('created_at', { ascending: false })
      .limit(1)

    if (posts && posts.length > 0) {
      const post = posts[0]
      const meta = (post.metadata ?? {}) as Record<string, unknown>
      const petInfo = petInfoMap.get(bot.pet_id) ?? { name: 'Unknown', type: 'unknown' }

      postsPerPet.push({
        petId: bot.pet_id,
        petName: petInfo.name,
        handle: handleMap.get(bot.pet_id) ?? 'unknown',
        personalityType: petInfo.type,
        content: post.content ?? '',
        mood: (meta.mood as string) ?? 'unknown',
        intentType: (meta.intentType as string) ?? 'unknown',
      })
    }
  }

  if (postsPerPet.length === 0) {
    result('Proactive posts found', false, 'no proactive_post entries')
    return false
  }

  result('Proactive posts found', true, `${postsPerPet.length} different pets`)

  // Display posts
  for (const p of postsPerPet) {
    const snippet = p.content.length > 120 ? p.content.slice(0, 120) + '...' : p.content
    info('')
    info(`  @${p.handle} (${p.petName}) [${p.personalityType}]`)
    info(`  Mood: ${p.mood} | Intent: ${p.intentType}`)
    info(`  Post: "${snippet}"`)
  }

  // Check for voice distinctness: look for variation in content/mood/style
  if (postsPerPet.length >= 2) {
    const uniqueContents = new Set(postsPerPet.map(p => p.content))
    const uniqueMoods = new Set(postsPerPet.map(p => p.mood))
    const uniqueTypes = new Set(postsPerPet.map(p => p.personalityType))

    const allUnique = uniqueContents.size === postsPerPet.length
    const diverseMoods = uniqueMoods.size >= 2 || postsPerPet.length < 3
    const diverseTypes = uniqueTypes.size >= 2 || postsPerPet.length < 3

    result(
      'All posts unique (no duplicates)',
      allUnique,
      allUnique ? 'each post is distinct' : 'DUPLICATE content detected'
    )

    result(
      'Mood/personality diversity',
      diverseMoods || diverseTypes,
      `${uniqueMoods.size} unique moods, ${uniqueTypes.size} unique personality types`
    )

    return allUnique && (diverseMoods || diverseTypes)
  }

  warn('Voice comparison', 'only 1 pet has proactive posts -- cannot compare distinctness')
  return true
}

// ─── Helpers ─────────────────────────────────────────────

function formatAge(isoTimestamp: string): string {
  const diffMs = Date.now() - new Date(isoTimestamp).getTime()
  const hours = Math.floor(diffMs / (60 * 60 * 1000))
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ─── Main ────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`${BOLD}MemePet Memory/Mood/Personality Verification${RESET}`)
  console.log(`Timestamp: ${new Date().toISOString()}`)
  console.log(`Supabase URL: ${process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'NOT SET'}`)

  const results: Array<{ name: string; passed: boolean }> = []

  try {
    results.push({ name: 'Bot Memory', passed: await checkBotMemory() })
  } catch (e) {
    results.push({ name: 'Bot Memory', passed: false })
    console.error(`  [${FAIL}] Error: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    results.push({ name: 'Schedule State', passed: await checkScheduleState() })
  } catch (e) {
    results.push({ name: 'Schedule State', passed: false })
    console.error(`  [${FAIL}] Error: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    results.push({ name: 'Personality Data', passed: await checkPersonalityData() })
  } catch (e) {
    results.push({ name: 'Personality Data', passed: false })
    console.error(`  [${FAIL}] Error: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    results.push({ name: 'Relationship Memory', passed: await checkRelationshipMemory() })
  } catch (e) {
    results.push({ name: 'Relationship Memory', passed: false })
    console.error(`  [${FAIL}] Error: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    results.push({ name: 'Activity Log Diversity', passed: await checkActivityLogDiversity() })
  } catch (e) {
    results.push({ name: 'Activity Log Diversity', passed: false })
    console.error(`  [${FAIL}] Error: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    results.push({ name: 'Post Content Analysis', passed: await checkPostContentAnalysis() })
  } catch (e) {
    results.push({ name: 'Post Content Analysis', passed: false })
    console.error(`  [${FAIL}] Error: ${e instanceof Error ? e.message : String(e)}`)
  }

  // ─── Summary ────────────────────────────────────────────

  header('SUMMARY')
  const passed = results.filter(r => r.passed).length
  const total = results.length

  for (const r of results) {
    console.log(`  ${r.passed ? PASS : FAIL}  ${r.name}`)
  }

  console.log('')
  console.log(`  ${BOLD}Result: ${passed}/${total} checks passed${RESET}`)
  console.log('')

  if (passed < total) {
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(`Fatal error: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})

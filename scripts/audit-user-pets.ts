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

async function main() {
  // Get ALL pets with meme data (these show in iOS app)
  const { data: allMemePets } = await supabase
    .from('pet')
    .select('id, name, user_id, meme')
    .not('meme', 'is', null)
    .order('user_id')

  // Get all bot configs
  const { data: botConfigs } = await supabase
    .from('bluesky_bot_config')
    .select('pet_id, handle, did, is_active')

  const botConfigMap = new Map((botConfigs ?? []).map((b: any) => [b.pet_id, b]))

  // Get post counts per pet
  const { data: postCounts } = await supabase
    .from('bluesky_post_log')
    .select('pet_id')

  const postCountMap = new Map<string, number>()
  for (const p of (postCounts ?? [])) {
    postCountMap.set(p.pet_id, (postCountMap.get(p.pet_id) ?? 0) + 1)
  }

  // Group by user_id
  const byUser = new Map<string, any[]>()
  for (const pet of (allMemePets ?? [])) {
    const userId = pet.user_id ?? 'NULL'
    if (!byUser.has(userId)) byUser.set(userId, [])
    byUser.get(userId)?.push(pet)
  }

  console.log('=== All Meme Pets by Owner (what iOS app shows) ===\n')

  for (const [userId, pets] of byUser) {
    console.log(`--- Owner: ${userId} (${pets.length} meme pets) ---`)

    for (const pet of pets) {
      const meme = pet.meme as any
      const handle = meme?.blueskyHandle ?? null
      const did = meme?.blueskyDid ?? null
      const botConfig = botConfigMap.get(pet.id)
      const posts = postCountMap.get(pet.id) ?? 0

      const issues: string[] = []
      if (!handle) issues.push('NO blueskyHandle in meme')
      if (!did) issues.push('NO blueskyDid in meme')
      if (!botConfig) issues.push('NO bot_config row')
      else if (!botConfig.is_active) issues.push('bot_config INACTIVE')
      if (posts === 0) issues.push('ZERO posts')

      const status = issues.length === 0 ? 'OK' : `BROKEN: ${issues.join(', ')}`
      const handleStr = handle ? `@${handle}` : '(no handle)'

      console.log(`  ${pet.name} ${handleStr} | ${posts} posts | ${status}`)
    }
    console.log()
  }
}

main().catch(console.error)

/**
 * Bluesky Profile Setup Endpoint
 *
 * Sets avatar (from Cloudinary thumbnail) and displayName for meme pet bots.
 *
 * POST /api/v1/craft/agent/bluesky/set-profile
 * Body: { petId: string } — single pet
 *   OR: { all: true } — all active bots
 */

import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { getServiceSupabase } from '@/lib/api/service-supabase'
import { BlueskyBotClient, type BlueskyBotConfig } from '@/lib/services/bluesky-client'

function verifyApiKey(provided: string | null): boolean {
  const expected = process.env.API_KEY
  if (!provided || !expected) return false
  try {
    return timingSafeEqual(
      Buffer.from(provided),
      Buffer.from(expected)
    )
  } catch {
    return false
  }
}

export const maxDuration = 60

interface PetProfileData {
  petId: string
  name: string
  thumbnailFileId: string | null
  backstory: string | null
  handle: string
  appPassword: string
  did: string | null
}

async function loadPetProfileData(petId?: string): Promise<PetProfileData[]> {
  const supabase = getServiceSupabase()

  let botQuery = (supabase as any)
    .from('bluesky_bot_config')
    .select('pet_id, handle, did, app_password')
    .eq('is_active', true)

  if (petId) {
    botQuery = botQuery.eq('pet_id', petId)
  }

  const { data: bots, error: botError } = await botQuery as {
    data: Array<{ pet_id: string; handle: string; did: string | null; app_password: string }> | null
    error: any
  }

  if (botError || !bots || bots.length === 0) return []

  const petIds = bots.map(b => b.pet_id)
  const { data: pets, error: petError } = await (supabase as any)
    .from('pet')
    .select('id, name, thumbnail_file_id, meme')
    .in('id', petIds) as {
    data: Array<{
      id: string
      name: string
      thumbnail_file_id: string | null
      meme: { memePersonality?: { backstory?: string } } | null
    }> | null
    error: any
  }

  if (petError || !pets) return []

  const petMap = new Map(pets.map(p => [p.id, p]))

  return bots.map(bot => {
    const pet = petMap.get(bot.pet_id)
    return {
      petId: bot.pet_id,
      name: pet?.name ?? bot.handle,
      thumbnailFileId: pet?.thumbnail_file_id ?? null,
      backstory: pet?.meme?.memePersonality?.backstory?.slice(0, 300) ?? null,
      handle: bot.handle,
      appPassword: bot.app_password,
      did: bot.did
    }
  })
}

function buildCloudinaryUrl(thumbnailFileId: string): string {
  return `https://res.cloudinary.com/space-zero/image/upload/${thumbnailFileId}`
}

export async function POST(req: Request) {
  try {
    const apiKey = req.headers.get('x-api-key')
    if (!verifyApiKey(apiKey)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json() as { petId?: string; all?: boolean }

    if (!body.petId && !body.all) {
      return NextResponse.json(
        { error: 'Either petId or { all: true } is required' },
        { status: 400 }
      )
    }

    const pets = await loadPetProfileData(body.all ? undefined : body.petId)

    if (pets.length === 0) {
      return NextResponse.json(
        { error: 'No matching active bots found' },
        { status: 404 }
      )
    }

    const results: Array<{
      petId: string
      handle: string
      displayName: string
      hasAvatar: boolean
      success: boolean
      error?: string
    }> = []

    // Process sequentially to avoid rate limits
    for (const pet of pets) {
      try {
        const config: BlueskyBotConfig = {
          petId: pet.petId,
          handle: pet.handle,
          did: pet.did ?? undefined,
          appPassword: pet.appPassword
        }

        const client = new BlueskyBotClient(config)
        await client.authenticate()

        const avatarUrl = pet.thumbnailFileId
          ? buildCloudinaryUrl(pet.thumbnailFileId)
          : undefined

        await client.setProfile({
          displayName: pet.name,
          description: pet.backstory ?? undefined,
          avatarUrl
        })

        results.push({
          petId: pet.petId,
          handle: pet.handle,
          displayName: pet.name,
          hasAvatar: !!avatarUrl,
          success: true
        })
      } catch (error) {
        results.push({
          petId: pet.petId,
          handle: pet.handle,
          displayName: pet.name,
          hasAvatar: !!pet.thumbnailFileId,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    const successCount = results.filter(r => r.success).length

    return NextResponse.json({
      success: successCount > 0,
      total: results.length,
      successCount,
      failCount: results.length - successCount,
      results
    })
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set profiles'
      },
      { status: 500 }
    )
  }
}

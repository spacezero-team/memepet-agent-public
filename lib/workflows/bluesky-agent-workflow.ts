/**
 * Bluesky Agent Workflow
 *
 * Upstash Workflow that handles autonomous Bluesky bot behavior:
 * - Proactive posting: Generate and publish posts on a schedule
 * - Reactive replies: Respond to mentions and replies
 * - Inter-pet interactions: Initiate conversations between meme pets
 *
 * Follows the same CraftingWorkflow interface as X-Agent for consistency.
 *
 * @module bluesky-agent-workflow
 */

import { WorkflowContext } from '@upstash/workflow'
import { getServiceSupabase } from '@/lib/api/service-supabase'
import { BLUESKY_CONFIG } from '@/lib/config/bluesky.config'
import { BlueskyBotClient, type BlueskyBotConfig, type BlueskyReplyRef } from '@/lib/services/bluesky-client'
import {
  generateAutonomousPost,
  generateReply,
  decideInteraction,
  type MemePetPersonalityData
} from './modules/bluesky-post-generator'
import type { CraftingWorkflow } from './workflow-interface'

// ─── Request Types ──────────────────────────────────

export type BlueskyAgentMode = 'proactive' | 'reactive' | 'interaction'

export interface BlueskyAgentWorkflowRequest {
  mode: BlueskyAgentMode
  petId: string
  /** For reactive mode: notification data */
  notification?: {
    uri: string
    cid: string
    authorHandle: string
    authorDid: string
    text: string
    reason: 'mention' | 'reply'
    rootUri?: string
    rootCid?: string
  }
  /** For interaction mode: target pet to interact with */
  targetPetId?: string
}

// ─── Pet Data Types ──────────────────────────────────

interface PetData {
  id: string
  pet_name: string
  meme_personality: MemePetPersonalityData
  bluesky_handle: string
  bluesky_did: string | null
  bluesky_app_password: string
}

// ─── Workflow Implementation ──────────────────────────

export class BlueskyAgentWorkflow implements CraftingWorkflow {
  constructor(
    private context: WorkflowContext<BlueskyAgentWorkflowRequest>
  ) {}

  async execute(): Promise<void> {
    const request = this.context.requestPayload
    if (!request) {
      throw new Error('Request payload is missing')
    }

    // Check if Bluesky agent is enabled
    if (!BLUESKY_CONFIG.FEATURE_FLAGS.ENABLED) {
      return
    }

    switch (request.mode) {
      case 'proactive':
        await this.executeProactivePosting(request)
        break
      case 'reactive':
        await this.executeReactiveReply(request)
        break
      case 'interaction':
        await this.executeInterPetInteraction(request)
        break
    }
  }

  // ─── Proactive Posting ──────────────────────────────

  /**
   * Generate and publish an autonomous post
   */
  private async executeProactivePosting(request: BlueskyAgentWorkflowRequest): Promise<void> {
    const { petId } = request

    // Step 1: Load pet data
    const pet = await this.context.run('load-pet-data', async () => {
      return this.loadPetData(petId)
    })

    // Step 2: Get recent posts for context (avoid repetition)
    const recentPosts = await this.context.run('get-recent-posts', async () => {
      try {
        const botClient = await this.createAuthenticatedClient(pet)
        const feed = await botClient.getOwnRecentPosts(5)
        return feed.map(f => {
          const record = f.post.record as { text?: string }
          return record.text ?? ''
        }).filter(Boolean)
      } catch {
        return []
      }
    })

    // Step 3: Generate post content
    const generatedPost = await this.context.run('generate-post', async () => {
      return generateAutonomousPost(
        pet.meme_personality,
        recentPosts,
        pet.pet_name
      )
    })

    // Step 4: Publish to Bluesky
    const postResult = await this.context.run('publish-post', async () => {
      const botClient = await this.createAuthenticatedClient(pet)
      return botClient.post(generatedPost.text)
    })

    // Step 5: Log activity
    await this.context.run('log-activity', async () => {
      await this.logActivity({
        petId,
        activityType: 'proactive_post',
        postUri: postResult.uri,
        postCid: postResult.cid,
        content: generatedPost.text,
        metadata: {
          mood: generatedPost.mood,
          intentType: generatedPost.intentType
        }
      })
    })
  }

  // ─── Reactive Replies ──────────────────────────────

  /**
   * Reply to a mention or reply notification
   */
  private async executeReactiveReply(request: BlueskyAgentWorkflowRequest): Promise<void> {
    const { petId, notification } = request
    if (!notification) {
      throw new Error('Notification data required for reactive mode')
    }

    // Step 1: Load pet and check conversation turn limit
    const { pet, turnCount } = await this.context.run('load-pet-check-turns', async () => {
      const petData = await this.loadPetData(petId)
      const turns = await this.getConversationTurnCount(
        petId,
        notification.rootUri ?? notification.uri
      )
      return { pet: petData, turnCount: turns }
    })

    // Enforce conversation turn limit
    if (turnCount >= BLUESKY_CONFIG.POSTING.MAX_CONVERSATION_TURNS) {
      await this.context.run('skip-max-turns', async () => {
        await this.logActivity({
          petId,
          activityType: 'reply_skipped',
          content: `Max turns (${BLUESKY_CONFIG.POSTING.MAX_CONVERSATION_TURNS}) reached for thread`,
          metadata: {
            threadUri: notification.rootUri ?? notification.uri,
            reason: 'max_turns_exceeded'
          }
        })
      })
      return
    }

    // Step 2: Get thread context
    const threadContext = await this.context.run('get-thread-context', async () => {
      return this.getThreadContext(petId, notification.rootUri ?? notification.uri)
    })

    // Step 3: Generate reply
    const generatedReply = await this.context.run('generate-reply', async () => {
      return generateReply(
        pet.meme_personality,
        pet.pet_name,
        notification.text,
        notification.authorHandle,
        threadContext
      )
    })

    // Check if we should engage
    if (!generatedReply.shouldEngage) {
      await this.context.run('log-skip', async () => {
        await this.logActivity({
          petId,
          activityType: 'reply_skipped',
          content: `Chose not to engage with @${notification.authorHandle}`,
          metadata: { tone: generatedReply.tone, reason: 'not_worth_engaging' }
        })
      })
      return
    }

    // Step 4: Build reply ref and publish
    const replyResult = await this.context.run('publish-reply', async () => {
      const botClient = await this.createAuthenticatedClient(pet)

      const replyRef: BlueskyReplyRef = {
        root: {
          uri: notification.rootUri ?? notification.uri,
          cid: notification.rootCid ?? notification.cid
        },
        parent: {
          uri: notification.uri,
          cid: notification.cid
        }
      }

      return botClient.reply(generatedReply.text, replyRef)
    })

    // Step 5: Log activity
    await this.context.run('log-reply-activity', async () => {
      await this.logActivity({
        petId,
        activityType: 'reactive_reply',
        postUri: replyResult.uri,
        postCid: replyResult.cid,
        content: generatedReply.text,
        metadata: {
          tone: generatedReply.tone,
          inReplyTo: notification.uri,
          inReplyToAuthor: notification.authorHandle,
          threadUri: notification.rootUri ?? notification.uri
        }
      })
    })
  }

  // ─── Inter-Pet Interaction ──────────────────────────

  /**
   * Initiate an interaction between two meme pets
   */
  private async executeInterPetInteraction(request: BlueskyAgentWorkflowRequest): Promise<void> {
    const { petId, targetPetId } = request
    if (!targetPetId) {
      throw new Error('targetPetId required for interaction mode')
    }

    // Step 1: Load both pets
    const { myPet, targetPet, targetRecentPost } = await this.context.run(
      'load-both-pets',
      async () => {
        const [me, target] = await Promise.all([
          this.loadPetData(petId),
          this.loadPetData(targetPetId)
        ])

        // Get target's most recent post for context
        let recentPost = ''
        try {
          const targetClient = await this.createAuthenticatedClient(target)
          const feed = await targetClient.getOwnRecentPosts(1)
          if (feed.length > 0) {
            const record = feed[0].post.record as { text?: string }
            recentPost = record.text ?? ''
          }
        } catch {
          recentPost = '(could not fetch recent post)'
        }

        return { myPet: me, targetPet: target, targetRecentPost: recentPost }
      }
    )

    // Step 2: Get relationship history
    const history = await this.context.run('get-history', async () => {
      return this.getRelationshipHistory(petId, targetPetId)
    })

    // Step 3: AI decides whether and how to interact
    const decision = await this.context.run('decide-interaction', async () => {
      return decideInteraction(
        myPet.meme_personality,
        myPet.pet_name,
        targetPet.meme_personality,
        targetPet.pet_name,
        targetRecentPost,
        history
      )
    })

    if (!decision.shouldInteract || decision.interactionType === 'ignore') {
      await this.context.run('log-skip-interaction', async () => {
        await this.logActivity({
          petId,
          activityType: 'interaction_skipped',
          content: `Decided not to interact with ${targetPet.pet_name}`,
          metadata: {
            targetPetId,
            reasoning: decision.reasoning,
            interactionType: decision.interactionType
          }
        })
      })
      return
    }

    // Step 4: Post the interaction message (mention the target)
    const postResult = await this.context.run('post-interaction', async () => {
      const botClient = await this.createAuthenticatedClient(myPet)
      // Ensure the message mentions the target
      let message = decision.openingMessage
      const targetMention = `@${targetPet.bluesky_handle}`
      if (!message.includes(targetMention)) {
        message = `${targetMention} ${message}`
      }
      // Trim to max length
      if (message.length > BLUESKY_CONFIG.POSTING.MAX_POST_LENGTH) {
        message = message.slice(0, BLUESKY_CONFIG.POSTING.MAX_POST_LENGTH - 1) + '\u2026'
      }
      return botClient.post(message)
    })

    // Step 5: Log interaction
    await this.context.run('log-interaction', async () => {
      await this.logActivity({
        petId,
        activityType: 'interaction_initiate',
        postUri: postResult.uri,
        postCid: postResult.cid,
        content: decision.openingMessage,
        metadata: {
          targetPetId,
          targetPetName: targetPet.pet_name,
          interactionType: decision.interactionType,
          reasoning: decision.reasoning
        }
      })
    })
  }

  // ─── Failure Handler ──────────────────────────────

  async handleFailure(
    failResponse: unknown,
    failStatus: unknown,
    failHeaders: unknown
  ): Promise<void> {
    const request = this.context.requestPayload
    if (!request) return

    const errorMessage = failResponse instanceof Error
      ? failResponse.message
      : String(failResponse)

    try {
      await this.logActivity({
        petId: request.petId,
        activityType: 'workflow_error',
        content: `Workflow failed: ${errorMessage}`,
        metadata: {
          mode: request.mode,
          failStatus: String(failStatus),
          timestamp: new Date().toISOString()
        }
      })
    } catch {
      // Failure handler should not throw
    }
  }

  // ─── Private Helpers ──────────────────────────────

  private async loadPetData(petId: string): Promise<PetData> {
    const supabase = getServiceSupabase()

    // Load pet with both psyche (emotional state) and meme (personality/voice) columns
    const { data: pet, error } = await (supabase as any)
      .from('pet')
      .select('id, name, personality_type, psyche, meme')
      .eq('id', petId)
      .single() as { data: { id: string; name: string; personality_type: string | null; psyche: Record<string, unknown> | null; meme: Record<string, unknown> | null } | null; error: { message: string } | null }

    if (error || !pet) {
      throw new Error(`Pet ${petId} not found: ${error?.message}`)
    }

    // Load Bluesky bot config separately
    const { data: botConfig } = await (supabase as any)
      .from('bluesky_bot_config')
      .select('handle, did, app_password')
      .eq('pet_id', petId)
      .single() as { data: { handle: string; did: string | null; app_password: string } | null }

    if (!botConfig) {
      throw new Error(`No Bluesky bot config for pet ${petId}`)
    }

    // Build MemePetPersonalityData from psyche + meme columns
    const psyche = (pet.psyche ?? {}) as Record<string, unknown>
    const meme = (pet.meme ?? {}) as Record<string, unknown>
    const memePersonality = (meme.personality ?? {}) as Record<string, unknown>
    const psycheTraits = (psyche.traits ?? {}) as Record<string, number>
    const speechStyle = (memePersonality.speechStyle ?? {}) as Record<string, unknown>
    const interactionPrefs = (memePersonality.interactionPreferences ?? {}) as Record<string, number>

    const personality: MemePetPersonalityData = {
      personalityType: pet.personality_type ?? (memePersonality.archetype as string) ?? 'unknown',
      traits: {
        playfulness: psycheTraits.playfulness ?? 0.5,
        independence: psycheTraits.independence ?? 0,
        curiosity: psycheTraits.curiosity ?? 0.5,
        expressiveness: psycheTraits.expressiveness ?? 0.5,
      },
      dominantEmotion: (psyche.dominant_emotion as string) ?? 'neutral',
      innerMonologue: (psyche.inner_monologue as string) ?? '',
      memeVoice: {
        humorStyle: (memePersonality.humorStyle as string) ?? (meme.humor as string) ?? 'general',
        catchphrase: Array.isArray(memePersonality.catchphrases)
          ? (memePersonality.catchphrases as string[])[0] ?? ''
          : '',
        reactionPatterns: Array.isArray(speechStyle.quirks)
          ? (speechStyle.quirks as string[])
          : [],
        postingStyle: (speechStyle.tone as string) ?? 'casual',
      },
      postingConfig: {
        frequency: 'medium',
        topicAffinity: Array.isArray(memePersonality.topicsOfInterest)
          ? (memePersonality.topicsOfInterest as string[])
          : [],
        engagementStyle: (speechStyle.vocabulary as string) ?? 'internet slang',
      },
      socialStyle: {
        approachability: ((interactionPrefs.friendliness ?? 50) - 50) / 50,
        competitiveness: ((interactionPrefs.sassiness ?? 50) - 50) / 50,
        dramaTendency: ((interactionPrefs.chaosLevel ?? 50) - 50) / 50,
        loyaltyDepth: 0.5,
      },
    }

    return {
      id: pet.id,
      pet_name: pet.name,
      meme_personality: personality,
      bluesky_handle: botConfig.handle,
      bluesky_did: botConfig.did ?? null,
      bluesky_app_password: botConfig.app_password
    }
  }

  private async createAuthenticatedClient(pet: PetData): Promise<BlueskyBotClient> {
    const config: BlueskyBotConfig = {
      petId: pet.id,
      handle: pet.bluesky_handle,
      did: pet.bluesky_did ?? undefined,
      appPassword: pet.bluesky_app_password
    }
    const client = new BlueskyBotClient(config)
    await client.authenticate()
    return client
  }

  private async logActivity(params: {
    petId: string
    activityType: string
    postUri?: string
    postCid?: string
    content: string
    metadata?: Record<string, unknown>
  }): Promise<void> {
    const supabase = getServiceSupabase()

    // Look up bot_config_id (NOT NULL column in bluesky_post_log)
    const { data: botConfig } = await (supabase as any)
      .from('bluesky_bot_config')
      .select('id')
      .eq('pet_id', params.petId)
      .single() as { data: { id: string } | null }

    await (supabase as any)
      .from('bluesky_post_log')
      .insert({
        pet_id: params.petId,
        bot_config_id: botConfig?.id ?? null,
        activity_type: params.activityType,
        post_uri: params.postUri ?? null,
        post_cid: params.postCid ?? null,
        content: params.content,
        metadata: params.metadata ?? null,
        created_at: new Date().toISOString()
      })
  }

  private async getConversationTurnCount(
    petId: string,
    threadUri: string
  ): Promise<number> {
    const supabase = getServiceSupabase()
    const { count } = await (supabase as any)
      .from('bluesky_post_log')
      .select('id', { count: 'exact', head: true })
      .eq('pet_id', petId)
      .eq('metadata->>threadUri', threadUri)
      .in('activity_type', ['reactive_reply', 'interaction_initiate']) as { count: number | null }

    return count ?? 0
  }

  private async getThreadContext(
    petId: string,
    threadUri: string
  ): Promise<string[]> {
    const supabase = getServiceSupabase()
    const { data } = await (supabase as any)
      .from('bluesky_post_log')
      .select('content, activity_type')
      .eq('pet_id', petId)
      .eq('metadata->>threadUri', threadUri)
      .order('created_at', { ascending: true })
      .limit(BLUESKY_CONFIG.POSTING.MAX_CONVERSATION_TURNS) as { data: Array<{ content: string; activity_type: string }> | null }

    return data?.map(d => d.content) ?? []
  }

  private async getRelationshipHistory(
    petId: string,
    targetPetId: string
  ): Promise<string> {
    const supabase = getServiceSupabase()
    const { data } = await (supabase as any)
      .from('bluesky_post_log')
      .select('activity_type, content, metadata, created_at')
      .eq('pet_id', petId)
      .eq('metadata->>targetPetId', targetPetId)
      .order('created_at', { ascending: false })
      .limit(5) as { data: Array<{ activity_type: string; content: string; metadata: Record<string, unknown> | null; created_at: string }> | null }

    if (!data || data.length === 0) {
      return 'No previous interactions'
    }

    return data.map(d => {
      const meta = d.metadata
      const type = meta?.interactionType ?? d.activity_type
      return `[${type}] ${d.content.slice(0, 80)}...`
    }).join('\n')
  }
}

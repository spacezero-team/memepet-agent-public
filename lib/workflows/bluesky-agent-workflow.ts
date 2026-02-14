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
  generateThread,
  generateReply,
  decideInteraction,
  type MemePetPersonalityData,
  type GeneratedThread,
} from './modules/bluesky-post-generator'
import type { CraftingWorkflow } from './workflow-interface'
import { loadBotMemory, saveBotMemory, appendPostToMemory } from '@/lib/agent/memory/bot-memory-service'
import type { RecentPostDigest } from '@/lib/agent/types/bot-memory'
import { evaluateEngagementCandidates, type EngagementCandidateInput } from './modules/bluesky-post-generator'
import { preFilterCandidates } from './modules/engagement-filter'
import {
  loadRelationship,
  updateRelationshipAfterInteraction,
  computeSentimentDelta,
  formatRelationshipForPrompt,
} from '@/lib/agent/memory/relationship-memory-service'
import { decideImageGeneration } from './modules/bluesky-image-prompt-generator'
import { generateMemeImage } from '@/lib/services/image-generator'

// ─── Request Types ──────────────────────────────────

export type BlueskyAgentMode = 'proactive' | 'reactive' | 'interaction' | 'engagement'

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
      case 'engagement':
        await this.executeProactiveEngagement(request)
        break
    }
  }

  // ─── Proactive Posting ──────────────────────────────

  private async executeProactivePosting(request: BlueskyAgentWorkflowRequest): Promise<void> {
    const { petId } = request

    const pet = await this.context.run('load-pet-data', async () => {
      return this.loadPetData(petId)
    })

    const memory = await this.context.run('load-memory', async () => {
      return loadBotMemory(petId)
    })

    // Try thread generation first (personality-based probability)
    const thread = await this.context.run('try-thread', async () => {
      return generateThread(pet.meme_personality, memory, pet.pet_name)
    }) as GeneratedThread | null

    if (thread) {
      await this.executeThreadPosting(petId, pet, thread, memory)
      return
    }

    // Single post path
    const generatedPost = await this.context.run('generate-post', async () => {
      return generateAutonomousPost(
        pet.meme_personality,
        memory,
        pet.pet_name
      )
    })

    // Image generation (personality-based probability)
    const imageResult = BLUESKY_CONFIG.FEATURE_FLAGS.IMAGE_GENERATION_ENABLED
      ? await this.context.run('try-image', async () => {
          const postsSinceLastImage = memory.recentPosts.filter(
            (p: RecentPostDigest) => !('hasImage' in p)
          ).length
          const decision = await decideImageGeneration({
            personality: pet.meme_personality,
            postText: generatedPost.text,
            petName: pet.pet_name,
            postsSinceLastImage,
          })
          if (!decision.shouldGenerateImage || !decision.imagePrompt) return null
          return generateMemeImage({
            imagePrompt: decision.imagePrompt,
            imageAlt: decision.imageAlt ?? generatedPost.text.slice(0, 100),
            petName: pet.pet_name,
          })
        })
      : null

    const postResult = await this.context.run('publish-post', async () => {
      const botClient = await this.createAuthenticatedClient(pet)
      return botClient.post(
        generatedPost.text,
        imageResult?.imageBlob,
        imageResult?.imageAlt
      )
    })

    await this.context.run('update-memory', async () => {
      const digest: RecentPostDigest = {
        postedAt: new Date().toISOString(),
        gist: generatedPost.postDigest,
        mood: generatedPost.mood,
        topic: generatedPost.topicTag,
        intentType: generatedPost.intentType,
      }

      let updatedMemory = appendPostToMemory(memory, digest)

      if (generatedPost.narrativeUpdate) {
        updatedMemory = { ...updatedMemory, narrativeArc: generatedPost.narrativeUpdate }
      }

      await saveBotMemory(petId, updatedMemory)
    })

    await this.context.run('log-activity', async () => {
      await this.logActivity({
        petId,
        activityType: 'proactive_post',
        postUri: postResult.uri,
        postCid: postResult.cid,
        content: generatedPost.text,
        metadata: {
          mood: generatedPost.mood,
          intentType: generatedPost.intentType,
          topicTag: generatedPost.topicTag,
          hasImage: !!imageResult,
          imageGenerationTimeMs: imageResult?.generationTimeMs,
        }
      })
    })
  }

  // ─── Thread Posting ──────────────────────────────

  private async executeThreadPosting(
    petId: string,
    pet: PetData,
    thread: GeneratedThread,
    memory: import('@/lib/agent/types/bot-memory').BotMemory
  ): Promise<void> {
    const posts = thread.posts.slice(0, BLUESKY_CONFIG.THREAD.MAX_POSTS)

    // Post root
    const rootResult = await this.context.run('thread-root', async () => {
      const botClient = await this.createAuthenticatedClient(pet)
      return botClient.post(posts[0].text)
    })

    // Collect all results: [root, reply1, reply2, ...]
    const allResults: Array<{ uri: string; cid: string; text: string }> = [
      { ...rootResult, text: posts[0].text },
    ]

    // Post subsequent thread replies
    for (let i = 1; i < posts.length; i++) {
      const prevResult = allResults[i - 1]
      const replyResult = await this.context.run(`thread-reply-${i}`, async () => {
        const botClient = await this.createAuthenticatedClient(pet)
        const replyRef: BlueskyReplyRef = {
          root: { uri: rootResult.uri, cid: rootResult.cid },
          parent: { uri: prevResult.uri, cid: prevResult.cid },
        }
        return botClient.reply(posts[i].text, replyRef)
      })
      allResults.push({ ...replyResult, text: posts[i].text })
    }

    await this.context.run('thread-memory', async () => {
      const digest: RecentPostDigest = {
        postedAt: new Date().toISOString(),
        gist: thread.threadDigest.slice(0, 80),
        mood: thread.overallMood,
        topic: thread.topicTag,
        intentType: 'thread',
      }
      let updatedMemory = appendPostToMemory(memory, digest)
      if (thread.narrativeUpdate) {
        updatedMemory = { ...updatedMemory, narrativeArc: thread.narrativeUpdate }
      }
      await saveBotMemory(petId, updatedMemory)
    })

    await this.context.run('thread-log', async () => {
      await this.logActivity({
        petId,
        activityType: 'proactive_thread',
        postUri: rootResult.uri,
        postCid: rootResult.cid,
        content: allResults.map(r => r.text).join('\n---\n'),
        metadata: {
          threadTheme: thread.threadTheme,
          overallMood: thread.overallMood,
          topicTag: thread.topicTag,
          threadLength: posts.length,
          postUris: allResults.map(r => r.uri),
        },
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

    // Step 5: Log activity + update relationship if replying to another pet
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

      // Update relationship if replying to another pet
      const repliedToPetId = await this.getPetIdByDid(notification.authorDid)
      if (repliedToPetId) {
        await updateRelationshipAfterInteraction(petId, repliedToPetId, {
          interactionType: `reply_${generatedReply.tone}`,
        })
      }
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

    // Step 2: Get relationship history (structured + text)
    const history = await this.context.run('get-history', async () => {
      const relationship = await loadRelationship(petId, targetPetId)
      const recentMessages = await this.getRecentInteractionMessages(petId, targetPetId)
      return formatRelationshipForPrompt(relationship, recentMessages)
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

    // Step 5: Log interaction + update relationship
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

      await updateRelationshipAfterInteraction(petId, targetPetId, {
        interactionType: decision.interactionType,
      })
    })
  }

  // ─── Proactive Engagement ──────────────────────────

  private async executeProactiveEngagement(request: BlueskyAgentWorkflowRequest): Promise<void> {
    const { petId } = request

    const pet = await this.context.run('load-pet-engagement', async () => {
      return this.loadPetData(petId)
    })

    const candidates = await this.context.run('discover-candidates', async () => {
      const botClient = await this.createAuthenticatedClient(pet)
      const allCandidates: EngagementCandidateInput[] = []
      const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()

      try {
        const { feed } = await botClient.getTimeline(30)
        const timelineCandidates = feed
          .filter(f => {
            const record = f.post.record as { createdAt?: string }
            return !record.createdAt || record.createdAt >= sixHoursAgo
          })
          .map(f => ({
            postUri: f.post.uri,
            postCid: f.post.cid,
            authorHandle: f.post.author.handle,
            authorDid: f.post.author.did,
            text: (f.post.record as { text?: string }).text ?? '',
          }))
        allCandidates.push(...timelineCandidates)
      } catch {
        // Timeline fetch failed
      }

      const topics = pet.meme_personality.postingConfig.topicAffinity
      if (topics.length > 0) {
        const searchTopics = [...topics].sort(() => Math.random() - 0.5).slice(0, 2)
        for (const topic of searchTopics) {
          try {
            const posts = await botClient.searchPosts({ query: topic, sort: 'top', limit: 10, since: sixHoursAgo })
            allCandidates.push(...posts.map(p => ({
              postUri: p.uri,
              postCid: p.cid,
              authorHandle: p.author.handle,
              authorDid: p.author.did,
              text: (p.record as { text?: string }).text ?? '',
            })))
          } catch {
            // Search failed
          }
        }
      }

      // Deduplicate
      const seen = new Set<string>()
      const deduped = allCandidates.filter(c => {
        if (seen.has(c.postUri)) return false
        seen.add(c.postUri)
        return true
      })

      // Load other pet DIDs
      const supabase = getServiceSupabase()
      const { data: petDids } = await (supabase as any)
        .from('bluesky_bot_config')
        .select('did')
        .eq('is_active', true) as { data: Array<{ did: string }> | null }

      const otherPetDids = new Set(petDids?.map(p => p.did).filter(Boolean) ?? [])

      const filtered = preFilterCandidates(deduped, botClient.did, otherPetDids)
      return filtered.filter(f => !f.filtered).map(f => f.candidate).slice(0, 15)
    })

    if (candidates.length === 0) {
      await this.context.run('log-no-candidates', async () => {
        await this.logActivity({
          petId,
          activityType: 'engagement_skipped',
          content: 'No suitable engagement candidates found',
          metadata: { reason: 'no_candidates' },
        })
      })
      return
    }

    const engagedAuthorsList = await this.context.run('get-engaged-authors', async () => {
      const supabase = getServiceSupabase()
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

      const { data } = await (supabase as any)
        .from('bluesky_post_log')
        .select('metadata')
        .eq('pet_id', petId)
        .in('activity_type', ['engagement_comment', 'engagement_like'])
        .gte('created_at', since) as { data: Array<{ metadata: Record<string, unknown> }> | null }

      // Return array (not Set) because Set is not JSON-serializable
      // and Upstash Workflow serializes step results via JSON
      return (data?.map(d => d.metadata?.engagedAuthorHandle as string).filter(Boolean) ?? []) as string[]
    })

    const maxEngagements = this.computeMaxEngagements(pet.meme_personality)

    const decisions = await this.context.run('evaluate-candidates', async () => {
      // Convert back to Set for the evaluator
      const engagedAuthors = new Set(engagedAuthorsList)
      return evaluateEngagementCandidates(
        pet.meme_personality,
        pet.pet_name,
        candidates,
        engagedAuthors,
        maxEngagements
      )
    })

    const actionable = decisions.engagements.filter(
      d => d.action !== 'skip' && d.postIndex >= 0 && d.postIndex < candidates.length
    )

    for (let i = 0; i < actionable.length; i++) {
      const decision = actionable[i]
      const candidate = candidates[decision.postIndex]

      await this.context.run(`engage-${i}`, async () => {
        const client = await this.createAuthenticatedClient(pet)

        if (decision.action === 'like' || decision.action === 'like_and_comment' || decision.action === 'quote_and_like') {
          await client.like(candidate.postUri, candidate.postCid)
          await this.logActivity({
            petId,
            activityType: 'engagement_like',
            content: `Liked post by @${candidate.authorHandle}`,
            metadata: {
              engagedPostUri: candidate.postUri,
              engagedAuthorHandle: candidate.authorHandle,
              engagedAuthorDid: candidate.authorDid,
              relevanceScore: decision.relevanceScore,
              tone: decision.tone,
              sessionMood: decisions.sessionMood,
            },
          })
        }

        if ((decision.action === 'comment' || decision.action === 'like_and_comment') && decision.comment) {
          const replyRef = await client.buildReplyRef(candidate.postUri, candidate.postCid)
          const result = await client.reply(decision.comment, replyRef)
          await this.logActivity({
            petId,
            activityType: 'engagement_comment',
            postUri: result.uri,
            postCid: result.cid,
            content: decision.comment,
            metadata: {
              engagedPostUri: candidate.postUri,
              engagedAuthorHandle: candidate.authorHandle,
              engagedAuthorDid: candidate.authorDid,
              relevanceScore: decision.relevanceScore,
              tone: decision.tone,
              sessionMood: decisions.sessionMood,
            },
          })
        }

        if ((decision.action === 'quote' || decision.action === 'quote_and_like') && decision.quoteText) {
          const result = await client.quotePost(decision.quoteText, candidate.postUri, candidate.postCid)
          await this.logActivity({
            petId,
            activityType: 'engagement_quote',
            postUri: result.uri,
            postCid: result.cid,
            content: decision.quoteText,
            metadata: {
              engagedPostUri: candidate.postUri,
              engagedAuthorHandle: candidate.authorHandle,
              engagedAuthorDid: candidate.authorDid,
              quotedPostText: candidate.text.slice(0, 200),
              relevanceScore: decision.relevanceScore,
              tone: decision.tone,
              sessionMood: decisions.sessionMood,
            },
          })
        }
      })
    }
  }

  private computeMaxEngagements(personality: MemePetPersonalityData): number {
    const score =
      (personality.traits.expressiveness * 0.3) +
      (personality.traits.playfulness * 0.25) +
      ((personality.socialStyle.approachability + 1) / 2 * 0.25) +
      ((1 - personality.traits.independence) * 0.2)

    return Math.round(2 + score * 3)
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

  private clientCache = new Map<string, BlueskyBotClient>()

  private async createAuthenticatedClient(pet: PetData): Promise<BlueskyBotClient> {
    const cached = this.clientCache.get(pet.id)
    if (cached?.isAuthenticated) return cached

    const config: BlueskyBotConfig = {
      petId: pet.id,
      handle: pet.bluesky_handle,
      did: pet.bluesky_did ?? undefined,
      appPassword: pet.bluesky_app_password
    }
    const client = new BlueskyBotClient(config)
    await client.authenticate()
    this.clientCache.set(pet.id, client)
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

    if (!botConfig) {
      throw new Error(`No bot config found for pet ${params.petId}, cannot log activity`)
    }

    await (supabase as any)
      .from('bluesky_post_log')
      .insert({
        pet_id: params.petId,
        bot_config_id: botConfig.id,
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

  private async getRecentInteractionMessages(
    petId: string,
    targetPetId: string
  ): Promise<string[]> {
    const supabase = getServiceSupabase()
    const { data } = await (supabase as any)
      .from('bluesky_post_log')
      .select('activity_type, content, metadata')
      .eq('pet_id', petId)
      .eq('metadata->>targetPetId', targetPetId)
      .order('created_at', { ascending: false })
      .limit(3) as { data: Array<{ activity_type: string; content: string; metadata: Record<string, unknown> | null }> | null }

    if (!data) return []

    return data.map(d => {
      const type = (d.metadata?.interactionType ?? d.activity_type) as string
      const truncated = d.content.length > 80 ? d.content.slice(0, 80) + '...' : d.content
      return `[${type}] ${truncated}`
    })
  }

  private async getPetIdByDid(did: string): Promise<string | null> {
    const supabase = getServiceSupabase()
    const { data } = await (supabase as any)
      .from('bluesky_bot_config')
      .select('pet_id')
      .eq('did', did)
      .maybeSingle() as { data: { pet_id: string } | null }
    return data?.pet_id ?? null
  }
}

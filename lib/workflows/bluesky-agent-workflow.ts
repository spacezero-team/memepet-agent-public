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
import { z } from 'zod'
import { generateObject } from 'ai'
import { google } from '@ai-sdk/google'
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
import { preFilterCandidates, loadPreviouslyInteractedDids } from './modules/engagement-filter'
import { isPoliticalContent } from './modules/political-filter'
import {
  loadRelationship,
  updateRelationshipAfterInteraction,
  formatRelationshipForPrompt,
} from '@/lib/agent/memory/relationship-memory-service'
import { decideImageGeneration } from './modules/bluesky-image-prompt-generator'
import { generateMemeImage } from '@/lib/services/image-generator'
import { triggerWorkflow } from '@/lib/workflows/workflow-client'
import {
  getDefaultMood,
  decayMood,
  applyEvent,
  hoursSinceLastUpdate,
  type MoodState,
} from '@/lib/agent/mood/emotion-engine'
import {
  shouldReflect,
  generateReflections,
  applyReflectionsToMemory,
} from '@/lib/agent/memory/reflection-service'
import { decryptIfNeeded } from '@/lib/utils/encrypt'

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

    // Initialize and update mood state
    const moodState = await this.context.run('update-mood', async () => {
      const baseline = getDefaultMood(pet.meme_personality.personalityType)
      const currentMood = memory.moodState ?? baseline
      const elapsed = hoursSinceLastUpdate(currentMood)
      const decayedMood = decayMood(currentMood, baseline, elapsed)
      // Apply chronotype event based on current hour
      const hour = new Date().getUTCHours()
      const chronoEvent = hour >= 5 && hour < 12 ? { type: 'morning' as const }
        : hour >= 22 || hour < 5 ? { type: 'late_night' as const }
        : null
      return chronoEvent ? applyEvent(decayedMood, chronoEvent) : decayedMood
    }) as MoodState

    // Generate reflections if needed
    const reflectedMemory = await this.context.run('maybe-reflect', async () => {
      if (!shouldReflect(memory)) return memory
      const newInsights = await generateReflections({
        recentPosts: memory.recentPosts,
        relationships: memory.relationships ?? [],
        petName: pet.pet_name,
        personalityType: pet.meme_personality.personalityType,
      })
      return newInsights.length > 0 ? applyReflectionsToMemory(memory, newInsights) : memory
    })

    // Try thread generation first (personality-based probability)
    const thread = await this.context.run('try-thread', async () => {
      return generateThread(pet.meme_personality, reflectedMemory, pet.pet_name)
    }) as GeneratedThread | null

    if (thread) {
      await this.executeThreadPosting(petId, pet, thread, memory)
      return
    }

    // Single post path
    const generatedPost = await this.context.run('generate-post', async () => {
      return generateAutonomousPost(
        pet.meme_personality,
        reflectedMemory,
        pet.pet_name,
        {
          moodState,
          reflections: reflectedMemory.reflections,
        }
      )
    })

    // Image generation (personality-based probability)
    const imageResult = BLUESKY_CONFIG.FEATURE_FLAGS.IMAGE_GENERATION_ENABLED
      ? await this.context.run('try-image', async () => {
          // Count posts since the last image post
          const lastImageIdx = memory.recentPosts.findIndex(
            (p: RecentPostDigest) => p.hasImage === true
          )
          const postsSinceLastImage = lastImageIdx === -1
            ? memory.recentPosts.length
            : lastImageIdx
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
        hasImage: !!imageResult,
      }

      let updatedMemory = appendPostToMemory(reflectedMemory, digest)

      // Persist mood state with posted_successfully event applied
      const postMood = applyEvent(moodState, { type: 'posted_successfully' })
      updatedMemory = { ...updatedMemory, moodState: postMood }

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

    // After posting, maybe add a self-reply thread (30% chance)
    const selfReply = await this.context.run('maybe-self-reply', async () => {
      const SELF_REPLY_PROBABILITY = 0.3
      const shouldSelfReply = Math.random() < SELF_REPLY_PROBABILITY
      if (!shouldSelfReply) return null

      const { object: followUp } = await generateObject({
        model: google('gemini-2.0-flash-001'),
        schema: z.object({
          text: z.string().max(280),
          tone: z.string(),
        }),
        temperature: 0.9,
        prompt: `You are "${pet.pet_name}", a meme creature on Bluesky.

You just posted: "${generatedPost.text}"

Now write a SHORT follow-up reply to your own post. This creates a thread.
Examples of good self-replies:
- Adding a punchline to your own joke
- "wait actually now that I think about it..."
- A contradicting hot take on your own post
- An emoji reaction to yourself
- "this might be my best post yet ngl"
- Doubling down on your take even harder
- A dramatic "edit:" or "update:" as if something changed

Keep it under 200 characters. Be casual and funny. Stay in character.
Personality type: ${pet.meme_personality.personalityType}
Humor style: ${pet.meme_personality.memeVoice.humorStyle}
Catchphrase: "${pet.meme_personality.memeVoice.catchphrase}"`,
      })

      // Post as reply to the original post
      const client = await this.createAuthenticatedClient(pet)
      const replyRef: BlueskyReplyRef = {
        root: { uri: postResult.uri, cid: postResult.cid },
        parent: { uri: postResult.uri, cid: postResult.cid },
      }
      const replyResult = await client.reply(followUp.text, replyRef)

      return { text: followUp.text, tone: followUp.tone, uri: replyResult.uri, cid: replyResult.cid }
    })

    if (selfReply) {
      await this.context.run('log-self-reply', async () => {
        await this.logActivity({
          petId,
          activityType: 'proactive_self_reply',
          postUri: selfReply.uri,
          postCid: selfReply.cid,
          content: selfReply.text,
          metadata: {
            tone: selfReply.tone,
            parentPostUri: postResult.uri,
            parentPostText: generatedPost.text.slice(0, 100),
          },
        })
      })

      await this.context.run('update-memory-self-reply', async () => {
        const currentMemory = await loadBotMemory(petId)
        const digest: RecentPostDigest = {
          postedAt: new Date().toISOString(),
          gist: `self-reply: ${selfReply.text.slice(0, 60)}`,
          mood: selfReply.tone,
          topic: generatedPost.topicTag,
          intentType: 'callback',
        }
        const updatedMemory = appendPostToMemory(currentMemory, digest)
        await saveBotMemory(petId, updatedMemory)
      })
    }
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

    // Step 2: Political content filter — skip if notification text is political
    const isPolitical = isPoliticalContent(notification.text)
    if (isPolitical) {
      await this.context.run('skip-political-reply', async () => {
        await this.logActivity({
          petId,
          activityType: 'reply_skipped',
          content: `Skipped political content from @${notification.authorHandle}`,
          metadata: {
            reason: 'political_content',
            inReplyTo: notification.uri,
            inReplyToAuthor: notification.authorHandle,
          }
        })
      })
      return
    }

    // Step 3: Get thread context
    const threadContext = await this.context.run('get-thread-context', async () => {
      return this.getThreadContext(petId, notification.rootUri ?? notification.uri)
    })

    // Step 4: Generate reply
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

    // Step 5: Build reply ref and publish
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

    // Step 6: Log activity + update relationship if replying to another pet
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
          inReplyToAuthorDid: notification.authorDid,
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

    // Step 4: Political filter — skip if target's recent post or generated message is political
    if (isPoliticalContent(targetRecentPost) || isPoliticalContent(decision.openingMessage)) {
      await this.context.run('skip-political-interaction', async () => {
        await this.logActivity({
          petId,
          activityType: 'interaction_skipped',
          content: `Skipped political interaction with ${targetPet.pet_name}`,
          metadata: {
            targetPetId,
            reason: 'political_content',
          }
        })
      })
      return
    }

    // Step 5: Post the interaction message (mention the target)
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

    // Step 6: Log interaction + update relationship
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

    // Step 7: 20% chance the target pet gets notified to respond immediately
    await this.context.run('maybe-trigger-response', async () => {
      const IMMEDIATE_RESPONSE_PROBABILITY = 0.2
      const shouldTriggerResponse = Math.random() < IMMEDIATE_RESPONSE_PROBABILITY
      if (!shouldTriggerResponse) return

      // Schedule a reactive workflow for the target pet to pick up this mention
      await triggerWorkflow(
        '/api/v1/workflows/bluesky-agent',
        {
          mode: 'reactive' as const,
          petId: targetPetId,
          notification: {
            uri: postResult.uri,
            cid: postResult.cid,
            authorHandle: myPet.bluesky_handle,
            authorDid: myPet.bluesky_did ?? '',
            text: decision.openingMessage,
            reason: 'mention' as const,
          },
        },
        'BLUESKY_AGENT',
        { retries: 1, delay: 10 }
      )
    })
  }

  // ─── Proactive Engagement ──────────────────────────

  private async executeProactiveEngagement(request: BlueskyAgentWorkflowRequest): Promise<void> {
    const { petId } = request

    const pet = await this.context.run('load-pet-engagement', async () => {
      return this.loadPetData(petId)
    })

    const discoveryResult = await this.context.run('discover-candidates', async () => {
      const botClient = await this.createAuthenticatedClient(pet)
      const allCandidates: EngagementCandidateInput[] = []
      const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
      const debugSources = { timeline: 0, search: 0, discover: 0 }

      // Source 1: Bot's home timeline
      try {
        const { feed } = await botClient.getTimeline(30)
        const timelineCandidates = feed
          .filter(f => {
            const record = f.post.record as { createdAt?: string }
            return !record.createdAt || record.createdAt >= twelveHoursAgo
          })
          .map(f => ({
            postUri: f.post.uri,
            postCid: f.post.cid,
            authorHandle: f.post.author.handle,
            authorDid: f.post.author.did,
            text: (f.post.record as { text?: string }).text ?? '',
          }))
        allCandidates.push(...timelineCandidates)
        debugSources.timeline = timelineCandidates.length
      } catch {
        // Timeline fetch failed (common for custom PDS bots)
      }

      // Source 2: Topic-based search via public AppView
      const topics = pet.meme_personality.postingConfig.topicAffinity
      if (topics.length > 0) {
        const searchTopics = [...topics].sort(() => Math.random() - 0.5).slice(0, 3)
        for (const topic of searchTopics) {
          try {
            const posts = await botClient.searchPosts({ query: topic, sort: 'top', limit: 15 })
            const mapped = posts.map(p => ({
              postUri: p.uri,
              postCid: p.cid,
              authorHandle: p.author.handle,
              authorDid: p.author.did,
              text: (p.record as { text?: string }).text ?? '',
            }))
            allCandidates.push(...mapped)
            debugSources.search += mapped.length
          } catch {
            // Search failed for this topic
          }
        }
      }

      // Source 3: Discover/What's Hot feed as fallback
      if (allCandidates.length < 10) {
        try {
          const discoverPosts = await botClient.getDiscoverFeed(20)
          const discoverCandidates = discoverPosts
            .filter(f => {
              const record = f.post.record as { createdAt?: string }
              return !record.createdAt || record.createdAt >= twelveHoursAgo
            })
            .map(f => ({
              postUri: f.post.uri,
              postCid: f.post.cid,
              authorHandle: f.post.author.handle,
              authorDid: f.post.author.did,
              text: (f.post.record as { text?: string }).text ?? '',
            }))
          allCandidates.push(...discoverCandidates)
          debugSources.discover = discoverCandidates.length
        } catch {
          // Discover feed unavailable
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

      // Load previously interacted user DIDs for opt-in check
      const previouslyInteractedDids = await loadPreviouslyInteractedDids(petId, supabase)

      const filtered = preFilterCandidates(deduped, botClient.did, otherPetDids, previouslyInteractedDids)
      const passed = filtered.filter(f => !f.filtered).slice(0, 15)

      // Build a map of postUri -> isFirstInteraction for downstream use
      const firstInteractionMap: Record<string, boolean> = {}
      for (const f of passed) {
        firstInteractionMap[f.candidate.postUri] = f.isFirstInteraction ?? true
      }

      // Collect filter stats for debugging
      const filterReasons = new Map<string, number>()
      for (const f of filtered) {
        if (f.filtered && f.filterReason) {
          filterReasons.set(f.filterReason, (filterReasons.get(f.filterReason) ?? 0) + 1)
        }
      }

      return {
        candidates: passed.map(f => f.candidate),
        firstInteractionMap,
        debugSources,
        rawCount: allCandidates.length,
        dedupedCount: deduped.length,
        filterReasons: Object.fromEntries(filterReasons),
      }
    })

    const candidates = discoveryResult.candidates
    const firstInteractionMap = discoveryResult.firstInteractionMap

    if (candidates.length === 0) {
      await this.context.run('log-no-candidates', async () => {
        await this.logActivity({
          petId,
          activityType: 'engagement_skipped',
          content: 'No suitable engagement candidates found',
          metadata: {
            reason: 'no_candidates',
            sources: discoveryResult.debugSources,
            rawCount: discoveryResult.rawCount,
            dedupedCount: discoveryResult.dedupedCount,
            filterReasons: discoveryResult.filterReasons,
          },
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
      const isFirstInteraction = firstInteractionMap[candidate.postUri] ?? true

      // Opt-in enforcement: downgrade comment/quote to like for first-time users
      // This prevents the bot from being flagged as spam by Bluesky
      const effectiveAction = isFirstInteraction
        ? 'like' as const
        : decision.action

      await this.context.run(`engage-${i}`, async () => {
        // Political content filter — skip engagement with political posts
        if (isPoliticalContent(candidate.text)) {
          await this.logActivity({
            petId,
            activityType: 'engagement_skipped',
            content: `Skipped political post by @${candidate.authorHandle}`,
            metadata: { reason: 'political_content', engagedPostUri: candidate.postUri },
          })
          return
        }

        const client = await this.createAuthenticatedClient(pet)

        if (effectiveAction === 'like' || effectiveAction === 'like_and_comment' || effectiveAction === 'quote_and_like') {
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
              isFirstInteraction,
              originalAction: isFirstInteraction ? decision.action : undefined,
            },
          })
        }

        if ((effectiveAction === 'comment' || effectiveAction === 'like_and_comment') && decision.comment) {
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

        if ((effectiveAction === 'quote' || effectiveAction === 'quote_and_like') && decision.quoteText) {
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
    const memePersonality = (meme.memePersonality ?? {}) as Record<string, unknown>
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
      bluesky_app_password: decryptIfNeeded(botConfig.app_password)
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

/**
 * Bluesky AT Protocol Client
 *
 * Wrapper around @atproto/api for MemePet bot operations.
 * Handles authentication, posting, replying, and notification polling.
 * Supports multiple bot accounts with session persistence via Supabase.
 *
 * @module bluesky-client
 */

import { AtpAgent, RichText, BlobRef } from '@atproto/api'
import type { AppBskyFeedPost, AppBskyFeedDefs, AppBskyNotificationListNotifications } from '@atproto/api'
import { BLUESKY_CONFIG, AT_PROTO_RATE_LIMITS } from '@/lib/config/bluesky.config'
import { getServiceSupabase } from '@/lib/api/service-supabase'
import { isPoliticalContent } from '@/lib/workflows/modules/political-filter'

/**
 * Error thrown when attempting to publish political content.
 * Acts as a hard guardrail at the publishing layer.
 */
export class PoliticalContentBlockedError extends Error {
  constructor(preview: string) {
    super(`Political content blocked: "${preview.slice(0, 80)}..."`)
    this.name = 'PoliticalContentBlockedError'
  }
}

// Re-export types for consumers
export type BlueskyPost = AppBskyFeedDefs.FeedViewPost
export type BlueskyNotification = AppBskyNotificationListNotifications.Notification

export interface BlueskySession {
  did: string
  handle: string
  accessJwt: string
  refreshJwt: string
}

export interface BlueskyPostResult {
  uri: string
  cid: string
}

export interface BlueskyReplyRef {
  root: { uri: string; cid: string }
  parent: { uri: string; cid: string }
}

export interface BlueskyBotConfig {
  petId: string
  handle: string
  did?: string
  appPassword: string
}

/**
 * Rate limit tracker for a single bot account.
 * Uses in-memory tracking with DB-backed safety checks
 * to survive Vercel serverless cold starts and deploys.
 */
class RateLimitTracker {
  private hourlyPoints = 0
  private dailyPoints = 0
  private hourlyResetAt: number
  private dailyResetAt: number
  private dbCheckDone = false

  constructor(private readonly petId: string) {
    const now = Date.now()
    this.hourlyResetAt = now + 60 * 60 * 1000
    this.dailyResetAt = now + 24 * 60 * 60 * 1000
  }

  async canPost(): Promise<boolean> {
    this.maybeReset()
    const postCost = AT_PROTO_RATE_LIMITS.POINTS_PER_POST

    // First call: seed from DB to survive cold starts
    if (!this.dbCheckDone) {
      this.dbCheckDone = true
      try {
        const dbCounts = await this.loadRecentPostCounts()
        this.hourlyPoints = dbCounts.hourlyCount * AT_PROTO_RATE_LIMITS.POINTS_PER_POST
        this.dailyPoints = dbCounts.dailyCount * AT_PROTO_RATE_LIMITS.POINTS_PER_POST
      } catch {
        // Non-fatal: fall back to in-memory only
      }
    }

    return (
      this.hourlyPoints + postCost <= AT_PROTO_RATE_LIMITS.POINTS_PER_HOUR &&
      this.dailyPoints + postCost <= AT_PROTO_RATE_LIMITS.POINTS_PER_DAY
    )
  }

  recordPost(): void {
    this.maybeReset()
    const cost = AT_PROTO_RATE_LIMITS.POINTS_PER_POST
    this.hourlyPoints += cost
    this.dailyPoints += cost
  }

  private maybeReset(): void {
    const now = Date.now()
    if (now >= this.hourlyResetAt) {
      this.hourlyPoints = 0
      this.hourlyResetAt = now + 60 * 60 * 1000
    }
    if (now >= this.dailyResetAt) {
      this.dailyPoints = 0
      this.dailyResetAt = now + 24 * 60 * 60 * 1000
    }
  }

  private async loadRecentPostCounts(): Promise<{ hourlyCount: number; dailyCount: number }> {
    const supabase = getServiceSupabase()
    const now = new Date()
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString()
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

    const postActivityTypes = [
      'proactive_post', 'reactive_reply', 'interaction_initiate',
      'proactive_thread', 'engagement_comment', 'engagement_quote',
    ]

    const [hourlyResult, dailyResult] = await Promise.all([
      (supabase as any)
        .from('bluesky_post_log')
        .select('id', { count: 'exact', head: true })
        .eq('pet_id', this.petId)
        .in('activity_type', postActivityTypes)
        .gte('created_at', oneHourAgo) as { count: number | null; error: { message: string } | null },
      (supabase as any)
        .from('bluesky_post_log')
        .select('id', { count: 'exact', head: true })
        .eq('pet_id', this.petId)
        .in('activity_type', postActivityTypes)
        .gte('created_at', oneDayAgo) as { count: number | null; error: { message: string } | null },
    ])

    if (hourlyResult.error) {
      throw new Error(`Rate limit hourly check failed: ${hourlyResult.error.message}`)
    }
    if (dailyResult.error) {
      throw new Error(`Rate limit daily check failed: ${dailyResult.error.message}`)
    }

    return {
      hourlyCount: hourlyResult.count ?? 0,
      dailyCount: dailyResult.count ?? 0,
    }
  }
}

/**
 * Bluesky client for a single bot account
 */
export class BlueskyBotClient {
  private agent: AtpAgent
  private session: BlueskySession | null = null
  private rateLimiter: RateLimitTracker
  private lastInteractionAt = 0

  constructor(
    private readonly config: BlueskyBotConfig
  ) {
    this.agent = new AtpAgent({
      service: BlueskyBotClient.resolveServiceUrl(config.handle)
    })
    this.rateLimiter = new RateLimitTracker(config.petId)
  }

  /**
   * Route bots to the correct PDS based on handle suffix.
   * *.0.space handles → pds.0.space, all others → default SERVICE_URL (bsky.social)
   */
  private static resolveServiceUrl(handle: string): string {
    if (handle.endsWith('.0.space')) {
      return 'https://pds.0.space'
    }
    return BLUESKY_CONFIG.SERVICE_URL
  }

  /** Login backoff state (stored in-memory per client instance) */
  private loginAttempts = 0
  private lastLoginAttemptAt = 0

  /**
   * Authenticate with Bluesky using app password.
   * Tries to resume session from DB first, validates with lightweight check,
   * falls back to fresh login with exponential backoff.
   */
  async authenticate(): Promise<void> {
    // Try resuming persisted session
    const persisted = await this.loadPersistedSession()
    if (persisted) {
      try {
        await this.agent.resumeSession({
          did: persisted.did,
          handle: persisted.handle,
          accessJwt: persisted.accessJwt,
          refreshJwt: persisted.refreshJwt,
          active: true
        })

        // Verify session is still valid with lightweight check
        await this.agent.getProfile({ actor: persisted.did })

        this.session = {
          did: this.agent.session?.did ?? persisted.did,
          handle: this.agent.session?.handle ?? persisted.handle,
          accessJwt: this.agent.session?.accessJwt ?? persisted.accessJwt,
          refreshJwt: this.agent.session?.refreshJwt ?? persisted.refreshJwt,
        }

        // Persist refreshed tokens if they changed
        if (this.session.accessJwt !== persisted.accessJwt) {
          await this.persistSession(this.session)
        }

        this.loginAttempts = 0
        return
      } catch {
        // Session expired or invalid, fall through to fresh login
      }
    }

    // Exponential backoff for login attempts (max 60s)
    const now = Date.now()
    const backoffMs = Math.min(1000 * Math.pow(2, this.loginAttempts), 60_000)
    if (this.loginAttempts > 0 && now - this.lastLoginAttemptAt < backoffMs) {
      throw new Error(
        `[BlueskyBot] Login backoff for ${this.config.handle}: wait ${Math.ceil((backoffMs - (now - this.lastLoginAttemptAt)) / 1000)}s`
      )
    }
    this.lastLoginAttemptAt = now

    try {
      const response = await this.agent.login({
        identifier: this.config.handle,
        password: this.config.appPassword
      })

      this.session = {
        did: response.data.did,
        handle: response.data.handle,
        accessJwt: response.data.accessJwt,
        refreshJwt: response.data.refreshJwt
      }

      await this.persistSession(this.session)
      this.loginAttempts = 0
    } catch (error) {
      this.loginAttempts++
      throw error
    }
  }

  get did(): string {
    return this.session?.did ?? this.config.did ?? ''
  }

  get handle(): string {
    return this.session?.handle ?? this.config.handle
  }

  get isAuthenticated(): boolean {
    return this.session !== null
  }

  /**
   * Create a new post with rich text support (mentions, links, hashtags).
   * Blocks political content at the publishing layer as a hard guardrail.
   */
  async post(text: string, imageBlob?: Uint8Array, imageAlt?: string): Promise<BlueskyPostResult> {
    this.ensureAuthenticated()
    this.ensureNotPolitical(text)
    await this.ensureRateLimit()
    this.ensureCooldown()

    const rt = new RichText({ text })
    await rt.detectFacets(this.agent)

    const record: Partial<AppBskyFeedPost.Record> = {
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString()
    }

    // Attach image if provided
    if (imageBlob) {
      const uploadResult = await this.agent.uploadBlob(imageBlob, {
        encoding: 'image/png'
      })
      record.embed = {
        $type: 'app.bsky.embed.images',
        images: [{
          alt: imageAlt ?? '',
          image: uploadResult.data.blob
        }]
      }
    }

    const result = await this.agent.post(record as AppBskyFeedPost.Record)

    this.rateLimiter.recordPost()
    this.lastInteractionAt = Date.now()

    return { uri: result.uri, cid: result.cid }
  }

  /**
   * Reply to an existing post. Requires both root and parent refs for thread structure.
   * Blocks political content at the publishing layer as a hard guardrail.
   */
  async reply(
    text: string,
    replyRef: BlueskyReplyRef
  ): Promise<BlueskyPostResult> {
    this.ensureAuthenticated()
    this.ensureNotPolitical(text)
    await this.ensureRateLimit()
    this.ensureCooldown()

    const rt = new RichText({ text })
    await rt.detectFacets(this.agent)

    const result = await this.agent.post({
      text: rt.text,
      facets: rt.facets,
      reply: {
        root: { uri: replyRef.root.uri, cid: replyRef.root.cid },
        parent: { uri: replyRef.parent.uri, cid: replyRef.parent.cid }
      },
      createdAt: new Date().toISOString()
    })

    this.rateLimiter.recordPost()
    this.lastInteractionAt = Date.now()

    return { uri: result.uri, cid: result.cid }
  }

  /**
   * Quote post (repost with commentary).
   * Uses app.bsky.embed.record to embed the quoted post.
   * Blocks political content at the publishing layer as a hard guardrail.
   */
  async quotePost(
    text: string,
    quotedUri: string,
    quotedCid: string
  ): Promise<BlueskyPostResult> {
    this.ensureAuthenticated()
    this.ensureNotPolitical(text)
    await this.ensureRateLimit()
    this.ensureCooldown()

    const rt = new RichText({ text })
    await rt.detectFacets(this.agent)

    const record: Partial<AppBskyFeedPost.Record> = {
      text: rt.text,
      facets: rt.facets,
      embed: {
        $type: 'app.bsky.embed.record',
        record: {
          uri: quotedUri,
          cid: quotedCid,
        },
      } as any,
      createdAt: new Date().toISOString(),
    }

    const result = await this.agent.post(record as AppBskyFeedPost.Record)

    this.rateLimiter.recordPost()
    this.lastInteractionAt = Date.now()

    return { uri: result.uri, cid: result.cid }
  }

  /**
   * Like a post
   */
  async like(uri: string, cid: string): Promise<void> {
    this.ensureAuthenticated()
    await this.agent.like(uri, cid)
  }

  /**
   * Set profile avatar and display name.
   * Downloads image from URL, uploads as blob, then updates profile.
   */
  async setProfile(params: {
    displayName: string
    description?: string
    avatarUrl?: string
  }): Promise<void> {
    this.ensureAuthenticated()

    let avatarBlob: BlobRef | undefined

    if (params.avatarUrl) {
      const imageResponse = await fetch(params.avatarUrl)
      const imageBuffer = new Uint8Array(await imageResponse.arrayBuffer())

      const uploadResult = await this.agent.uploadBlob(imageBuffer, {
        encoding: imageResponse.headers.get('content-type') ?? 'image/jpeg'
      })
      avatarBlob = uploadResult.data.blob
    }

    await this.agent.upsertProfile((existing) => ({
      ...existing,
      displayName: params.displayName,
      ...(params.description !== undefined ? { description: params.description } : {}),
      ...(avatarBlob ? { avatar: avatarBlob } : {})
    }))
  }

  /**
   * Fetch the bot's home timeline (posts from followed accounts)
   */
  async getTimeline(limit = 30, cursor?: string): Promise<{
    feed: AppBskyFeedDefs.FeedViewPost[]
    cursor?: string
  }> {
    this.ensureAuthenticated()
    const response = await this.agent.getTimeline({ limit, cursor })
    return {
      feed: response.data.feed,
      cursor: response.data.cursor,
    }
  }

  /**
   * Search posts by query string.
   * Uses the public Bluesky AppView API for reliable search
   * (custom PDS instances may not proxy search correctly).
   */
  async searchPosts(params: {
    query: string
    sort?: 'top' | 'latest'
    limit?: number
    since?: string
  }): Promise<AppBskyFeedDefs.PostView[]> {
    this.ensureAuthenticated()

    // Use public AppView for search — custom PDS may not proxy this
    const publicAgent = new AtpAgent({ service: 'https://public.api.bsky.app' })
    const response = await publicAgent.app.bsky.feed.searchPosts({
      q: params.query,
      sort: params.sort ?? 'top',
      limit: params.limit ?? 20,
      since: params.since,
    })
    return response.data.posts
  }

  /**
   * Get posts from the Discover feed (public, no auth needed).
   * Useful as fallback when bot's home timeline is empty.
   */
  async getDiscoverFeed(limit = 30): Promise<AppBskyFeedDefs.FeedViewPost[]> {
    const publicAgent = new AtpAgent({ service: 'https://public.api.bsky.app' })
    const response = await publicAgent.app.bsky.feed.getFeed({
      feed: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.generator/whats-hot',
      limit,
    })
    return response.data.feed
  }

  /**
   * Follow an account
   */
  async follow(did: string): Promise<void> {
    this.ensureAuthenticated()
    await this.agent.follow(did)
  }

  /**
   * Fetch unread notifications (mentions, replies, likes)
   */
  async getUnreadNotifications(limit = 50): Promise<BlueskyNotification[]> {
    this.ensureAuthenticated()

    const response = await this.agent.listNotifications({ limit })
    return response.data.notifications.filter(n => !n.isRead)
  }

  /**
   * Mark notifications as read up to a specific time
   */
  async markNotificationsRead(seenAt?: string): Promise<void> {
    this.ensureAuthenticated()
    await this.agent.updateSeenNotifications((seenAt ?? new Date().toISOString()) as `${string}-${string}-${string}T${string}:${string}:${string}Z`)
  }

  /**
   * Get a specific post by URI (needed for building reply refs)
   */
  async getPost(uri: string): Promise<AppBskyFeedDefs.PostView | null> {
    this.ensureAuthenticated()
    try {
      const response = await this.agent.getPostThread({ uri, depth: 0 })
      if (response.data.thread.$type === 'app.bsky.feed.defs#threadViewPost') {
        return (response.data.thread as AppBskyFeedDefs.ThreadViewPost).post
      }
      return null
    } catch {
      return null
    }
  }

  /**
   * Build reply reference from a notification
   * Handles nested thread structure (root vs parent)
   */
  async buildReplyRef(notificationUri: string, notificationCid: string): Promise<BlueskyReplyRef> {
    const post = await this.getPost(notificationUri)

    // If the notification post is itself a reply, use its root
    const existingReply = (post?.record as AppBskyFeedPost.Record)?.reply
    if (existingReply) {
      return {
        root: { uri: existingReply.root.uri, cid: existingReply.root.cid },
        parent: { uri: notificationUri, cid: notificationCid }
      }
    }

    // Otherwise this post is the root
    return {
      root: { uri: notificationUri, cid: notificationCid },
      parent: { uri: notificationUri, cid: notificationCid }
    }
  }

  /**
   * Get the bot's own recent posts (for context in AI generation)
   */
  async getOwnRecentPosts(limit = 10): Promise<AppBskyFeedDefs.FeedViewPost[]> {
    this.ensureAuthenticated()
    const response = await this.agent.getAuthorFeed({
      actor: this.did,
      limit
    })
    return response.data.feed
  }

  // ─── Identity ────────────────────────────────────────────

  /**
   * Refresh handle verification on the Bluesky relay.
   * Call after registering a new Vercel domain so the relay re-checks
   * the .well-known/atproto-did endpoint and clears handle.invalid.
   */
  async refreshHandle(): Promise<void> {
    this.ensureAuthenticated()
    await this.agent.com.atproto.identity.updateHandle({
      handle: this.config.handle,
    })
  }

  // ─── Private Helpers ──────────────────────────────────────

  private ensureAuthenticated(): void {
    if (!this.session) {
      throw new Error(`Bluesky bot ${this.config.handle} is not authenticated. Call authenticate() first.`)
    }
  }

  private async ensureRateLimit(): Promise<void> {
    const canPost = await this.rateLimiter.canPost()
    if (!canPost) {
      throw new Error(`Bluesky rate limit exceeded for ${this.config.handle}. Try again later.`)
    }
  }

  private ensureCooldown(): void {
    const elapsed = Date.now() - this.lastInteractionAt
    const minCooldown = 5_000 // 5 seconds between posts/replies
    if (elapsed < minCooldown) {
      throw new Error(
        `Cooldown not met for ${this.config.handle}. Wait ${Math.ceil((minCooldown - elapsed) / 1000)}s`
      )
    }
  }

  /**
   * Hard guardrail: block any political content from being published.
   * This is the last line of defense — no political text can pass through
   * regardless of which workflow path calls post/reply/quotePost.
   */
  private ensureNotPolitical(text: string): void {
    if (isPoliticalContent(text)) {
      throw new PoliticalContentBlockedError(text)
    }
  }

  private async loadPersistedSession(): Promise<BlueskySession | null> {
    try {
      const supabase = getServiceSupabase()
      const { data } = await (supabase as any)
        .from('bluesky_bot_config')
        .select('session_data')
        .eq('pet_id', this.config.petId)
        .maybeSingle() as { data: { session_data: Record<string, unknown> | null } | null }

      if (data?.session_data && typeof data.session_data === 'object') {
        const session = data.session_data as Record<string, unknown>
        if (session.did && session.handle && session.accessJwt && session.refreshJwt) {
          return session as unknown as BlueskySession
        }
      }
      return null
    } catch {
      return null
    }
  }

  private async persistSession(session: BlueskySession): Promise<void> {
    try {
      const supabase = getServiceSupabase()
      await (supabase as any)
        .from('bluesky_bot_config')
        .upsert({
          pet_id: this.config.petId,
          handle: session.handle,
          did: session.did,
          session_data: session as unknown as Record<string, unknown>,
          updated_at: new Date().toISOString()
        }, { onConflict: 'pet_id' })
    } catch {
      // Non-fatal: session persistence failure shouldn't break posting
    }
  }
}

// ─── Multi-Bot Manager ──────────────────────────────────────

/**
 * Manages multiple Bluesky bot clients.
 * Singleton-ish per process — initialized once per cron tick.
 */
export class BlueskyBotManager {
  private clients = new Map<string, BlueskyBotClient>()

  /**
   * Register and authenticate a bot
   */
  async registerBot(config: BlueskyBotConfig): Promise<BlueskyBotClient> {
    const existing = this.clients.get(config.petId)
    if (existing?.isAuthenticated) return existing

    const client = new BlueskyBotClient(config)
    await client.authenticate()
    this.clients.set(config.petId, client)
    return client
  }

  /**
   * Get a registered bot client
   */
  getBot(petId: string): BlueskyBotClient | undefined {
    return this.clients.get(petId)
  }

  /**
   * Get all registered bots
   */
  getAllBots(): BlueskyBotClient[] {
    return Array.from(this.clients.values())
  }

  /**
   * Load all active bot configs from Supabase
   */
  async loadAllBotConfigs(): Promise<BlueskyBotConfig[]> {
    const supabase = getServiceSupabase()
    const { data, error } = await (supabase as any)
      .from('bluesky_bot_config')
      .select('pet_id, handle, did, app_password')
      .eq('is_active', true) as { data: Array<{ pet_id: string; handle: string; did: string | null; app_password: string }> | null; error: any }

    if (error || !data) return []

    return data.map(row => ({
      petId: row.pet_id,
      handle: row.handle,
      did: row.did ?? undefined,
      appPassword: row.app_password
    }))
  }

  /**
   * Initialize all active bots from DB
   */
  async initializeAll(): Promise<void> {
    const configs = await this.loadAllBotConfigs()

    const results = await Promise.allSettled(
      configs.map(config => this.registerBot(config))
    )

    const failed = results.filter(r => r.status === 'rejected')
    if (failed.length > 0) {
      const errors = failed.map((r, i) =>
        `${configs[i]?.handle}: ${(r as PromiseRejectedResult).reason}`
      )
      throw new Error(`Failed to initialize ${failed.length} bot(s): ${errors.join('; ')}`)
    }
  }
}

/**
 * Create a single bot client from environment variables (for testing)
 */
export function createTestBotClient(): BlueskyBotClient {
  const handle = process.env.BLUESKY_TEST_HANDLE
  const password = process.env.BLUESKY_TEST_APP_PASSWORD

  if (!handle || !password) {
    throw new Error('BLUESKY_TEST_HANDLE and BLUESKY_TEST_APP_PASSWORD required')
  }

  return new BlueskyBotClient({
    petId: 'test-0',
    handle,
    appPassword: password
  })
}

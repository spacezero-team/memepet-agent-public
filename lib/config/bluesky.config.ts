/**
 * Bluesky / AT Protocol Configuration
 *
 * Configuration for Bluesky bot accounts and posting behavior.
 * Used by the Bluesky agent workflow and cron handler.
 *
 * @module bluesky-config
 */

export const BLUESKY_CONFIG = {
  SERVICE_URL: process.env.BLUESKY_SERVICE_URL || 'https://bsky.social',

  POSTING: {
    MAX_POST_LENGTH: 300,
    MAX_IMAGES: 4,
    RATE_LIMIT_POSTS_PER_HOUR: Number(process.env.BLUESKY_MAX_POSTS_PER_HOUR) || 30,
    RATE_LIMIT_POSTS_PER_DAY: Number(process.env.BLUESKY_MAX_POSTS_PER_DAY) || 200,
    COOLDOWN_BETWEEN_INTERACTIONS_MS: 30 * 60 * 1000, // 30 minutes
    MAX_CONVERSATION_TURNS: 3,
  },

  CRON: {
    REACTIVE_INTERVAL: '*/5 * * * *',
    PROACTIVE_INTERVAL: '*/30 * * * *',
    ENGAGEMENT_INTERVAL: '30 */2 * * *',
  },

  ENGAGEMENT: {
    MAX_CANDIDATES_PER_SESSION: 15,
    MAX_ENGAGEMENTS_PER_SESSION: 5,
    MAX_COMMENTS_PER_DAY: 10,
    MAX_POST_AGE_MS: 6 * 60 * 60 * 1000,
    MIN_SESSION_INTERVAL_MS: 90 * 60 * 1000,
    AUTHOR_COOLDOWN_HOURS: 24,
  },

  THREAD: {
    MAX_POSTS: 4,
    DELAY_BETWEEN_POSTS_MS: 5_000,
  },

  IMAGE: {
    ENABLED: process.env.ENABLE_IMAGE_GENERATION === 'true',
    MAX_IMAGES_PER_DAY: 20,
    COOLDOWN_POSTS: 8,
  },

  AGENT_MODE: (process.env.BLUESKY_AGENT_MODE || 'both') as 'reactive' | 'proactive' | 'both',

  FEATURE_FLAGS: {
    ENABLED: process.env.ENABLE_BLUESKY_AGENT === 'true',
    ENGAGEMENT_ENABLED: process.env.ENABLE_BLUESKY_ENGAGEMENT === 'true',
    IMAGE_GENERATION_ENABLED: process.env.ENABLE_IMAGE_GENERATION === 'true',
    LOG_API: process.env.LOG_BLUESKY_API === 'true',
  },

  /** Handles excluded from agent automation (e.g. feed publisher accounts) */
  EXCLUDED_HANDLES: [
    'memepet.0.space',
  ],
} as const

/**
 * AT Protocol rate limit budget
 * Per account: 5,000 points/hour, 35,000 points/day
 * 1 post = 3 points → ~11,600 posts/day theoretical max
 */
export const AT_PROTO_RATE_LIMITS = {
  POINTS_PER_HOUR: 5000,
  POINTS_PER_DAY: 35000,
  POINTS_PER_POST: 3,
  POINTS_PER_LIKE: 1,
  POINTS_PER_FOLLOW: 1,
} as const

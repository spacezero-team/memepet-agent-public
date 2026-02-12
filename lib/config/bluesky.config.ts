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
    REACTIVE_INTERVAL: '*/5 * * * *',   // Check notifications every 5 min
    PROACTIVE_INTERVAL: '0 */4 * * *',  // Autonomous post every 4 hours
  },

  AGENT_MODE: (process.env.BLUESKY_AGENT_MODE || 'both') as 'reactive' | 'proactive' | 'both',

  FEATURE_FLAGS: {
    ENABLED: process.env.ENABLE_BLUESKY_AGENT === 'true',
    LOG_API: process.env.LOG_BLUESKY_API === 'true',
  }
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

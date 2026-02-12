/**
 * Centralized Flow Control Configuration
 * Manages rate limiting and concurrency for Bluesky Agent workflows
 *
 * Used by Workflow SDK's trigger() and serve() functions to enforce:
 * - Rate limiting: Maximum requests per time period
 * - Parallelism: Maximum concurrent executions
 */

export interface FlowControlSettings {
  key: string
  parallelism?: number
  rate: number
  period: `${number}s` | `${number}m` | `${number}h` | `${number}d` | string
}

export const FLOW_CONTROL_CONFIG = {
  WORKFLOWS: {
    BLUESKY_AGENT: {
      key: 'workflow-bluesky-agent',
      parallelism: 10,
      rate: 30,
      period: '1m',
    } as FlowControlSettings,
  },
} as const

/**
 * QStash retry configuration
 */
export const QSTASH_RETRY_CONFIG = {
  // Default retry settings (limited by QStash account quota)
  DEFAULT: {
    retries: 5,      // QStash account limit (quota error if >5)
    delay: '60000'   // 60 seconds between retries for recovery
  },

  // Critical operations (less retries, longer delay)
  CRITICAL: {
    retries: 3,      // Stay well under account limit
    delay: '90000'   // 90 seconds (1.5 minutes) for recovery
  },

  // Resilient operations (max allowed by account)
  RESILIENT: {
    retries: 5,      // Maximum allowed by QStash account
    delay: 'pow(2, retried) * 10000'  // Exponential: 10s, 20s, 40s, 80s, 160s
  }
} as const

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
  DEFAULT: {
    retries: 5,
    delay: '60000'
  },
} as const

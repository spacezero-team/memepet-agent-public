/**
 * Workflow Client Helper
 *
 * Centralized workflow triggering utilities using Upstash Workflow SDK.
 */

import { Client } from '@upstash/workflow'
import { FLOW_CONTROL_CONFIG } from '@/lib/config/flow-control.config'

/**
 * Get a configured Workflow Client instance
 */
export function getWorkflowClient(): Client {
  if (!process.env.QSTASH_TOKEN) {
    throw new Error('QSTASH_TOKEN environment variable is required')
  }

  return new Client({
    token: process.env.QSTASH_TOKEN,
  })
}

/**
 * Get the base URL for workflow endpoints
 * Priority: UPSTASH_WORKFLOW_URL > VERCEL_URL > localhost
 */
export function getWorkflowBaseUrl(): string {
  return (
    process.env.UPSTASH_WORKFLOW_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000')
  )
}

/**
 * Trigger a workflow with proper Flow Control configuration
 */
export async function triggerWorkflow<T>(
  endpoint: string,
  payload: T,
  workflowType: keyof typeof FLOW_CONTROL_CONFIG.WORKFLOWS,
  options?: {
    retries?: number
    delay?: number
    workflowRunId?: string
  }
): Promise<{ workflowRunId: string }> {
  const client = getWorkflowClient()
  const flowConfig = FLOW_CONTROL_CONFIG.WORKFLOWS[workflowType]
  const baseUrl = getWorkflowBaseUrl()
  const url = `${baseUrl}${endpoint}`

  const result = await client.trigger({
    url,
    body: payload,
    flowControl: {
      key: flowConfig.key,
      parallelism: flowConfig.parallelism,
      rate: flowConfig.rate,
      period: flowConfig.period as '1s' | '1m' | '1h' | '1d',
    },
    retries: options?.retries ?? 3,
    delay: options?.delay,
    workflowRunId: options?.workflowRunId,
  })

  return {
    workflowRunId: result.workflowRunId,
  }
}

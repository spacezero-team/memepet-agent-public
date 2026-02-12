/**
 * Bluesky Agent Workflow Endpoint
 *
 * Upstash Workflow serve() endpoint for Bluesky bot operations.
 * Handles proactive posting, reactive replies, and inter-pet interactions.
 *
 * Triggered by:
 * - Cron job (proactive posting + notification polling)
 * - Craft agent endpoint (manual trigger)
 */

import { serve } from '@upstash/workflow/nextjs'
import { WorkflowContext } from '@upstash/workflow'
import {
  BlueskyAgentWorkflow,
  type BlueskyAgentWorkflowRequest
} from '@/lib/workflows/bluesky-agent-workflow'
import { FLOW_CONTROL_CONFIG, QSTASH_RETRY_CONFIG } from '@/lib/config/flow-control.config'
import { logWorkflow, isWorkflowAbort } from '@/lib/utils/workflow-logger'

export const maxDuration = 60

// GET handler for QStash callbacks
export async function GET() {
  return new Response(
    JSON.stringify({ status: 'OK', endpoint: 'bluesky-agent-workflow' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

// DELETE handler for QStash workflow management
export async function DELETE() {
  return new Response(
    JSON.stringify({ status: 'OK', action: 'deleted' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

// PATCH handler for QStash workflow updates
export async function PATCH() {
  return new Response(
    JSON.stringify({ status: 'OK', action: 'patched' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
}

const flowControlConfig = FLOW_CONTROL_CONFIG.WORKFLOWS.BLUESKY_AGENT

export const { POST } = serve<BlueskyAgentWorkflowRequest>(
  async (context) => {
    const request = context.requestPayload
    const workflowRunId = context.workflowRunId
    const petId = request && typeof request === 'object' && 'petId' in request
      ? String((request as BlueskyAgentWorkflowRequest).petId)
      : null

    const logger = logWorkflow(
      'BLUESKY_AGENT',
      workflowRunId,
      petId ?? undefined
    )

    try {
      logger.progress('Starting Bluesky Agent workflow', {
        mode: (request as BlueskyAgentWorkflowRequest)?.mode,
        petId
      })

      const workflow = new BlueskyAgentWorkflow(
        context as WorkflowContext<BlueskyAgentWorkflowRequest>
      )
      await workflow.execute()

      logger.complete({ petId })
    } catch (error) {
      // WorkflowAbort is expected behavior (Upstash replay)
      if (isWorkflowAbort(error)) {
        throw error
      }
      logger.error(error, 'bluesky-agent.execute')
      throw error
    }
  },
  {
    baseUrl:
      process.env.UPSTASH_WORKFLOW_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000'),

    flowControl: {
      key: flowControlConfig.key,
      parallelism: flowControlConfig.parallelism,
      rate: flowControlConfig.rate,
      period: flowControlConfig.period as '1m'
    },

    retries: QSTASH_RETRY_CONFIG.DEFAULT.retries,

    failureFunction: async ({
      context,
      failStatus,
      failResponse,
      failHeaders
    }) => {
      const request = context.requestPayload
      const workflowRunId = context.workflowRunId
      const petId = request && typeof request === 'object' && 'petId' in request
        ? String((request as BlueskyAgentWorkflowRequest).petId)
        : null

      const logger = logWorkflow(
        'BLUESKY_AGENT',
        workflowRunId,
        petId ?? undefined
      )

      const workflow = new BlueskyAgentWorkflow(
        context as WorkflowContext<BlueskyAgentWorkflowRequest>
      )
      await workflow.handleFailure(failResponse, failStatus, failHeaders)
    }
  }
)

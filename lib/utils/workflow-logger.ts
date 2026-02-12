/**
 * Workflow Logger Utility
 *
 * Simplified, structured logging for workflows
 * Designed for production readability in Vercel Logs
 */

type WorkflowType = 'BLUESKY_AGENT'

interface LogContext {
  workflowId: string
  taskId?: string
  workflowType: WorkflowType
}

export class WorkflowLogger {
  private context: LogContext
  private startTime: number

  constructor(context: LogContext) {
    this.context = context
    this.startTime = Date.now()
  }

  start() {
    console.log(
      JSON.stringify({
        event: 'workflow.start',
        type: this.context.workflowType,
        workflowId: this.context.workflowId,
        taskId: this.context.taskId,
        timestamp: new Date().toISOString(),
      })
    )
  }

  complete(result?: any) {
    const duration = Date.now() - this.startTime
    console.log(
      JSON.stringify({
        event: 'workflow.complete',
        type: this.context.workflowType,
        workflowId: this.context.workflowId,
        taskId: this.context.taskId,
        duration: `${duration}ms`,
        durationSec: Math.round(duration / 1000),
        result: result
          ? { id: result.id || result.itemId, status: 'success' }
          : { status: 'success' },
        timestamp: new Date().toISOString(),
      })
    )
  }

  error(error: any, step?: string) {
    if (
      error?.name === 'WorkflowAbort' ||
      error?.constructor?.name === 'WorkflowAbort' ||
      error?.message?.includes('WorkflowAbort') ||
      error?.message?.includes('Aborting workflow run')
    ) {
      return
    }

    const duration = Date.now() - this.startTime
    console.error(
      JSON.stringify({
        event: 'workflow.error',
        type: this.context.workflowType,
        workflowId: this.context.workflowId,
        taskId: this.context.taskId,
        step: step || 'unknown',
        error: {
          message: error?.message || String(error),
          name: error?.name,
          stack:
            process.env.NODE_ENV === 'development'
              ? error?.stack
              : undefined,
        },
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
      })
    )
  }

  progress(action: string, details?: any) {
    const elapsed = Math.round((Date.now() - this.startTime) / 1000)
    console.log(
      JSON.stringify({
        event: 'workflow.progress',
        type: this.context.workflowType,
        workflowId: this.context.workflowId,
        taskId: this.context.taskId,
        action,
        details: details ? this.summarize(details) : undefined,
        elapsed: `${elapsed}s`,
        timestamp: new Date().toISOString(),
      })
    )
  }

  milestone(milestone: string, data?: any) {
    console.log(
      JSON.stringify({
        event: 'workflow.milestone',
        type: this.context.workflowType,
        workflowId: this.context.workflowId,
        taskId: this.context.taskId,
        milestone,
        data: data ? this.summarize(data) : undefined,
        timestamp: new Date().toISOString(),
      })
    )
  }

  api(
    service: string,
    action: string,
    status: 'start' | 'success' | 'error',
    details?: any
  ) {
    const event =
      status === 'error' ? 'workflow.api.error' : 'workflow.api'
    const logFn = status === 'error' ? console.error : console.log

    logFn(
      JSON.stringify({
        event,
        type: this.context.workflowType,
        workflowId: this.context.workflowId,
        service,
        action,
        status,
        details: details ? this.summarize(details) : undefined,
        timestamp: new Date().toISOString(),
      })
    )
  }

  private summarize(obj: any): any {
    if (!obj) return null
    if (typeof obj !== 'object') return obj

    if (Array.isArray(obj)) {
      return `Array(${obj.length})`
    }

    const summary: any = {}
    const importantKeys = [
      'id',
      'taskId',
      'itemId',
      'status',
      'name',
      'type',
      'error',
      'message',
    ]

    for (const key of importantKeys) {
      if (key in obj) {
        summary[key] = obj[key]
      }
    }

    if (Object.keys(summary).length === 0) {
      const keys = Object.keys(obj).slice(0, 3)
      keys.forEach((key) => {
        summary[key] =
          typeof obj[key] === 'string' && obj[key].length > 100
            ? obj[key].substring(0, 100) + '...'
            : obj[key]
      })
    }

    return summary
  }
}

export function logWorkflow(
  workflowType: WorkflowType,
  workflowId: string,
  taskId?: string
): WorkflowLogger {
  const logger = new WorkflowLogger({
    workflowType,
    workflowId,
    taskId,
  })
  logger.start()
  return logger
}

export function isWorkflowAbort(error: any): boolean {
  return (
    error?.name === 'WorkflowAbort' ||
    error?.constructor?.name === 'WorkflowAbort' ||
    error?.message?.includes('WorkflowAbort') ||
    error?.message?.includes('Aborting workflow run')
  )
}

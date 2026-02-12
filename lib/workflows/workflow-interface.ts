export interface CraftingWorkflow {
  execute(): Promise<void>
  handleFailure(failResponse: unknown, failStatus: unknown, failHeaders: unknown): Promise<void>
}

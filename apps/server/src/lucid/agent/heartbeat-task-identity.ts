/** Stable persisted Heddle task key used by Lucid agent heartbeats. */
export const AGENT_TASK_ID_PREFIX = 'lucid-representative-';

/**
 * Stable product-owned group for the current workspace's background Agents.
 * Heddle and Execution Host treat this value as an opaque admission key.
 */
export const LUCID_BACKGROUND_WORK_GROUP_ID =
  'lucid-primary-workspace-background';

export function taskIdForAgent(agentId: string): string {
  return `${AGENT_TASK_ID_PREFIX}${agentId}`;
}

export function agentIdFromTask(taskId: string): string | undefined {
  return taskId.startsWith(AGENT_TASK_ID_PREFIX)
    ? taskId.slice(AGENT_TASK_ID_PREFIX.length)
    : undefined;
}

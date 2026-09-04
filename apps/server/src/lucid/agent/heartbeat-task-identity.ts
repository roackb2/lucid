/**
 * Stable persisted Heddle task-key prefix.
 *
 * The suffix is an Agent-job ID. Existing Interest jobs deliberately keep
 * their historical Agent ID as their job ID so deployed task identities do
 * not change during the Agent-job migration.
 */
export const AGENT_JOB_TASK_ID_PREFIX = 'lucid-representative-';

/**
 * Stable product-owned group for the current workspace's background Agents.
 * Heddle and Execution Host treat this value as an opaque admission key.
 */
export const LUCID_BACKGROUND_WORK_GROUP_ID =
  'lucid-primary-workspace-background';

export function taskIdForAgentJob(agentJobId: string): string {
  return `${AGENT_JOB_TASK_ID_PREFIX}${agentJobId}`;
}

export function agentJobIdFromTaskId(taskId: string): string | undefined {
  return taskId.startsWith(AGENT_JOB_TASK_ID_PREFIX)
    ? taskId.slice(AGENT_JOB_TASK_ID_PREFIX.length)
    : undefined;
}

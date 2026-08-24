/** Stable persisted Heddle task key used by Lucid agent heartbeats. */
export const AGENT_TASK_ID_PREFIX = 'lucid-representative-';

export function taskIdForAgent(agentId: string): string {
  return `${AGENT_TASK_ID_PREFIX}${agentId}`;
}

export function agentIdFromTask(taskId: string): string | undefined {
  return taskId.startsWith(AGENT_TASK_ID_PREFIX)
    ? taskId.slice(AGENT_TASK_ID_PREFIX.length)
    : undefined;
}

import type {
  HostedHeartbeatDesiredTask,
  HostedHeartbeatTaskReconciliationInput,
} from '@heddleagent/execution-host-client/coordinator';
import { taskIdForAgent } from '../../lucid/agent/heartbeat-task-identity.js';
import type { AgentWakeStore } from '../../lucid/agent/store.js';

type HeartbeatTaskPolicy = {
  intervalMs: number;
  model: string;
  maxSteps: number;
};

type HeartbeatTaskCatalogStore = Pick<
  AgentWakeStore,
  'readWorkspace' | 'listAgents' | 'listUsers'
>;

type HeartbeatTaskCatalogOptions = {
  enabledByTaskId?: ReadonlyMap<string, boolean>;
};

/** Projects current Lucid ownership into Heddle's desired-task vocabulary. */
export async function readLucidHeartbeatTaskReconciliationInput(
  store: HeartbeatTaskCatalogStore,
  policy: Readonly<HeartbeatTaskPolicy>,
  options: HeartbeatTaskCatalogOptions = {},
): Promise<Omit<HostedHeartbeatTaskReconciliationInput, 'signal'>> {
  const [workspace, agents, users] = await Promise.all([
    store.readWorkspace(),
    store.listAgents(),
    store.listUsers(),
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const desiredTasks = agents.flatMap((agent) => {
    const user = usersById.get(agent.userId);
    return !user || user.status === 'retired'
      ? []
      : [{
          taskId: taskIdForAgent(agent.id),
          input: {
            workspaceId: workspace.versionId,
            name: `${agent.name} background checks`,
            task: agent.purpose,
            enabled: user.status === 'active'
              && (options.enabledByTaskId?.get(taskIdForAgent(agent.id))
                ?? true),
            continuationMode: 'operator',
            intervalMs: policy.intervalMs,
            defer: true,
            model: policy.model,
            maxSteps: policy.maxSteps,
            systemContext: [
              agent.instructions,
              'You are processing one Lucid product work claim with a fixed mailbox horizon. First call read_working_context, then read_available_messages. For every guidance_saved or feedback_saved event, call update_working_note with the revised durable context before communicating. For every interest_saved or check_requested event in that claim, call post_shared_message with the triggering event as reply_to_event_id and include every triggering sequence in source_event_ids. Publish the smallest privacy-preserving request that carries the user’s current constraints. For peer messages or user_input, record a relevant reply or finding, or call finish_without_action after the required request review. Finish only after the required durable product actions succeed.',
            ].filter(Boolean).join('\n\n'),
          },
        } satisfies HostedHeartbeatDesiredTask];
  });

  return {
    desiredTasks,
    resume: workspace.backgroundChecksEnabled,
  };
}

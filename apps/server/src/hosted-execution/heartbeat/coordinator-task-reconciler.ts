import { taskIdForAgent } from '../../lucid/agent/heartbeat-task-identity.js';
import type { AgentWakeStore } from '../../lucid/agent/store.js';
import type {
  HostedHeartbeatCoordinatorClient,
  HostedHeartbeatCoordinatorTaskInput,
} from './coordinator-client.js';

type HeartbeatTaskPolicy = {
  intervalMs: number;
  model: string;
  maxSteps: number;
};

export type HostedHeartbeatTaskReconciliation = {
  deleted: number;
  upserted: number;
  resumed: boolean;
};

/** Publishes Lucid product ownership as Heddle coordinator task state. */
export class HostedHeartbeatTaskReconciler {
  constructor(
    private readonly store: Pick<
      AgentWakeStore,
      'readWorkspace' | 'listAgents' | 'listUsers'
    >,
    private readonly coordinator: Pick<
      HostedHeartbeatCoordinatorClient,
      'listTasks' | 'upsertTask' | 'deleteTask' | 'pause' | 'resume'
    >,
    private readonly policy: Readonly<HeartbeatTaskPolicy>,
  ) {}

  async reconcile(signal?: AbortSignal): Promise<HostedHeartbeatTaskReconciliation> {
    await this.coordinator.pause(signal);
    const [workspace, agents, users, existingTasks] = await Promise.all([
      this.store.readWorkspace(),
      this.store.listAgents(),
      this.store.listUsers(),
      this.coordinator.listTasks(signal),
    ]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const desired = agents.flatMap((agent) => {
      const user = usersById.get(agent.userId);
      return !user || user.status === 'retired'
        ? []
        : [{
            taskId: taskIdForAgent(agent.id),
            input: {
              workspaceId: workspace.versionId,
              name: `${agent.name} background checks`,
              task: agent.purpose,
              enabled: user.status === 'active',
              continuationMode: 'operator',
              intervalMs: this.policy.intervalMs,
              defer: true,
              model: this.policy.model,
              maxSteps: this.policy.maxSteps,
            } satisfies HostedHeartbeatCoordinatorTaskInput,
          }];
    });
    const desiredByTaskId = new Map(desired.map(({ taskId, input }) => [
      taskId,
      input,
    ]));
    const replacedTaskIds = existingTasks.flatMap(({ id, workspaceId }) => {
      const desiredTask = desiredByTaskId.get(id);
      return !desiredTask || workspaceId !== desiredTask.workspaceId ? [id] : [];
    });

    await Promise.all(replacedTaskIds.map((taskId) => (
      this.coordinator.deleteTask(taskId, signal)
    )));
    await Promise.all(desired.map(({ taskId, input }) => (
      this.coordinator.upsertTask(taskId, input, signal)
    )));
    if (workspace.backgroundChecksEnabled) {
      await this.coordinator.resume(signal);
    }

    return {
      deleted: replacedTaskIds.length,
      upserted: desired.length,
      resumed: workspace.backgroundChecksEnabled,
    };
  }
}

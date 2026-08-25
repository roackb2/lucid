/**
 * Product-facing heartbeat control over the separate Heddle Coordinator.
 *
 * Lucid owns user lifecycle and desired task content. Heddle owns scheduling,
 * durable task state, cancellation, recovery, execution, and run history.
 */
import { Mutex } from 'async-mutex';
import dayjs from 'dayjs';
import {
  HostedHeartbeatTaskReconciler,
  type HostedHeartbeatCoordinatorState,
  type HostedHeartbeatCoordinatorTaskApi,
  type HostedHeartbeatCoordinatorTaskView,
} from '@heddleagent/execution-host-client/coordinator';
import type { LucidLogger } from '../../logger.js';
import type {
  Agent,
  AgentTaskView,
  BackgroundChecksView,
  User,
} from '../../lucid/discovery-types.js';
import type { AgentWakeStore } from '../../lucid/agent/store.js';
import {
  AGENT_TASK_ID_PREFIX,
  agentIdFromTask,
  taskIdForAgent,
} from '../../lucid/agent/heartbeat-task-identity.js';
import { readLucidHeartbeatTaskReconciliationInput } from './desired-task-catalog.js';

type HeartbeatProductStore = Pick<
  AgentWakeStore,
  | 'reset'
  | 'readWorkspace'
  | 'setBackgroundChecksEnabled'
  | 'listAgents'
  | 'listUsers'
>;

type HeartbeatTaskPolicy = {
  intervalMs: number;
  model: string;
  maxSteps: number;
};

/** Keeps Lucid product state and Heddle's desired task catalog aligned. */
export class CoordinatorAgentHeartbeatService {
  readonly #mutation = new Mutex();
  readonly #reconciler: HostedHeartbeatTaskReconciler;

  constructor(
    private readonly store: HeartbeatProductStore,
    private readonly coordinator: HostedHeartbeatCoordinatorTaskApi,
    private readonly policy: Readonly<HeartbeatTaskPolicy>,
    private readonly logger: LucidLogger,
  ) {
    this.#reconciler = new HostedHeartbeatTaskReconciler({ coordinator });
  }

  async initialize(): Promise<void> {
    await this.#reconcileTasks();
  }

  async stop(): Promise<void> {
    await this.coordinator.pause();
  }

  async snapshot(): Promise<BackgroundChecksView> {
    const [workspace, users, agents, taskViews, coordinatorState] =
      await Promise.all([
        this.store.readWorkspace(),
        this.store.listUsers(),
        this.store.listAgents(),
        this.coordinator.listTasks(),
        this.coordinator.readState(),
      ]);
    return toBackgroundChecksView(
      workspace.backgroundChecksEnabled,
      users,
      agents,
      taskViews,
      coordinatorState,
      this.policy.intervalMs,
    );
  }

  async snapshotForAgent(agentId: string): Promise<BackgroundChecksView> {
    const network = await this.snapshot();
    const tasks = network.tasks.filter((task) => task.agentId === agentId);
    const enabledTasks = tasks.filter(({ enabled }) => enabled);
    return {
      enabled: enabledTasks.length > 0,
      dispatchEnabled: network.dispatchEnabled,
      running: tasks.some(({ status }) => status === 'running'),
      intervalMs: network.intervalMs,
      nextRunAt: earliest(enabledTasks.flatMap(({ nextRunAt }) => (
        nextRunAt ? [nextRunAt] : []
      ))),
      lastRunAt: latest(tasks.flatMap(({ lastRunAt }) => (
        lastRunAt ? [lastRunAt] : []
      ))),
      tasks,
    };
  }

  async triggerAgent(agentId: string): Promise<void> {
    if (!(await this.store.readWorkspace()).backgroundChecksEnabled) {
      return;
    }
    const task = await this.#requireTask(agentId);
    if (!task.enabled || task.state.status === 'blocked') {
      return;
    }
    await this.coordinator.triggerTask(task.id);
  }

  async setGlobalBackgroundChecksEnabled(enabled: boolean): Promise<void> {
    await this.#mutation.runExclusive(async () => {
      if (!enabled) {
        await this.coordinator.pause();
        await this.store.setBackgroundChecksEnabled(false);
        return;
      }

      await this.store.setBackgroundChecksEnabled(true);
      try {
        await this.#reconcileTasks();
      } catch (error) {
        await this.store.setBackgroundChecksEnabled(false);
        await this.coordinator.pause();
        throw error;
      }
    });
  }

  async resetWorkspace(): Promise<void> {
    await this.#mutation.runExclusive(async () => {
      const enabled = (await this.store.readWorkspace())
        .backgroundChecksEnabled;
      await this.coordinator.pause();
      await this.store.reset({ backgroundChecksEnabled: enabled });
      await this.#reconcileTasks(new Map(), false);
    });
  }

  async reconcileAgentTasks(): Promise<void> {
    await this.#mutation.runExclusive(() => this.#reconcileTasks());
  }

  async enableAgentTask(agentId: string): Promise<void> {
    await this.#mutation.runExclusive(() => this.#reconcileTasks(new Map([
      [taskIdForAgent(agentId), true],
    ])));
  }

  async disableAgentTasks(agentIds: string[]): Promise<void> {
    if (agentIds.length === 0) {
      return;
    }
    const overrides = new Map(
      [...new Set(agentIds)].map((agentId) => [
        taskIdForAgent(agentId),
        false,
      ] as const),
    );
    await this.#mutation.runExclusive(() => this.#reconcileTasks(overrides));
  }

  async #reconcileTasks(
    overrides: ReadonlyMap<string, boolean> = new Map(),
    preservePreferences = true,
  ): Promise<void> {
    const existing = preservePreferences
      ? await this.coordinator.listTasks()
      : [];
    const enabledByTaskId = new Map(
      existing
        .filter(({ id }) => id.startsWith(AGENT_TASK_ID_PREFIX))
        .map(({ id, enabled }) => [id, enabled] as const),
    );
    overrides.forEach((enabled, taskId) => {
      enabledByTaskId.set(taskId, enabled);
    });
    const desired = await readLucidHeartbeatTaskReconciliationInput(
      this.store,
      this.policy,
      { enabledByTaskId },
    );
    const result = await this.#reconciler.reconcile(desired);
    this.logger.info(result, 'lucid.hosted_heartbeat.tasks_reconciled');
  }

  async #requireTask(
    agentId: string,
  ): Promise<HostedHeartbeatCoordinatorTaskView> {
    const taskId = taskIdForAgent(agentId);
    const task = (await this.coordinator.listTasks())
      .find(({ id }) => id === taskId);
    if (!task) {
      throw new Error(`Heartbeat task not found for agent: ${agentId}`);
    }
    return task;
  }
}

function toBackgroundChecksView(
  productGate: boolean,
  users: User[],
  agents: Agent[],
  taskViews: HostedHeartbeatCoordinatorTaskView[],
  coordinatorState: HostedHeartbeatCoordinatorState,
  intervalMs: number,
): BackgroundChecksView {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const visibleAgents = agents.filter((agent) => (
    usersById.get(agent.userId)?.status !== 'retired'
  ));
  const activeAgentIds = new Set(visibleAgents
    .filter((agent) => usersById.get(agent.userId)?.status === 'active')
    .map(({ id }) => id));
  const taskByAgentId = new Map(taskViews.flatMap((task) => {
    const agentId = agentIdFromTask(task.id);
    return agentId ? [[agentId, task] as const] : [];
  }));
  const tasks = visibleAgents.flatMap((agent) => {
    const task = taskByAgentId.get(agent.id);
    return task ? [toAgentTaskView(agent.id, task)] : [];
  });
  const activeTasks = tasks.filter(({ agentId }) => activeAgentIds.has(agentId));
  const enabledTasks = activeTasks.filter(({ enabled }) => enabled);

  return {
    enabled: enabledTasks.length > 0,
    dispatchEnabled: productGate && coordinatorState === 'running',
    running: activeTasks.some(({ status }) => status === 'running'),
    intervalMs,
    nextRunAt: earliest(enabledTasks.flatMap(({ nextRunAt }) => (
      nextRunAt ? [nextRunAt] : []
    ))),
    lastRunAt: latest(tasks.flatMap(({ lastRunAt }) => (
      lastRunAt ? [lastRunAt] : []
    ))),
    tasks,
  };
}

function toAgentTaskView(
  agentId: string,
  task: HostedHeartbeatCoordinatorTaskView,
): AgentTaskView {
  return {
    taskId: task.id,
    agentId,
    enabled: task.enabled,
    status: task.state.status,
    progress: task.state.progress ?? '',
    intervalMs: task.schedule.intervalMs,
    nextRunAt: task.schedule.nextRunAt,
    lastRunAt: task.state.runAt,
    lastSummary: task.state.result?.summary,
    error: task.state.error,
  };
}

function earliest(values: string[]): string | undefined {
  return values.reduce<string | undefined>((earliestValue, value) => (
    !earliestValue || dayjs(value).isBefore(earliestValue)
      ? value
      : earliestValue
  ), undefined);
}

function latest(values: string[]): string | undefined {
  return values.reduce<string | undefined>((latestValue, value) => (
    !latestValue || dayjs(value).isAfter(latestValue)
      ? value
      : latestValue
  ), undefined);
}

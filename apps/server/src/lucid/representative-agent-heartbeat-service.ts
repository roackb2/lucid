import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import {
  AgentLoopCheckpointService,
  FileHeartbeatTaskService,
  HeartbeatSchedulerService,
  LlmAdapterService,
  type AgentHeartbeatResult,
  type AgentLoopCheckpoint,
  type AgentLoopState,
  type HeartbeatSchedulerEvent,
  type HeartbeatTask,
  type HeartbeatTaskView,
} from '@roackb2/heddle/advanced';
import type { LucidConfig } from '../config.js';
import type { LucidLogger } from '../logger.js';
import type { DiscoveryRepository } from './discovery-repository.js';
import type {
  BackgroundChecksView,
  RepresentativeAgentTaskView,
} from './discovery-types.js';
import type {
  RepresentativeAgentHeartbeatRunner,
} from './heddle-representative-agent-runner.js';

const TASK_ID_PREFIX = 'lucid-representative-';

type ActiveAgentWake = {
  controller: AbortController;
  settled: Promise<void>;
  settle(): void;
};

/**
 * Hosts Lucid's representative agents as durable Heddle heartbeat tasks.
 *
 * Heddle owns task timing, checkpoints, run records, and scheduler selection.
 * This service maps tasks to Lucid agents, claims mailbox work, settles durable
 * cursors, accelerates recipients with unread mail, and coordinates shutdown.
 */
export class RepresentativeAgentHeartbeatService {
  private readonly tasks: FileHeartbeatTaskService;
  private readonly activeWakes = new Map<string, ActiveAgentWake>();
  private readonly pendingTriggerChecks = new Map<string, Promise<void>>();
  private schedulerController?: AbortController;
  private schedulerCompletion?: Promise<void>;
  private acceptingRuns = true;
  private paused = false;

  constructor(
    private readonly repository: DiscoveryRepository,
    private readonly runner: RepresentativeAgentHeartbeatRunner,
    private readonly config: LucidConfig,
    private readonly logger: LucidLogger,
  ) {
    this.tasks = new FileHeartbeatTaskService({
      stateRoot: config.heddleStateRoot,
    });
  }

  async initialize(): Promise<void> {
    const workspace = await this.repository.readWorkspace();
    this.paused = !workspace.backgroundChecksEnabled;
    await this.ensureAgentTasks({ recoverInterrupted: true });
  }

  start(): void {
    if (this.schedulerCompletion) {
      return;
    }

    this.acceptingRuns = true;
    this.schedulerController = new AbortController();
    this.schedulerCompletion = HeartbeatSchedulerService.runLoop({
      store: this.tasks,
      runner: (task, checkpoint) => this.runAgentTask(task, checkpoint),
      pollIntervalMs: this.config.heartbeatPollMs,
      signal: this.schedulerController.signal,
      onEvent: (event) => this.logSchedulerEvent(event),
    }).catch((error: unknown) => {
      this.logger.error({ error }, 'lucid.heartbeat_scheduler.failed');
    });
  }

  async stop(): Promise<void> {
    this.acceptingRuns = false;
    this.schedulerController?.abort();
    this.abortActiveWakes();
    await Promise.all([
      this.schedulerCompletion,
      this.waitForActiveWakes(),
      this.waitForPendingTriggerChecks(),
    ]);
    this.schedulerCompletion = undefined;
    this.schedulerController = undefined;
  }

  async snapshot(): Promise<BackgroundChecksView> {
    const [workspace, participants, agents, taskViews] = await Promise.all([
      this.repository.readWorkspace(),
      this.repository.listParticipants(),
      this.repository.listAgents(),
      this.tasks.listTaskViews(),
    ]);
    const participantById = new Map(
      participants.map((participant) => [participant.id, participant]),
    );
    const visibleAgents = agents.filter(
      (agent) => participantById.get(agent.participantId)?.status !== 'retired',
    );
    const activeAgentIds = new Set(
      visibleAgents
        .filter((agent) => (
          participantById.get(agent.participantId)?.status === 'active'
        ))
        .map((agent) => agent.id),
    );
    const taskById = new Map(
      taskViews.map((task) => [task.taskId, task]),
    );
    const tasks = visibleAgents.flatMap((agent) => {
      const task = taskById.get(taskIdForAgent(agent.id));
      return task ? [toRepresentativeAgentTaskView(agent.id, task)] : [];
    });
    const activeTasks = tasks.filter((task) => activeAgentIds.has(task.agentId));
    const enabledTasks = activeTasks.filter((task) => task.enabled);

    return {
      enabled: workspace.backgroundChecksEnabled,
      running: activeTasks.some((task) => task.status === 'running'),
      intervalMs: this.config.heartbeatIntervalMs,
      nextRunAt: earliest(
        enabledTasks.flatMap((task) => task.nextRunAt ?? []),
      ),
      lastRunAt: latest(tasks.flatMap((task) => task.lastRunAt ?? [])),
      tasks,
    };
  }

  async triggerAgent(agentId: string): Promise<void> {
    if (!this.acceptingRuns || this.paused) {
      return;
    }
    const task = await this.tasks.requireTask(taskIdForAgent(agentId));
    if (!task.enabled || task.state?.status === 'blocked') {
      return;
    }
    if (task.state?.status !== 'running') {
      await this.tasks.triggerTaskRun(task.id);
      return;
    }
    this.scheduleTriggerAfterCurrentRun(agentId);
  }

  async runNow(): Promise<BackgroundChecksView> {
    if (!(await this.snapshot()).enabled) {
      throw new Error('Background checks are paused. Resume them before running now.');
    }
    await this.triggerAgentsWithUnreadEvents();
    return await this.snapshot();
  }

  async setEnabled(enabled: boolean): Promise<BackgroundChecksView> {
    if (!enabled) {
      await this.pauseRunningTasks();
    }
    await this.repository.setBackgroundChecksEnabled(enabled);
    this.paused = !enabled;
    await this.ensureAgentTasks();
    if (enabled) {
      await this.resumeBlockedActiveTasks();
      await this.triggerAgentsWithUnreadEvents();
    }
    return await this.snapshot();
  }

  async resetWorkspace(): Promise<void> {
    const wasEnabled = (await this.repository.readWorkspace())
      .backgroundChecksEnabled;
    await this.pauseRunningTasks();
    await this.deleteManagedTasks();
    await this.repository.reset({ backgroundChecksEnabled: wasEnabled });
    this.paused = !wasEnabled;
    await this.ensureAgentTasks();
  }

  async reconcileAgentTasks(): Promise<void> {
    await this.ensureAgentTasks();
  }

  async enableAgentTask(agentId: string): Promise<void> {
    await this.ensureAgentTasks();
    if (this.paused) {
      return;
    }
    const task = (await this.listManagedTasks()).find(
      (candidate) => candidate.id === taskIdForAgent(agentId),
    );
    if (!task) {
      throw new Error(`Heartbeat task is missing for agent: ${agentId}`);
    }
    if (task.state?.status === 'blocked') {
      await this.tasks.resumeTask(task.id);
    } else if (!task.enabled) {
      await this.tasks.setTaskEnabled(task.id, true);
    }
  }

  async disableAgentTask(agentId: string): Promise<void> {
    const activeWake = this.activeWakes.get(agentId);
    activeWake?.controller.abort();
    await activeWake?.settled;
    await this.pendingTriggerChecks.get(agentId);

    const taskId = taskIdForAgent(agentId);
    await this.waitForTaskToSettle(taskId);
    const task = (await this.listManagedTasks()).find(
      (candidate) => candidate.id === taskId,
    );
    if (task?.enabled) {
      await this.tasks.setTaskEnabled(task.id, false);
    }
  }

  private async ensureAgentTasks(
    options: { recoverInterrupted?: boolean } = {},
  ): Promise<void> {
    const [workspace, participants, agents, existingTasks] = await Promise.all([
      this.repository.readWorkspace(),
      this.repository.listParticipants(),
      this.repository.listAgents(),
      this.listManagedTasks(),
    ]);
    const participantById = new Map(
      participants.map((participant) => [participant.id, participant]),
    );
    const managedAgents = agents.filter(
      (agent) => participantById.get(agent.participantId)?.status !== 'retired',
    );
    const agentIds = new Set(managedAgents.map((agent) => agent.id));

    for (const task of existingTasks) {
      const agentId = agentIdFromTask(task.id);
      if (
        !agentId
        || !agentIds.has(agentId)
        || task.workspaceId !== workspace.versionId
      ) {
        await this.deleteTaskIncludingInterrupted(task);
      }
    }

    const currentTasks = new Map(
      (await this.listManagedTasks()).map((task) => [task.id, task]),
    );
    for (const agent of managedAgents) {
      const participant = participantById.get(agent.participantId);
      if (!participant) {
        throw new Error(`Participant not found for agent: ${agent.id}`);
      }
      const desiredEnabled = workspace.backgroundChecksEnabled
        && participant.status === 'active';
      const taskId = taskIdForAgent(agent.id);
      const existing = currentTasks.get(taskId);
      if (!existing) {
        await this.tasks.createTask({
          id: taskId,
          workspaceId: workspace.versionId,
          name: `${agent.name} background checks`,
          task: agent.purpose,
          enabled: desiredEnabled,
          continuationMode: 'operator',
          intervalMs: this.config.heartbeatIntervalMs,
          defer: true,
          model: this.config.model,
          maxSteps: this.config.maxSteps,
          workspaceRoot: this.config.repoRoot,
          stateDir: this.config.heddleStateRoot,
        });
        continue;
      }

      if (existing.state?.status === 'running' && !options.recoverInterrupted) {
        continue;
      }

      const interrupted = existing.state?.status === 'running';
      const recoveredTask: HeartbeatTask = {
        ...existing,
        workspaceId: workspace.versionId,
        name: `${agent.name} background checks`,
        task: agent.purpose,
        continuationMode: 'operator',
        schedule: {
          ...existing.schedule,
          intervalMs: this.config.heartbeatIntervalMs,
          nextRunAt: interrupted
            ? dayjs().subtract(1, 'second').toISOString()
            : existing.schedule.nextRunAt,
        },
        runtime: {
          ...existing.runtime,
          model: this.config.model,
          maxSteps: this.config.maxSteps,
          workspaceRoot: this.config.repoRoot,
          stateDir: this.config.heddleStateRoot,
        },
        state: interrupted
          ? {
              ...existing.state,
              status: 'waiting',
              progress:
                'Recovered an interrupted heartbeat after host restart.',
              error: undefined,
              updatedAt: dayjs().toISOString(),
            }
          : existing.state,
      };
      await this.tasks.saveTask(recoveredTask);
      if (
        recoveredTask.enabled !== desiredEnabled
        && !(desiredEnabled && recoveredTask.state?.status === 'blocked')
      ) {
        await this.tasks.setTaskEnabled(recoveredTask.id, desiredEnabled);
      }
    }
  }

  private async runAgentTask(
    task: HeartbeatTask,
    checkpoint: AgentLoopState | AgentLoopCheckpoint | undefined,
  ): Promise<AgentHeartbeatResult> {
    const agentId = agentIdFromTask(task.id);
    if (!agentId) {
      throw new Error(`Unknown Lucid heartbeat task: ${task.id}`);
    }
    if (!this.acceptingRuns || this.paused) {
      return createIdleHeartbeatResult(
        task,
        checkpoint,
        this.config,
        'Background checks are paused.',
      );
    }

    const activeWake = createActiveAgentWake();
    this.activeWakes.set(agentId, activeWake);
    const proposedWakeId = `wake_${randomUUID()}`;
    let claimedWake = false;

    try {
      const wake = await this.repository.beginAgentWake(
        agentId,
        proposedWakeId,
      );
      if (!wake) {
        return createIdleHeartbeatResult(
          task,
          checkpoint,
          this.config,
          'No unread messages were available for this agent.',
        );
      }
      claimedWake = true;

      const result = await this.runner.run({
        wake,
        checkpoint,
        intervalMs: task.schedule.intervalMs,
        signal: activeWake.controller.signal,
        onEvent: (event) => {
          this.logger.debug({
            agentId,
            eventType: event.type,
            wakeId: wake.wakeId,
          }, 'lucid.agent_heartbeat.activity');
        },
      });

      if (
        activeWake.controller.signal.aborted
        || !this.acceptingRuns
        || this.paused
      ) {
        await this.repository.interruptAgentWake(agentId);
        return createIdleHeartbeatResult(
          task,
          checkpoint,
          this.config,
          'Agent wake was interrupted before it consumed unread messages.',
        );
      }
      if (
        result.state.outcome !== 'done'
        || result.decision === 'escalate'
      ) {
        await this.repository.failAgentWake(agentId);
        claimedWake = false;
        return result;
      }

      await this.repository.appendEvent({
        wakeNumber: wake.wakeNumber,
        kind: 'agent_wake_completed',
        actorAgentId: agentId,
        idempotencyKey: `${wake.wakeId}:completed`,
        title: `${wake.agent.name} completes a background check`,
        content:
          'The representative finished processing its claimed mailbox messages.',
        metadata: {
          visibility: 'operator',
          wakeId: wake.wakeId,
          heartbeatRunId: result.state.runId,
          heartbeatSummary: result.summary,
          decision: result.decision,
          outcome: result.state.outcome,
        },
      });
      await this.repository.completeAgentWake(
        agentId,
        wake.horizonSequence,
      );
      await this.triggerAgentsWithUnreadEvents();
      return result;
    } catch (error) {
      if (
        claimedWake
        && (
          activeWake.controller.signal.aborted
          || !this.acceptingRuns
          || this.paused
        )
      ) {
        await this.repository.interruptAgentWake(agentId);
        return createIdleHeartbeatResult(
          task,
          checkpoint,
          this.config,
          'Agent wake was interrupted and will retry its unread messages later.',
        );
      }
      if (claimedWake) {
        await this.repository.failAgentWake(agentId);
      }
      throw error;
    } finally {
      this.activeWakes.delete(agentId);
      activeWake.settle();
    }
  }

  private async triggerAgentsWithUnreadEvents(): Promise<void> {
    const [agents, tasks] = await Promise.all([
      this.repository.listActiveAgents(),
      this.listManagedTasks(),
    ]);
    const taskById = new Map(tasks.map((task) => [task.id, task]));

    for (const agent of agents) {
      const task = taskById.get(taskIdForAgent(agent.id));
      if (!task?.enabled || task.state?.status === 'blocked') {
        continue;
      }
      const unreadEvents = await this.repository.listEventsVisibleToAgent(
        agent.id,
        agent.lastSeenSequence,
        1,
      );
      if (unreadEvents.length) {
        await this.triggerAgent(agent.id);
      }
    }
  }

  private scheduleTriggerAfterCurrentRun(agentId: string): void {
    if (this.pendingTriggerChecks.has(agentId)) {
      return;
    }
    const pending = this.triggerAfterCurrentRun(agentId)
      .catch((error: unknown) => {
        this.logger.error(
          { agentId, error },
          'lucid.heartbeat_trigger.failed',
        );
      })
      .finally(() => {
        if (this.pendingTriggerChecks.get(agentId) === pending) {
          this.pendingTriggerChecks.delete(agentId);
        }
      });
    this.pendingTriggerChecks.set(agentId, pending);
  }

  private async triggerAfterCurrentRun(agentId: string): Promise<void> {
    while (this.acceptingRuns && !this.paused) {
      const task = await this.tasks.requireTask(taskIdForAgent(agentId));
      if (task.state?.status !== 'running') {
        if (task.enabled && task.state?.status !== 'blocked') {
          await this.tasks.triggerTaskRun(task.id);
        }
        return;
      }
      await delay(25);
    }
  }

  private async listManagedTasks(): Promise<HeartbeatTask[]> {
    return (await this.tasks.listTasks()).filter(
      (task) => task.id.startsWith(TASK_ID_PREFIX),
    );
  }

  private async resumeBlockedActiveTasks(): Promise<void> {
    const [agents, tasks] = await Promise.all([
      this.repository.listActiveAgents(),
      this.listManagedTasks(),
    ]);
    const activeAgentIds = new Set(agents.map((agent) => agent.id));
    await Promise.all(tasks
      .filter((task) => {
        const agentId = agentIdFromTask(task.id);
        return agentId
          && activeAgentIds.has(agentId)
          && task.state?.status === 'blocked';
      })
      .map((task) => this.tasks.resumeTask(task.id)));
  }

  private async waitForTaskToSettle(taskId: string): Promise<void> {
    const deadline = dayjs().add(30, 'second');
    while (dayjs().isBefore(deadline)) {
      const task = (await this.listManagedTasks()).find(
        (candidate) => candidate.id === taskId,
      );
      if (!task || task.state?.status !== 'running') {
        return;
      }
      await delay(25);
    }
    throw new Error(`Timed out while waiting for heartbeat task: ${taskId}`);
  }

  private async deleteManagedTasks(): Promise<void> {
    for (const task of await this.listManagedTasks()) {
      await this.deleteTaskIncludingInterrupted(task);
    }
  }

  private async deleteTaskIncludingInterrupted(
    task: HeartbeatTask,
  ): Promise<void> {
    if (task.state?.status === 'running') {
      await this.tasks.saveTask({
        ...task,
        state: {
          ...task.state,
          status: 'waiting',
          progress: 'Recovered interrupted task before deleting it.',
          updatedAt: dayjs().toISOString(),
        },
      });
    }
    await this.tasks.deleteTask(task.id);
  }

  private abortActiveWakes(): void {
    this.activeWakes.forEach(({ controller }) => controller.abort());
  }

  private async waitForActiveWakes(): Promise<void> {
    await Promise.all(
      [...this.activeWakes.values()].map(({ settled }) => settled),
    );
  }

  private async waitForPendingTriggerChecks(): Promise<void> {
    await Promise.all([...this.pendingTriggerChecks.values()]);
  }

  private async pauseRunningTasks(): Promise<void> {
    this.paused = true;
    this.abortActiveWakes();
    await this.waitForActiveWakes();

    const deadline = dayjs().add(30, 'second');
    while (dayjs().isBefore(deadline)) {
      const tasks = await this.listManagedTasks();
      if (tasks.every((task) => task.state?.status !== 'running')) {
        return;
      }
      await delay(25);
    }
    throw new Error(
      'Timed out while waiting for running background checks to stop.',
    );
  }

  private logSchedulerEvent(event: HeartbeatSchedulerEvent): void {
    if (event.type === 'heartbeat.task.failed') {
      this.logger.error({
        taskId: event.taskId,
        error: event.error,
        nextRunAt: event.nextRunAt,
      }, 'lucid.heartbeat_task.failed');
      return;
    }
    this.logger.debug({
      eventType: event.type,
      taskId: 'taskId' in event ? event.taskId : undefined,
    }, 'lucid.heartbeat_scheduler.activity');
  }
}

function taskIdForAgent(agentId: string): string {
  return `${TASK_ID_PREFIX}${agentId}`;
}

function agentIdFromTask(taskId: string): string | undefined {
  return taskId.startsWith(TASK_ID_PREFIX)
    ? taskId.slice(TASK_ID_PREFIX.length)
    : undefined;
}

function toRepresentativeAgentTaskView(
  agentId: string,
  task: HeartbeatTaskView,
): RepresentativeAgentTaskView {
  return {
    taskId: task.taskId,
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

function createActiveAgentWake(): ActiveAgentWake {
  const controller = new AbortController();
  let settle = () => {};
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  return { controller, settled, settle };
}

function createIdleHeartbeatResult(
  task: HeartbeatTask,
  checkpoint: AgentLoopState | AgentLoopCheckpoint | undefined,
  config: LucidConfig,
  summary: string,
): AgentHeartbeatResult {
  const previousState = checkpoint
    ? 'state' in checkpoint ? checkpoint.state : checkpoint
    : undefined;
  const timestamp = dayjs().toISOString();
  const state: AgentLoopState = {
    status: 'finished',
    runId: AgentLoopCheckpointService.generateRunId(),
    goal: task.task,
    model: previousState?.model ?? config.model,
    provider: previousState?.provider
      ?? LlmAdapterService.resolveProvider({ model: config.model }),
    workspaceRoot: previousState?.workspaceRoot ?? config.repoRoot,
    startedAt: timestamp,
    finishedAt: timestamp,
    outcome: 'done',
    summary,
    transcript: previousState?.transcript ?? [],
    trace: [],
  };

  return {
    decision: 'pause',
    summary,
    checkpoint: AgentLoopCheckpointService.createCheckpoint(state),
    state,
  };
}

function earliest(values: string[]): string | undefined {
  return values.sort((left, right) => left.localeCompare(right))[0];
}

function latest(values: string[]): string | undefined {
  return values.sort((left, right) => right.localeCompare(left))[0];
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

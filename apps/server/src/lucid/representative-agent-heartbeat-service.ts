/**
 * Adapts Lucid's participant and mailbox lifecycle to Heddle heartbeat tasks.
 *
 * The repository remains authoritative for who may run and which events a wake
 * may consume. Heddle owns durable scheduling, credentials, cancellation,
 * checkpoints, and execution settlement. This module coordinates the two
 * systems without deciding whether message content is useful.
 */
import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import { Mutex } from 'async-mutex';
import {
  FileHeartbeatTaskService,
  HeartbeatSchedulerService,
  type AgentHeartbeatResult,
  type HeartbeatExecutionContext,
  type HeartbeatHandlerOutcome,
  type HeartbeatSchedulerEvent,
  type HeartbeatSchedulerHandle,
  type HeartbeatTask,
  type HeartbeatTaskCancellationDisposition,
  type HeartbeatTaskView,
} from '@roackb2/heddle/advanced';
import type { LucidConfig } from '../config.js';
import type { LucidLogger } from '../logger.js';
import type { DiscoveryRepository } from './discovery-repository.js';
import {
  networkMessageRoleSchema,
  type AgentWakeContext,
  type BackgroundChecksView,
  type RepresentativeAgentTaskView,
} from './discovery-types.js';
import type {
  RepresentativeAgentHeartbeatRunner,
} from './heddle-representative-agent-runner.js';

const TASK_ID_PREFIX = 'lucid-representative-';
const UNSAFE_CANCELLATION_DISPOSITIONS = new Set<
  HeartbeatTaskCancellationDisposition
>(['not-owned', 'not-found']);

/**
 * Hosts Lucid's representative agents as durable Heddle heartbeat tasks.
 *
 * Heddle owns task timing, checkpoints, run records, scheduler selection, and
 * provider execution. This service maps tasks to Lucid agents, claims mailbox
 * work, settles durable cursors, and accelerates only the recipients implied
 * by newly emitted request and response messages.
 */
export class RepresentativeAgentHeartbeatService {
  private readonly tasks: FileHeartbeatTaskService;
  private scheduler?: HeartbeatSchedulerHandle;
  private acceptingRuns = true;
  private paused = false;
  private readonly taskMutationMutex = new Mutex();

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

    // Recover through Heddle's claim-fenced API before reconciling task
    // configuration. The scheduler repeats this idempotent recovery at start.
    await this.tasks.recoverInterruptedTasks({
      ownerId: `lucid-startup:${randomUUID()}`,
      recoveredAt: dayjs().toDate(),
      reason: 'host-restart',
    });
    await this.ensureAgentTasks();
  }

  start(): void {
    if (
      this.scheduler
      || !this.acceptingRuns
      || this.paused
    ) {
      return;
    }

    let handle: HeartbeatSchedulerHandle;
    handle = HeartbeatSchedulerService.start({
      workspaceRoot: this.config.repoRoot,
      stateRoot: this.config.heddleStateRoot,
      store: this.tasks,
      handler: (context) => this.runAgentTask(context),
      model: this.config.model,
      maxSteps: this.config.maxSteps,
      preferApiKey: this.config.preferApiKey,
      pollIntervalMs: this.config.heartbeatPollMs,
      maxConcurrentTasks: this.config.heartbeatMaxConcurrency,
      onEvent: (event) => this.logSchedulerEvent(event),
      onError: (error) => {
        if (this.scheduler === handle) {
          this.scheduler = undefined;
        }
        this.logger.error({ error }, 'lucid.heartbeat_scheduler.failed');
      },
    });
    this.scheduler = handle;
  }

  async stop(): Promise<void> {
    this.acceptingRuns = false;
    await this.stopScheduler(true);
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

  /** Returns only one participant representative's execution projection. */
  async snapshotForAgent(agentId: string): Promise<BackgroundChecksView> {
    const network = await this.snapshot();
    const tasks = network.tasks.filter((task) => task.agentId === agentId);
    const enabledTasks = tasks.filter((task) => task.enabled);
    return {
      enabled: network.enabled && enabledTasks.length > 0,
      running: tasks.some((task) => task.status === 'running'),
      intervalMs: network.intervalMs,
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

    // Heddle persists level-triggered intent. Requests made while the task is
    // running coalesce into one follow-up generation without host polling.
    await this.tasks.requestTaskRun(task.id, {
      reason: `lucid-mailbox:${agentId}`,
    });
    this.start();
  }

  async resetWorkspace(): Promise<void> {
    await this.taskMutationMutex.runExclusive(async () => {
      const wasEnabled = (await this.repository.readWorkspace())
        .backgroundChecksEnabled;
      // Reset crosses Heddle files and SQLite. Quiesce first, remove the old
      // task generation, replace state, then materialize the new generation.
      await this.pauseRunningTasks();
      await this.deleteManagedTasks();
      await this.repository.reset({ backgroundChecksEnabled: wasEnabled });
      this.paused = !wasEnabled;
      await this.ensureAgentTasks();
      this.start();
    });
  }

  async reconcileAgentTasks(): Promise<void> {
    await this.taskMutationMutex.runExclusive(
      () => this.ensureAgentTasks(),
    );
  }

  async enableAgentTask(agentId: string): Promise<void> {
    await this.taskMutationMutex.runExclusive(async () => {
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
      this.start();
    });
  }

  async disableAgentTasks(agentIds: string[]): Promise<void> {
    await this.taskMutationMutex.runExclusive(async () => {
      const uniqueAgentIds = [...new Set(agentIds)];
      if (!uniqueAgentIds.length) {
        return;
      }

      // Resolve every target before changing anything. A missing derived task
      // is an invariant failure, not permission to mutate participant state.
      const tasks = await Promise.all(uniqueAgentIds.map((agentId) => (
        this.tasks.requireTask(taskIdForAgent(agentId))
      )));
      const tasksRequiringSettlement = tasks.filter((task) => (
        task.enabled || task.state?.status === 'running'
      ));
      if (!tasksRequiringSettlement.length) {
        return;
      }

      const scheduler = this.scheduler;
      if (!scheduler) {
        const runningTask = tasksRequiringSettlement.find(
          (task) => task.state?.status === 'running',
        );
        if (runningTask) {
          throw new Error(
            `Cannot safely disable heartbeat task ${runningTask.id}: no local scheduler handle owns its running execution.`,
          );
        }
      } else {
        // Heddle invalidates queued admission, aborts only the requested task,
        // and awaits settlement. Other participant wakes keep running.
        const results = await Promise.all(tasksRequiringSettlement.map((task) => (
          scheduler.cancelTask(task.id, {
            reason: 'Lucid participant lifecycle change',
          })
        )));
        const unsafeResult = results.find(({ disposition }) => (
          UNSAFE_CANCELLATION_DISPOSITIONS.has(disposition)
        ));
        if (unsafeResult) {
          throw new Error(
            `Cannot safely disable heartbeat task ${unsafeResult.taskId}: cancellation returned ${unsafeResult.disposition}.`,
          );
        }
      }

      // Disable only after every target can no longer retain old participant
      // context or cross the boundary being changed by the caller.
      await Promise.all(tasksRequiringSettlement
        .filter((task) => task.enabled)
        .map((task) => this.tasks.setTaskEnabled(task.id, false)));
    });
  }

  private async ensureAgentTasks(): Promise<void> {
    // Domain participant state owns network availability. For active
    // participants, the existing Heddle task retains its durable personal
    // listening preference across host restarts and unrelated reconciliation.
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

    // Startup recovery and participant lifecycle commands settle executions
    // before an obsolete task can reach this deletion boundary.
    for (const task of existingTasks) {
      const agentId = agentIdFromTask(task.id);
      if (
        !agentId
        || !agentIds.has(agentId)
        || task.workspaceId !== workspace.versionId
      ) {
        await this.tasks.deleteTask(task.id);
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
      const taskId = taskIdForAgent(agent.id);
      const existing = currentTasks.get(taskId);
      const desiredEnabled = workspace.backgroundChecksEnabled
        && participant.status === 'active'
        && (existing?.enabled ?? true);
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

      // A live execution owns the persisted task until Heddle settles it.
      if (existing.state?.status === 'running') {
        continue;
      }

      const updatedTask: HeartbeatTask = {
        ...existing,
        workspaceId: workspace.versionId,
        name: `${agent.name} background checks`,
        task: agent.purpose,
        continuationMode: 'operator',
        schedule: {
          ...existing.schedule,
          intervalMs: this.config.heartbeatIntervalMs,
        },
        runtime: {
          ...existing.runtime,
          model: this.config.model,
          maxSteps: this.config.maxSteps,
          workspaceRoot: this.config.repoRoot,
          stateDir: this.config.heddleStateRoot,
        },
      };
      await this.tasks.saveTask(updatedTask);
      if (
        updatedTask.enabled !== desiredEnabled
        && !(desiredEnabled && updatedTask.state?.status === 'blocked')
      ) {
        await this.tasks.setTaskEnabled(updatedTask.id, desiredEnabled);
      }
    }
  }

  private async runAgentTask(
    execution: HeartbeatExecutionContext,
  ): Promise<AgentHeartbeatResult | HeartbeatHandlerOutcome> {
    const agentId = agentIdFromTask(execution.task.id);
    if (!agentId) {
      throw new Error(`Unknown Lucid heartbeat task: ${execution.task.id}`);
    }
    if (!this.acceptingRuns || this.paused) {
      return execution.skip({ summary: 'Background checks are paused.' });
    }

    const proposedWakeId = `wake_${randomUUID()}`;
    let claimedWake: AgentWakeContext | undefined;

    try {
      // The repository atomically fixes the mailbox horizon and persists the
      // claim. Retries reuse that identity and cannot observe newer mail.
      const wake = await this.repository.beginAgentWake(
        agentId,
        proposedWakeId,
      );
      if (!wake) {
        // context.skip() records a lightweight non-agent outcome and avoids
        // manufacturing an LLM checkpoint for a healthy empty mailbox.
        return execution.skip({
          summary: 'No unread messages were available for this agent.',
        });
      }
      claimedWake = wake;

      const result = await this.runner.run({
        wake,
        execution,
        onEvent: (event) => {
          this.logger.debug({
            agentId,
            eventType: event.type,
            wakeId: wake.wakeId,
          }, 'lucid.agent_heartbeat.activity');
        },
      });

      if (
        execution.signal.aborted
        || !this.acceptingRuns
        || this.paused
      ) {
        // Heddle records scheduler cancellation; Lucid independently preserves
        // the claimed horizon and unread cursor for the next domain retry.
        await this.repository.interruptAgentWake(agentId, wake.claimToken);
        return result;
      }
      if (
        result.state.outcome !== 'done'
        || result.decision === 'escalate'
      ) {
        await this.repository.failAgentWake(agentId, wake.claimToken);
        claimedWake = undefined;
        return result;
      }

      const requiredRequestSourceIds = wake.visibleEvents
        .filter(({ kind }) => (
          kind === 'interest_saved' || kind === 'check_requested'
        ))
        .map(({ sequence }) => sequence);
      if (
        requiredRequestSourceIds.length
        && !(await Promise.all(requiredRequestSourceIds.map(
          async (sourceEventId) => Boolean(
            await this.repository.findAgentPublishedRequestForTrigger(
              agentId,
              sourceEventId,
            ),
          ),
        ))).every(Boolean)
      ) {
        // Saving an assignment cannot be acknowledged as complete until the
        // representative actually publishes a privacy-minimized request. A
        // failed wake retains its fixed horizon and retry-stable action slots.
        await this.repository.failAgentWake(agentId, wake.claimToken);
        claimedWake = undefined;
        throw new Error(
          'The representative finished without sharing the required network request.',
        );
      }

      const requiredWorkingNoteSourceIds = wake.visibleEvents
        .filter(({ kind }) => kind === 'guidance_saved')
        .map(({ sequence }) => sequence);
      if (
        requiredWorkingNoteSourceIds.length
        && !(await Promise.all(requiredWorkingNoteSourceIds.map(
          (sourceEventId) => this.repository.hasAgentUpdatedWorkingNoteThrough(
            agentId,
            sourceEventId,
          ),
        ))).every(Boolean)
      ) {
        // Direct participant guidance changes the representative's durable
        // interpretation. A model summary alone cannot acknowledge it: the
        // revised note must exist before the mailbox cursor advances.
        await this.repository.failAgentWake(agentId, wake.claimToken);
        claimedWake = undefined;
        throw new Error(
          'The representative finished without revising its working note for the latest guidance.',
        );
      }

      // Completion is idempotent and precedes cursor advancement. A crash
      // between the writes can replay the same wake without duplicate events.
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
        wake.claimToken,
        wake.horizonSequence,
      );
      claimedWake = undefined;
      // Route only the new messages from this wake. A root request fans out
      // once; responses return to the requester; ambient contributions wait
      // for normal schedules. This avoids treating every shared message as a
      // reason to wake the entire network again.
      await this.triggerRecipientsForWake(agentId, wake.wakeNumber);
      return result;
    } catch (error) {
      if (
        claimedWake
        && (
          execution.signal.aborted
          || !this.acceptingRuns
          || this.paused
        )
      ) {
        await this.repository.interruptAgentWake(
          agentId,
          claimedWake.claimToken,
        );
      } else if (claimedWake) {
        await this.repository.failAgentWake(agentId, claimedWake.claimToken);
      }
      throw error;
    }
  }

  private async triggerRecipientsForWake(
    sourceAgentId: string,
    wakeNumber: number,
  ): Promise<void> {
    const [messages, activeAgents] = await Promise.all([
      this.repository.listAgentWakeCommunicationEvents(
        sourceAgentId,
        wakeNumber,
      ),
      this.repository.listActiveAgents(),
    ]);
    const activeAgentIds = new Set(activeAgents.map(({ id }) => id));
    const recipientIds = new Set<string>();

    for (const message of messages) {
      if (message.kind === 'direct_message') {
        if (message.targetAgentId && activeAgentIds.has(message.targetAgentId)) {
          recipientIds.add(message.targetAgentId);
        }
        continue;
      }

      const messageRole = networkMessageRoleSchema.safeParse(
        message.metadata.messageRole,
      ).data;
      if (messageRole === 'request') {
        activeAgents
          .filter(({ id }) => id !== sourceAgentId)
          .forEach(({ id }) => recipientIds.add(id));
        continue;
      }

      if (
        messageRole === 'response'
        && message.replyToSequence
      ) {
        const repliedTo = await this.repository.readEvent(
          message.replyToSequence,
        );
        if (
          repliedTo?.actorAgentId
          && repliedTo.actorAgentId !== sourceAgentId
          && activeAgentIds.has(repliedTo.actorAgentId)
        ) {
          recipientIds.add(repliedTo.actorAgentId);
        }
      }
    }

    const recipients = [...recipientIds];
    const results = await Promise.allSettled(
      recipients.map((agentId) => this.triggerAgent(agentId)),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.warn({
          error: result.reason,
          sourceAgentId,
          targetAgentId: recipients[index],
          wakeNumber,
        }, 'lucid.heartbeat_recipient_trigger.failed');
      }
    });
  }

  private async listManagedTasks(): Promise<HeartbeatTask[]> {
    return (await this.tasks.listTasks()).filter(
      (task) => task.id.startsWith(TASK_ID_PREFIX),
    );
  }

  private async deleteManagedTasks(): Promise<void> {
    await Promise.all(
      (await this.listManagedTasks()).map((task) => (
        this.tasks.deleteTask(task.id)
      )),
    );
  }

  private async pauseRunningTasks(): Promise<void> {
    this.paused = true;
    await this.stopScheduler(true);
  }

  private async stopScheduler(cancelRunning: boolean): Promise<void> {
    const scheduler = this.scheduler;
    if (!scheduler) {
      return;
    }

    try {
      // Heddle owns idempotent stop settlement. Retain the handle while it is
      // stopping so concurrent start calls cannot create a second scheduler.
      await scheduler.stop({ cancelRunning });
    } finally {
      if (this.scheduler === scheduler) {
        this.scheduler = undefined;
      }
    }
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

function earliest(values: string[]): string | undefined {
  return values.sort((left, right) => left.localeCompare(right))[0];
}

function latest(values: string[]): string | undefined {
  return values.sort((left, right) => right.localeCompare(left))[0];
}

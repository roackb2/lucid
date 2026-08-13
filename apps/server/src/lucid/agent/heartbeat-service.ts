/**
 * Adapts Lucid's user and mailbox lifecycle to Heddle heartbeat tasks.
 *
 * The store remains authoritative for who may run and which events a wake
 * may consume. Heddle owns durable scheduling, credentials, cancellation,
 * checkpoints, and execution settlement. This module coordinates the two
 * systems without deciding whether message content is useful.
 */
import { Mutex } from 'async-mutex';
import {
  type AgentHeartbeatResult,
  type HeartbeatExecutionContext,
  type HeartbeatHandlerOutcome,
  type HeartbeatTask,
  type HeartbeatTaskCancellationDisposition,
  type HeartbeatTaskView,
} from '@roackb2/heddle/advanced';
import type { LucidConfig } from '../../config.js';
import type { LucidLogger } from '../../logger.js';
import type {
  AgentExecutionHost,
  AgentHeartbeatTaskAuthority,
} from '../../runtime/agent-execution-host.js';
import {
  networkMessageRoleSchema,
  type AgentWakeClaim,
  type AgentWakeContext,
  type BackgroundChecksView,
  type AgentTaskView,
} from '../discovery-types.js';
import type {
  AgentHeartbeatRunner,
} from './heddle-runner.js';
import type {
  AgentWakeStore,
} from './store.js';
import type {
  AgentWorkingContextReader,
} from '../workspace/store.js';

/**
 * Stable persisted Heddle task key. The value predates the user/agent vocabulary
 * and must not change without migrating task and run-record identities.
 */
export const AGENT_TASK_ID_PREFIX = 'lucid-representative-';
const UNSAFE_CANCELLATION_DISPOSITIONS = new Set<
  HeartbeatTaskCancellationDisposition
>(['not-owned', 'not-found']);

/**
 * Hosts Lucid's agents as durable Heddle heartbeat tasks.
 *
 * Heddle owns task timing, checkpoints, run records, scheduler selection, and
 * provider execution. This service maps tasks to Lucid agents, claims mailbox
 * work, settles durable cursors, and accelerates only the recipients implied
 * by newly emitted request and response messages.
 */
export class AgentHeartbeatService {
  private acceptingRuns = true;
  private globallyEnabled = true;
  private hostStarted = false;
  private readonly taskMutationMutex = new Mutex();

  constructor(
    private readonly store: AgentWakeStore,
    private readonly workingContext: AgentWorkingContextReader,
    private readonly runner: AgentHeartbeatRunner,
    private readonly config: LucidConfig,
    private readonly logger: LucidLogger,
    private readonly tasks: AgentHeartbeatTaskAuthority,
    private readonly executionHost: AgentExecutionHost,
  ) {}

  async initialize(): Promise<void> {
    const workspace = await this.store.readWorkspace();
    this.globallyEnabled = workspace.backgroundChecksEnabled;
    await this.ensureAgentTasks();
  }

  start(): void {
    if (this.hostStarted || !this.acceptingRuns) {
      return;
    }
    this.hostStarted = true;
    this.executionHost.start({
      handler: (context) => this.runAgentTask(context),
      globallyEnabled: this.globallyEnabled,
    });
  }

  async stop(): Promise<void> {
    this.acceptingRuns = false;
    await this.executionHost.stop({ cancelRunning: true });
  }

  async snapshot(): Promise<BackgroundChecksView> {
    const [workspace, users, agents, taskViews] = await Promise.all([
      this.store.readWorkspace(),
      this.store.listUsers(),
      this.store.listAgents(),
      this.tasks.listTaskViews(),
    ]);
    const userById = new Map(
      users.map((user) => [user.id, user]),
    );
    const visibleAgents = agents.filter(
      (agent) => userById.get(agent.userId)?.status !== 'retired',
    );
    const activeAgentIds = new Set(
      visibleAgents
        .filter((agent) => (
          userById.get(agent.userId)?.status === 'active'
        ))
        .map((agent) => agent.id),
    );
    const taskById = new Map(
      taskViews.map((task) => [task.taskId, task]),
    );
    const tasks = visibleAgents.flatMap((agent) => {
      const task = taskById.get(taskIdForAgent(agent.id));
      return task ? [toAgentTaskView(agent.id, task)] : [];
    });
    const activeTasks = tasks.filter((task) => activeAgentIds.has(task.agentId));
    const enabledTasks = activeTasks.filter((task) => task.enabled);

    return {
      enabled: enabledTasks.length > 0,
      dispatchEnabled: workspace.backgroundChecksEnabled,
      running: activeTasks.some((task) => task.status === 'running'),
      intervalMs: this.config.heartbeatIntervalMs,
      nextRunAt: earliest(
        enabledTasks.flatMap((task) => task.nextRunAt ?? []),
      ),
      lastRunAt: latest(tasks.flatMap((task) => task.lastRunAt ?? [])),
      tasks,
    };
  }

  /** Returns the execution projection for one user's agent. */
  async snapshotForAgent(agentId: string): Promise<BackgroundChecksView> {
    const network = await this.snapshot();
    const tasks = network.tasks.filter((task) => task.agentId === agentId);
    const enabledTasks = tasks.filter((task) => task.enabled);
    return {
      enabled: enabledTasks.length > 0,
      dispatchEnabled: network.dispatchEnabled,
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
    if (!this.acceptingRuns) {
      return;
    }
    const task = await this.requireManagedTask(agentId);
    if (!task.enabled || task.state?.status === 'blocked') {
      return;
    }

    // Heddle persists level-triggered intent. Requests made while the task is
    // running coalesce into one follow-up generation without host polling.
    const request = await this.tasks.requestTaskRun(task.id, {
      reason: `lucid-mailbox:${agentId}`,
    });
    if ((await this.store.readWorkspace()).backgroundChecksEnabled) {
      this.executionHost.notify(request);
    }
  }

  /**
   * Changes the durable operator gate without rewriting user task
   * preferences. Pausing settles only work owned by this execution host.
   */
  async setGlobalBackgroundChecksEnabled(enabled: boolean): Promise<void> {
    await this.taskMutationMutex.runExclusive(async () => {
      if (!enabled) {
        await this.store.setBackgroundChecksEnabled(false);
        this.globallyEnabled = false;
        await this.executionHost.pause({
          reason: 'Lucid operator paused global background dispatch.',
        });
        return;
      }

      await this.store.setBackgroundChecksEnabled(true);
      this.globallyEnabled = true;
      try {
        this.executionHost.resume();
      } catch (error) {
        await this.store.setBackgroundChecksEnabled(false);
        this.globallyEnabled = false;
        await this.executionHost.pause({
          reason: 'Lucid global dispatch resume failed closed.',
        });
        throw error;
      }
    });
  }

  async resetWorkspace(): Promise<void> {
    await this.taskMutationMutex.runExclusive(async () => {
      const wasEnabled = (await this.store.readWorkspace())
        .backgroundChecksEnabled;
      // The durable gate closes before either store changes. A remote running
      // task that this host cannot cancel then fails deletion through Heddle's
      // administration policy instead of crossing the reset boundary.
      await this.store.setBackgroundChecksEnabled(false);
      this.globallyEnabled = false;
      await this.executionHost.pause({
        reason: 'Lucid workspace reset.',
      });
      await this.deleteManagedTasks();
      await this.store.reset({ backgroundChecksEnabled: false });
      await this.ensureAgentTasks();
      if (wasEnabled) {
        await this.store.setBackgroundChecksEnabled(true);
        this.globallyEnabled = true;
        this.executionHost.resume();
      }
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
      const task = await this.requireManagedTask(agentId);
      if (task.state?.status === 'blocked') {
        await this.tasks.resumeTask(task.id);
      } else if (!task.enabled) {
        await this.tasks.setTaskEnabled(task.id, true);
      }
    });
  }

  async disableAgentTasks(agentIds: string[]): Promise<void> {
    await this.taskMutationMutex.runExclusive(async () => {
      const uniqueAgentIds = [...new Set(agentIds)];
      if (!uniqueAgentIds.length) {
        return;
      }

      // Resolve every target before changing anything. A missing derived task
      // is an invariant failure, not permission to mutate user state.
      const tasks = await Promise.all(uniqueAgentIds.map((agentId) => (
        this.requireManagedTask(agentId)
      )));
      const tasksRequiringSettlement = tasks.filter((task) => (
        task.enabled || task.state?.status === 'running'
      ));
      if (!tasksRequiringSettlement.length) {
        return;
      }

      // The host cancels only work it owns. A durable running task without a
      // matching local invocation is explicitly `not-owned` and fails closed.
      const results = await Promise.all(tasksRequiringSettlement.map((task) => (
        this.executionHost.cancelTask(task.id, {
          reason: 'Lucid user lifecycle change',
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

      // Disable only after every target can no longer retain old user
      // context or cross the boundary being changed by the caller.
      await Promise.all(tasksRequiringSettlement
        .filter((task) => task.enabled)
        .map((task) => this.tasks.setTaskEnabled(task.id, false)));
    });
  }

  private async ensureAgentTasks(): Promise<void> {
    // Domain user state owns network availability. For active
    // users, the existing Heddle task retains its durable personal
    // listening preference across host restarts and unrelated reconciliation.
    const [workspace, users, agents, existingTasks] = await Promise.all([
      this.store.readWorkspace(),
      this.store.listUsers(),
      this.store.listAgents(),
      this.listManagedTasks(),
    ]);
    const userById = new Map(
      users.map((user) => [user.id, user]),
    );
    const managedAgents = agents.filter(
      (agent) => userById.get(agent.userId)?.status !== 'retired',
    );
    const agentIds = new Set(managedAgents.map((agent) => agent.id));

    // Execution hosts settle their own work before reset or user
    // mutations. Heddle still rejects deletion of non-owned running tasks.
    for (const task of existingTasks) {
      const agentId = agentIdFromTask(task.id);
      if (
        !agentId
        || !agentIds.has(agentId)
        || taskRequiresReplacement(task, workspace.versionId, this.config)
      ) {
        await this.tasks.deleteTask(task.id);
      }
    }

    const currentTasks = new Map(
      (await this.listManagedTasks()).map((task) => [task.id, task]),
    );
    for (const agent of managedAgents) {
      const user = userById.get(agent.userId);
      if (!user) {
        throw new Error(`User not found for agent: ${agent.id}`);
      }
      const taskId = taskIdForAgent(agent.id);
      const existing = currentTasks.get(taskId);
      const desiredEnabled = user.status === 'active'
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

      await this.tasks.updateTask(existing.id, {
        name: `${agent.name} background checks`,
        task: agent.purpose,
        continuationMode: 'operator',
        intervalMs: this.config.heartbeatIntervalMs,
        model: this.config.model,
        maxSteps: this.config.maxSteps,
      });
      if (
        existing.enabled !== desiredEnabled
        && !(desiredEnabled && existing.state?.status === 'blocked')
      ) {
        await this.tasks.setTaskEnabled(existing.id, desiredEnabled);
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
    if (!await this.isGlobalDispatchAllowed()) {
      return execution.skip({ summary: 'Background checks are paused.' });
    }

    let claimedWake: AgentWakeClaim | undefined;

    try {
      const interruptedExecutionId = execution.task.state?.recovery
        ?.interruptedExecutionId;
      if (interruptedExecutionId) {
        await this.store.recoverInterruptedAgentWake(
          agentId,
          interruptedExecutionId,
        );
      }
      // The store atomically fixes the mailbox horizon and persists the
      // claim. The Heddle execution ID is also Lucid's claim-fencing token, so
      // lease recovery can release only the matching interrupted product wake.
      const claim = await this.store.beginAgentWake(
        agentId,
        execution.executionId,
      );
      if (!claim) {
        // context.skip() records a lightweight non-agent outcome and avoids
        // manufacturing an LLM checkpoint for a healthy empty mailbox.
        return execution.skip({
          summary: 'No unread messages were available for this agent.',
        });
      }
      claimedWake = claim;
      const wake: AgentWakeContext = {
        ...claim,
        workingContext:
          await this.workingContext.readAgentWorkingContext(
            agentId,
            claim.horizonSequence,
          ),
      };

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

      if (!await this.isExecutionAllowed(execution.signal)) {
        // Heddle records scheduler cancellation; Lucid independently preserves
        // the claimed horizon and unread cursor for the next domain retry.
        await this.store.interruptAgentWake(agentId, wake.claimToken);
        return execution.signal.aborted
          ? result
          : execution.retry({
            summary: 'Global background dispatch paused before Lucid commit.',
            delayMs: this.config.heartbeatPollMs,
          });
      }
      if (
        result.state.outcome !== 'done'
        || result.decision === 'escalate'
      ) {
        await this.store.failAgentWake(agentId, wake.claimToken);
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
            await this.store.findAgentPublishedRequestForTrigger(
              agentId,
              sourceEventId,
            ),
          ),
        ))).every(Boolean)
      ) {
        // Saving an assignment cannot be acknowledged as complete until the
        // agent actually publishes a privacy-minimized request. A
        // failed wake retains its fixed horizon and retry-stable action slots.
        await this.store.failAgentWake(agentId, wake.claimToken);
        claimedWake = undefined;
        throw new Error(
          'The agent finished without sharing the required network request.',
        );
      }

      const requiredWorkingNoteSourceIds = wake.visibleEvents
        .filter(({ kind }) => kind === 'guidance_saved')
        .map(({ sequence }) => sequence);
      if (
        requiredWorkingNoteSourceIds.length
        && !(await Promise.all(requiredWorkingNoteSourceIds.map(
          (sourceEventId) => this.store.hasAgentUpdatedWorkingNoteThrough(
            agentId,
            sourceEventId,
          ),
        ))).every(Boolean)
      ) {
        // Direct user guidance changes the agent's durable
        // interpretation. A model summary alone cannot acknowledge it: the
        // revised note must exist before the mailbox cursor advances.
        await this.store.failAgentWake(agentId, wake.claimToken);
        claimedWake = undefined;
        throw new Error(
          'The agent finished without revising its working note for the latest guidance.',
        );
      }

      // Completion is idempotent and precedes cursor advancement. A crash
      // between the writes can replay the same wake without duplicate events.
      await this.store.recordWakeCompletion({
        wakeNumber: wake.wakeNumber,
        actorAgentId: agentId,
        idempotencyKey: `${wake.wakeId}:completed`,
        title: `${wake.agent.name} completes a background check`,
        content:
          'The agent finished processing its claimed mailbox messages.',
        metadata: {
          visibility: 'operator',
          wakeId: wake.wakeId,
          heartbeatRunId: result.state.runId,
          heartbeatSummary: result.summary,
          decision: result.decision,
          outcome: result.state.outcome,
        },
      });
      await this.store.completeAgentWake(
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
      if (claimedWake && !await this.isExecutionAllowed(execution.signal)) {
        await this.store.interruptAgentWake(
          agentId,
          claimedWake.claimToken,
        );
      } else if (claimedWake) {
        await this.store.failAgentWake(agentId, claimedWake.claimToken);
      }
      throw error;
    }
  }

  private async triggerRecipientsForWake(
    sourceAgentId: string,
    wakeNumber: number,
  ): Promise<void> {
    const [messages, activeAgents] = await Promise.all([
      this.store.listAgentWakeCommunicationEvents(
        sourceAgentId,
        wakeNumber,
      ),
      this.store.listActiveAgents(),
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
        const repliedTo = await this.store.readEvent(
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
      (task) => task.id.startsWith(AGENT_TASK_ID_PREFIX),
    );
  }

  private async requireManagedTask(agentId: string): Promise<HeartbeatTask> {
    const taskId = taskIdForAgent(agentId);
    const task = await this.tasks.loadTask(taskId);
    if (!task) {
      throw new Error(`Heartbeat task is missing for agent: ${agentId}`);
    }
    return task;
  }

  private async deleteManagedTasks(): Promise<void> {
    await Promise.all(
      (await this.listManagedTasks()).map((task) => (
        this.tasks.deleteTask(task.id)
      )),
    );
  }

  private async isGlobalDispatchAllowed(): Promise<boolean> {
    if (!this.acceptingRuns) {
      return false;
    }
    try {
      return (await this.store.readWorkspace()).backgroundChecksEnabled;
    } catch (error) {
      this.logger.error({ error }, 'lucid.global_dispatch_gate.failed');
      return false;
    }
  }

  private async isExecutionAllowed(signal: AbortSignal): Promise<boolean> {
    return !signal.aborted && await this.isGlobalDispatchAllowed();
  }
}

function taskIdForAgent(agentId: string): string {
  return `${AGENT_TASK_ID_PREFIX}${agentId}`;
}

function agentIdFromTask(taskId: string): string | undefined {
  return taskId.startsWith(AGENT_TASK_ID_PREFIX)
    ? taskId.slice(AGENT_TASK_ID_PREFIX.length)
    : undefined;
}

function taskRequiresReplacement(
  task: HeartbeatTask,
  workspaceId: string,
  config: LucidConfig,
): boolean {
  return task.workspaceId !== workspaceId
    || task.runtime?.workspaceRoot !== config.repoRoot
    || task.runtime?.stateDir !== config.heddleStateRoot;
}

function toAgentTaskView(
  agentId: string,
  task: HeartbeatTaskView,
): AgentTaskView {
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

import { randomUUID } from 'node:crypto';
import { Semaphore } from 'async-mutex';
import {
  HeartbeatTaskExecutionEligibilityPolicy,
  type HeartbeatTargetedTaskStore,
  type HeartbeatTaskRunRequestSignal,
  type RunHeartbeatTaskResult,
} from '@roackb2/heddle/advanced';
import type {
  AgentTaskInvocation,
  AgentTaskInvocationTarget,
} from './agent-task-invocation.js';

type AgentTaskCatalog = Pick<
  HeartbeatTargetedTaskStore,
  'listTasks'
>;

export type AgentTaskDispatchDecision =
  | { kind: 'complete-delivery' }
  | { kind: 'retry-transiently'; delayMs: number }
  | { kind: 'wait-for-durable-schedule' };

export type AgentTaskDispatchOutcome = {
  taskId: string;
  invocationId: string;
  runRequestGeneration?: number;
  result: RunHeartbeatTaskResult;
  decision: AgentTaskDispatchDecision;
};

export type AgentTaskDispatchError = {
  phase: 'global-gate' | 'poll' | 'invoke';
  error: unknown;
  taskId?: string;
  invocationId?: string;
};

export type AgentTaskNotificationResult = {
  taskId: string;
  status: 'queued' | 'coalesced' | 'not-managed' | 'not-running';
};

export type AgentTaskCancellationResult = {
  taskId: string;
  disposition: 'cancelled' | 'not-active';
  invocationId?: string;
};

export type InProcessAgentTaskDispatcherOptions = {
  store: AgentTaskCatalog;
  target: AgentTaskInvocationTarget;
  taskIdPrefix: string;
  pollIntervalMs: number;
  maxConcurrentInvocations: number;
  /** Cooperative wall-clock bound for one local or remote invocation. */
  invocationTimeoutMs: number;
  /** Retry delay only for transient ownership contention. */
  contentionRetryMs?: number;
  /** Must read the durable Lucid operator gate, not process-local state. */
  isGloballyEnabled: () => Promise<boolean>;
  now?: () => Date;
  createInvocationId?: (
    taskId: string,
    runRequestGeneration: number | undefined,
  ) => string;
  onOutcome?: (outcome: AgentTaskDispatchOutcome) => void;
  onError?: (error: AgentTaskDispatchError) => void;
};

type DispatcherState = 'idle' | 'running' | 'stopping' | 'stopped';
type DrainDisposition = 'drained' | 'paused' | 'saturated' | 'stopped';

type ActiveInvocation = {
  invocation: AgentTaskInvocation;
  controller: AbortController;
  promise: Promise<void>;
  suppressRetry: boolean;
};

type PendingInvocation = {
  runRequestGeneration?: number;
};

const DEFAULT_CONTENTION_RETRY_MS = 1_000;

/**
 * Low-volume targeted dispatcher for Lucid's local and hosted-proof runtime.
 *
 * Notifications provide the fast path after a durable Heddle run request.
 * Polling the task catalog is the correctness fallback for periodic work and
 * for a process crash between persistence and notification. Each delivery is
 * still one targeted invocation; Heddle performs the authoritative due claim.
 */
export class InProcessAgentTaskDispatcher {
  private readonly semaphore: Semaphore;
  private readonly pending = new Map<string, PendingInvocation>();
  private readonly active = new Map<string, ActiveInvocation>();
  private readonly retryTimers = new Map<string, NodeJS.Timeout>();
  private state: DispatcherState = 'idle';
  private pollTimer?: NodeJS.Timeout;
  private pollPromise?: Promise<void>;
  private drainPromise?: Promise<void>;
  private admissionPaused = false;

  constructor(
    private readonly options: InProcessAgentTaskDispatcherOptions,
  ) {
    assertPositiveInteger(options.pollIntervalMs, 'pollIntervalMs');
    assertPositiveInteger(
      options.maxConcurrentInvocations,
      'maxConcurrentInvocations',
    );
    assertPositiveInteger(options.invocationTimeoutMs, 'invocationTimeoutMs');
    assertPositiveInteger(
      options.contentionRetryMs ?? DEFAULT_CONTENTION_RETRY_MS,
      'contentionRetryMs',
    );
    if (!options.taskIdPrefix.trim()) {
      throw new Error('Agent task dispatcher requires a task ID prefix.');
    }
    this.semaphore = new Semaphore(options.maxConcurrentInvocations);
  }

  /** Starts an immediate recovery scan followed by non-overlapping polls. */
  start(): void {
    if (this.state === 'running') {
      return;
    }
    if (this.state !== 'idle') {
      throw new Error('A stopped agent task dispatcher cannot restart.');
    }
    this.state = 'running';
    this.schedulePoll(0);
  }

  /**
   * Suspends new admission while preserving durable and process-local hints.
   * Active invocations owned by this dispatcher are aborted and awaited.
   */
  async pause(reason: string): Promise<void> {
    const normalizedReason = requireCancellationReason(reason);
    if (this.state === 'stopped') {
      return;
    }

    this.admissionPaused = true;
    this.clearPollTimer();
    this.retryTimers.forEach((timer) => clearTimeout(timer));
    this.retryTimers.clear();

    const active = [...this.active.values()];
    active.forEach((invocation) => {
      invocation.suppressRetry = true;
      invocation.controller.abort(normalizedReason);
    });
    await Promise.allSettled(active.map(({ promise }) => promise));
  }

  /** Resumes admission and immediately scans durable task state. */
  resume(): void {
    if (this.state !== 'running' || !this.admissionPaused) {
      return;
    }
    this.admissionPaused = false;
    this.schedulePoll(0);
    this.kickDrain();
  }

  /** Requests a non-overlapping immediate correctness scan. */
  scanNow(): void {
    if (
      this.state !== 'running'
      || this.admissionPaused
      || this.pollPromise
    ) {
      return;
    }
    this.clearPollTimer();
    this.schedulePoll(0);
  }

  /**
   * Adds a persisted Heddle run request to the low-latency delivery path.
   * Duplicate signals for one generation coalesce without invoking the task
   * concurrently; a newer generation waits behind the current invocation.
   */
  notify(
    request: HeartbeatTaskRunRequestSignal,
  ): AgentTaskNotificationResult {
    if (!this.isManagedTask(request.taskId)) {
      return { taskId: request.taskId, status: 'not-managed' };
    }
    if (this.state !== 'running') {
      return { taskId: request.taskId, status: 'not-running' };
    }

    this.clearRetryTimer(request.taskId);
    const status = this.enqueue(
      request.taskId,
      request.generation,
    );
    this.kickDrain();
    return { taskId: request.taskId, status };
  }

  /** Aborts and awaits this process's active invocation for one task. */
  async cancelTask(
    taskId: string,
    reason: string,
  ): Promise<AgentTaskCancellationResult> {
    const normalizedReason = requireCancellationReason(reason);

    const removedPending = this.pending.delete(taskId);
    const removedRetry = this.clearRetryTimer(taskId);
    const active = this.active.get(taskId);
    if (!active) {
      return {
        taskId,
        disposition: removedPending || removedRetry ? 'cancelled' : 'not-active',
      };
    }

    active.suppressRetry = true;
    active.controller.abort(normalizedReason);
    await active.promise;
    return {
      taskId,
      disposition: 'cancelled',
      invocationId: active.invocation.invocationId,
    };
  }

  /** Stops admission, cancels active work by default, and awaits settlement. */
  async stop(options: { cancelActive?: boolean } = {}): Promise<void> {
    if (this.state === 'stopped') {
      return;
    }
    if (this.state === 'idle') {
      this.state = 'stopped';
      return;
    }
    if (this.state === 'stopping') {
      await Promise.allSettled(
        [
          ...[...this.active.values()].map(({ promise }) => promise),
          this.drainPromise,
          this.pollPromise,
        ].filter((promise) => promise !== undefined),
      );
      return;
    }

    this.state = 'stopping';
    this.clearPollTimer();
    this.pending.clear();
    this.retryTimers.forEach((timer) => clearTimeout(timer));
    this.retryTimers.clear();

    const active = [...this.active.values()];
    if (options.cancelActive !== false) {
      active.forEach((invocation) => {
        invocation.suppressRetry = true;
        invocation.controller.abort('Lucid agent dispatcher stopped.');
      });
    }
    await Promise.allSettled([
      ...active.map(({ promise }) => promise),
      this.drainPromise,
      this.pollPromise,
    ].filter((promise) => promise !== undefined));
    this.state = 'stopped';
  }

  private enqueue(
    taskId: string,
    runRequestGeneration: number | undefined,
  ): 'queued' | 'coalesced' {
    const activeGeneration = this.active.get(taskId)
      ?.invocation.runRequestGeneration;
    const pendingGeneration = this.pending.get(taskId)
      ?.runRequestGeneration;
    const latestGeneration = latestRunRequestGeneration(
      pendingGeneration,
      runRequestGeneration,
    );
    const alreadyRepresented = generationIncludes(
      activeGeneration,
      runRequestGeneration,
    ) || generationIncludes(pendingGeneration, runRequestGeneration);

    if (!alreadyRepresented || (!this.active.has(taskId) && !this.pending.has(taskId))) {
      this.pending.set(taskId, { runRequestGeneration: latestGeneration });
    }
    return alreadyRepresented ? 'coalesced' : 'queued';
  }

  private kickDrain(): void {
    if (
      this.state !== 'running'
      || this.admissionPaused
      || this.drainPromise
    ) {
      return;
    }
    const drainPromise = this.drainPending()
      .then((disposition) => {
        this.drainPromise = undefined;
        if (
          disposition !== 'paused'
          && disposition !== 'stopped'
          && this.state === 'running'
          && this.pending.size > 0
          && this.semaphore.getValue() > 0
        ) {
          this.kickDrain();
        }
      });
    this.drainPromise = drainPromise;
  }

  private async drainPending(): Promise<DrainDisposition> {
    while (
      this.state === 'running'
      && !this.admissionPaused
      && this.pending.size > 0
    ) {
      if (this.semaphore.getValue() <= 0) {
        return 'saturated';
      }
      const globallyEnabled = await this.readGlobalGate();
      if (this.state !== 'running' || this.admissionPaused) {
        return 'stopped';
      }
      if (!globallyEnabled) {
        return 'paused';
      }
      const entry = this.pending.entries().next().value as
        | [string, PendingInvocation]
        | undefined;
      if (!entry) {
        return 'drained';
      }
      const [taskId, pending] = entry;
      this.pending.delete(taskId);
      try {
        this.startInvocation(taskId, pending.runRequestGeneration);
      } catch (error) {
        this.reportError({ phase: 'invoke', error, taskId });
        this.scheduleRetry(
          taskId,
          pending.runRequestGeneration,
          this.contentionRetryMs,
        );
      }
    }
    return this.state === 'running' ? 'drained' : 'stopped';
  }

  private startInvocation(
    taskId: string,
    runRequestGeneration: number | undefined,
  ): void {
    const controller = new AbortController();
    const invocation: AgentTaskInvocation = {
      taskId,
      invocationId: this.options.createInvocationId?.(
        taskId,
        runRequestGeneration,
      ) ?? `lucid-agent:${randomUUID()}`,
      runRequestGeneration,
      signal: controller.signal,
    };
    const active: ActiveInvocation = {
      invocation,
      controller,
      promise: Promise.resolve(),
      suppressRetry: false,
    };
    const timeout = setTimeout(() => {
      controller.abort(
        `Lucid agent invocation exceeded ${this.options.invocationTimeoutMs}ms.`,
      );
    }, this.options.invocationTimeoutMs);
    timeout.unref();
    active.promise = this.semaphore.runExclusive(
      () => this.invoke(active),
    );
    this.active.set(taskId, active);
    void active.promise.finally(() => {
      clearTimeout(timeout);
      if (this.active.get(taskId) === active) {
        this.active.delete(taskId);
      }
      this.kickDrain();
    });
  }

  private async invoke(active: ActiveInvocation): Promise<void> {
    try {
      const result = await this.options.target.invoke(active.invocation);
      const decision = resolveAgentTaskDispatchDecision(
        result.status,
        this.contentionRetryMs,
      );
      this.reportOutcome({
        taskId: active.invocation.taskId,
        invocationId: active.invocation.invocationId,
        runRequestGeneration: active.invocation.runRequestGeneration,
        result,
        decision,
      });
      if (
        decision.kind === 'retry-transiently'
        && !active.suppressRetry
      ) {
        this.scheduleRetry(
          active.invocation.taskId,
          active.invocation.runRequestGeneration,
          decision.delayMs,
        );
      }
    } catch (error) {
      this.reportError({
        phase: 'invoke',
        error,
        taskId: active.invocation.taskId,
        invocationId: active.invocation.invocationId,
      });
      if (!active.suppressRetry) {
        this.scheduleRetry(
          active.invocation.taskId,
          active.invocation.runRequestGeneration,
          this.contentionRetryMs,
        );
      }
    }
  }

  private scheduleRetry(
    taskId: string,
    runRequestGeneration: number | undefined,
    delayMs: number,
  ): void {
    if (
      this.state !== 'running'
      || this.admissionPaused
      || this.pending.has(taskId)
      || this.retryTimers.has(taskId)
    ) {
      return;
    }
    const timer = setTimeout(() => {
      this.retryTimers.delete(taskId);
      if (this.state !== 'running' || this.admissionPaused) {
        return;
      }
      this.enqueue(taskId, runRequestGeneration);
      this.kickDrain();
    }, delayMs);
    timer.unref();
    this.retryTimers.set(taskId, timer);
  }

  private schedulePoll(delayMs: number): void {
    if (this.state !== 'running' || this.admissionPaused) {
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined;
      const pollPromise = this.poll();
      this.pollPromise = pollPromise;
      void pollPromise.finally(() => {
        if (this.pollPromise === pollPromise) {
          this.pollPromise = undefined;
        }
      });
    }, delayMs);
    this.pollTimer.unref();
  }

  private async poll(): Promise<void> {
    try {
      if (!this.admissionPaused && await this.readGlobalGate()) {
        const now = this.options.now?.() ?? new Date();
        const tasks = await this.options.store.listTasks();
        if (this.state !== 'running' || this.admissionPaused) {
          return;
        }
        tasks
          .filter((task) => (
            this.isManagedTask(task.id)
            && HeartbeatTaskExecutionEligibilityPolicy.isDue(task, now)
          ))
          .forEach((task) => {
            this.enqueue(
              task.id,
              task.state?.runRequest?.generation,
            );
          });
        this.kickDrain();
      }
    } catch (error) {
      this.reportError({ phase: 'poll', error });
    } finally {
      this.schedulePoll(this.options.pollIntervalMs);
    }
  }

  private async readGlobalGate(): Promise<boolean> {
    try {
      return await this.options.isGloballyEnabled();
    } catch (error) {
      this.reportError({ phase: 'global-gate', error });
      return false;
    }
  }

  private clearRetryTimer(taskId: string): boolean {
    const timer = this.retryTimers.get(taskId);
    if (!timer) {
      return false;
    }
    clearTimeout(timer);
    this.retryTimers.delete(taskId);
    return true;
  }

  private clearPollTimer(): void {
    if (!this.pollTimer) {
      return;
    }
    clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
  }

  private isManagedTask(taskId: string): boolean {
    return taskId.startsWith(this.options.taskIdPrefix);
  }

  private reportOutcome(outcome: AgentTaskDispatchOutcome): void {
    try {
      this.options.onOutcome?.(outcome);
    } catch (error) {
      this.reportError({
        phase: 'invoke',
        error,
        taskId: outcome.taskId,
        invocationId: outcome.invocationId,
      });
    }
  }

  private reportError(error: AgentTaskDispatchError): void {
    try {
      this.options.onError?.(error);
    } catch {
      // Observability callbacks cannot invalidate durable dispatch state.
    }
  }

  private get contentionRetryMs(): number {
    return this.options.contentionRetryMs ?? DEFAULT_CONTENTION_RETRY_MS;
  }
}

/**
 * Queue-style retry policy for one Heddle targeted outcome.
 *
 * Heddle has already persisted retry/failure/cancellation schedules. Retrying
 * those immediately would bypass durable timing. Only `busy` and `claim-lost`
 * are transient delivery contention and receive a short host retry.
 */
export function resolveAgentTaskDispatchDecision(
  status: RunHeartbeatTaskResult['status'],
  contentionRetryMs: number,
): AgentTaskDispatchDecision {
  if (status === 'busy' || status === 'claim-lost') {
    return { kind: 'retry-transiently', delayMs: contentionRetryMs };
  }
  if (
    status === 'retry'
    || status === 'failed'
    || status === 'not-due'
    || status === 'cancelled'
  ) {
    return { kind: 'wait-for-durable-schedule' };
  }
  return { kind: 'complete-delivery' };
}

function latestRunRequestGeneration(
  current: number | undefined,
  candidate: number | undefined,
): number | undefined {
  if (current === undefined) {
    return candidate;
  }
  if (candidate === undefined) {
    return current;
  }
  return Math.max(current, candidate);
}

function generationIncludes(
  current: number | undefined,
  candidate: number | undefined,
): boolean {
  return candidate !== undefined
    && current !== undefined
    && current >= candidate;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

function requireCancellationReason(reason: string): string {
  const normalized = reason.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    throw new Error('Agent task cancellation reason cannot be empty.');
  }
  return normalized;
}

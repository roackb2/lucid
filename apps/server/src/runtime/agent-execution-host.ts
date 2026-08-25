import { randomUUID } from 'node:crypto';
import {
  HeartbeatSchedulerService,
  type CancelHeartbeatTaskOptions,
  type HeartbeatSchedulerHandle,
  type HeartbeatTargetedTaskStore,
  type HeartbeatTask,
  type HeartbeatTaskAdministrationService,
  type HeartbeatTaskCancellationResult,
  type HeartbeatTaskHandler,
  type HeartbeatTaskRunRequestSignal,
  type StartHeartbeatSchedulerOptions,
  type StopHeartbeatSchedulerOptions,
} from '@heddleagent/runtime/advanced';
import {
  InProcessAgentTaskDispatcher,
  type InProcessAgentTaskDispatcherOptions,
} from './in-process-agent-task-dispatcher.js';
import type {
  AgentTaskInvocationTarget,
} from './agent-task-invocation.js';

export type AgentHeartbeatTaskAuthority =
  HeartbeatTargetedTaskStore
  & HeartbeatTaskAdministrationService;

export type StartAgentExecutionHostInput = {
  handler: HeartbeatTaskHandler;
  globallyEnabled: boolean;
};

/**
 * Lucid-owned dispatch lifecycle over a Heddle-owned task authority.
 *
 * Implementations may use one long-lived scheduler or route one bounded task
 * invocation at a time. Neither form may reimplement Heddle task policy.
 */
export interface AgentExecutionHost {
  start(input: StartAgentExecutionHostInput): void;
  notify(request: HeartbeatTaskRunRequestSignal): void;
  cancelTask(
    taskId: string,
    options: CancelHeartbeatTaskOptions,
  ): Promise<HeartbeatTaskCancellationResult>;
  pause(options: CancelHeartbeatTaskOptions): Promise<void>;
  resume(): void;
  stop(options?: StopHeartbeatSchedulerOptions): Promise<void>;
}

export type LongLivedAgentExecutionHostOptions = Omit<
  StartHeartbeatSchedulerOptions,
  'handler' | 'runner' | 'store'
> & {
  authority: AgentHeartbeatTaskAuthority;
};

/** Zero-setup local host backed by Heddle's supported scheduler loop. */
export class LongLivedAgentExecutionHost
implements AgentExecutionHost {
  private handler?: HeartbeatTaskHandler;
  private scheduler?: HeartbeatSchedulerHandle;
  private started = false;
  private paused = false;
  private stopped = false;

  constructor(
    private readonly options: LongLivedAgentExecutionHostOptions,
  ) {}

  start(input: StartAgentExecutionHostInput): void {
    if (this.stopped) {
      throw new Error('A stopped agent execution host cannot restart.');
    }
    if (this.started) {
      return;
    }

    this.started = true;
    this.handler = input.handler;
    this.paused = !input.globallyEnabled;
    if (!this.paused) {
      this.startScheduler();
    }
  }

  notify(_request: HeartbeatTaskRunRequestSignal): void {
    if (this.started && !this.paused && !this.stopped && !this.scheduler) {
      this.startScheduler();
    }
  }

  async cancelTask(
    taskId: string,
    options: CancelHeartbeatTaskOptions,
  ): Promise<HeartbeatTaskCancellationResult> {
    const reason = normalizeCancellationReason(options.reason);
    if (this.scheduler) {
      return await this.scheduler.cancelTask(taskId, { reason });
    }
    return await classifyInactiveCancellation(
      this.options.authority,
      taskId,
      reason,
    );
  }

  async pause(options: CancelHeartbeatTaskOptions): Promise<void> {
    normalizeCancellationReason(options.reason);
    this.paused = true;
    await this.stopScheduler({ cancelRunning: true });
  }

  resume(): void {
    if (!this.started || this.stopped || !this.paused) {
      return;
    }
    this.paused = false;
    this.startScheduler();
  }

  async stop(options: StopHeartbeatSchedulerOptions = {}): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.paused = true;
    await this.stopScheduler(options);
  }

  private startScheduler(): void {
    if (this.scheduler || !this.handler || this.paused || this.stopped) {
      return;
    }

    const {
      authority,
      onError,
      ...schedulerOptions
    } = this.options;
    let handle!: HeartbeatSchedulerHandle;
    handle = HeartbeatSchedulerService.start({
      ...schedulerOptions,
      store: authority,
      handler: this.handler,
      onError: (error) => {
        if (this.scheduler === handle) {
          this.scheduler = undefined;
        }
        onError?.(error);
      },
    });
    this.scheduler = handle;
  }

  private async stopScheduler(
    options: StopHeartbeatSchedulerOptions,
  ): Promise<void> {
    const scheduler = this.scheduler;
    if (!scheduler) {
      return;
    }
    try {
      await scheduler.stop(options);
    } finally {
      if (this.scheduler === scheduler) {
        this.scheduler = undefined;
      }
    }
  }
}

type TargetedDispatcherOptions = Omit<
  InProcessAgentTaskDispatcherOptions,
  'store' | 'target'
>;

export type TargetedAgentExecutionHostOptions =
  TargetedDispatcherOptions & {
    authority: AgentHeartbeatTaskAuthority;
    createTarget: (
      handler: HeartbeatTaskHandler,
    ) => AgentTaskInvocationTarget;
    /** Must be shorter than the store lease so expired ownership is revisited. */
    recoveryIntervalMs: number;
    recoveryOwnerId?: string;
    onRecoveryError?: (error: unknown) => void;
  };

/**
 * Request-routed in-process execution host for bounded targeted-task delivery.
 *
 * The local dispatcher remains responsible for bounded delivery only. Heddle
 * performs direct lookup, due claiming, fencing, execution, and settlement.
 */
export class TargetedAgentExecutionHost
implements AgentExecutionHost {
  private dispatcher?: InProcessAgentTaskDispatcher;
  private unsubscribe?: () => void;
  private recoveryTimer?: NodeJS.Timeout;
  private recoveryPromise?: Promise<void>;
  private started = false;
  private paused = false;
  private stopped = false;
  private readonly recoveryOwnerId: string;

  constructor(
    private readonly options: TargetedAgentExecutionHostOptions,
  ) {
    assertPositiveInteger(options.recoveryIntervalMs, 'recoveryIntervalMs');
    this.recoveryOwnerId = options.recoveryOwnerId
      ?? `lucid-targeted-recovery:${randomUUID()}`;
  }

  start(input: StartAgentExecutionHostInput): void {
    if (this.stopped) {
      throw new Error('A stopped agent execution host cannot restart.');
    }
    if (this.started) {
      return;
    }

    const {
      authority,
      createTarget,
      recoveryIntervalMs: _recoveryIntervalMs,
      recoveryOwnerId: _recoveryOwnerId,
      onRecoveryError: _onRecoveryError,
      ...dispatcherOptions
    } = this.options;
    this.started = true;
    this.paused = !input.globallyEnabled;
    this.dispatcher = new InProcessAgentTaskDispatcher({
      ...dispatcherOptions,
      store: authority,
      target: createTarget(input.handler),
    });
    if (this.paused) {
      void this.dispatcher.pause('Lucid global dispatch is paused.');
    }
    this.dispatcher.start();
    this.unsubscribe = authority.subscribeToRunRequests?.(
      (request) => this.notify(request),
    );
    if (!this.paused) {
      this.scheduleRecovery(0);
    }
  }

  notify(request: HeartbeatTaskRunRequestSignal): void {
    this.dispatcher?.notify(request);
  }

  async cancelTask(
    taskId: string,
    options: CancelHeartbeatTaskOptions,
  ): Promise<HeartbeatTaskCancellationResult> {
    const reason = normalizeCancellationReason(options.reason);
    const localResult = await this.dispatcher?.cancelTask(taskId, reason);
    if (localResult?.disposition === 'cancelled') {
      return {
        taskId,
        disposition: 'cancelled',
        reason,
        executionId: localResult.invocationId,
      };
    }
    return await classifyInactiveCancellation(
      this.options.authority,
      taskId,
      reason,
    );
  }

  async pause(options: CancelHeartbeatTaskOptions): Promise<void> {
    const reason = normalizeCancellationReason(options.reason);
    this.paused = true;
    this.clearRecoveryTimer();
    await this.dispatcher?.pause(reason);
    await this.recoveryPromise;
  }

  resume(): void {
    if (!this.started || this.stopped || !this.paused) {
      return;
    }
    this.paused = false;
    this.dispatcher?.resume();
    this.scheduleRecovery(0);
  }

  async stop(options: StopHeartbeatSchedulerOptions = {}): Promise<void> {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    this.paused = true;
    this.clearRecoveryTimer();
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.dispatcher?.stop({
      cancelActive: options.cancelRunning !== false,
    });
    await this.recoveryPromise;
  }

  private scheduleRecovery(delayMs: number): void {
    if (this.paused || this.stopped || this.recoveryTimer) {
      return;
    }
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = undefined;
      const recoveryPromise = this.recoverExpiredExecutions();
      this.recoveryPromise = recoveryPromise;
      void recoveryPromise.finally(() => {
        if (this.recoveryPromise === recoveryPromise) {
          this.recoveryPromise = undefined;
        }
      });
    }, delayMs);
    this.recoveryTimer.unref();
  }

  private async recoverExpiredExecutions(): Promise<void> {
    try {
      await this.options.authority.recoverInterruptedTasks({
        ownerId: this.recoveryOwnerId,
        recoveredAt: new Date(),
        reason: 'host-restart',
      });
      if (!this.paused && !this.stopped) {
        this.dispatcher?.scanNow();
      }
    } catch (error) {
      try {
        this.options.onRecoveryError?.(error);
      } catch {
        // Observability callbacks cannot invalidate durable recovery state.
      }
    } finally {
      this.scheduleRecovery(this.options.recoveryIntervalMs);
    }
  }

  private clearRecoveryTimer(): void {
    if (!this.recoveryTimer) {
      return;
    }
    clearTimeout(this.recoveryTimer);
    this.recoveryTimer = undefined;
  }
}

async function classifyInactiveCancellation(
  authority: HeartbeatTargetedTaskStore,
  taskId: string,
  reason: string,
): Promise<HeartbeatTaskCancellationResult> {
  const task = await authority.loadTask(taskId);
  return {
    taskId,
    disposition: inactiveCancellationDisposition(task),
    reason,
  };
}

function inactiveCancellationDisposition(
  task: HeartbeatTask | undefined,
): HeartbeatTaskCancellationResult['disposition'] {
  if (!task) {
    return 'not-found';
  }
  if (task.state?.status === 'running') {
    return 'not-owned';
  }
  if (task.state?.status === 'blocked') {
    return 'blocked';
  }
  if (task.state?.status === 'complete') {
    return 'completed';
  }
  if (!task.enabled) {
    return 'disabled';
  }
  return 'not-running';
}

function normalizeCancellationReason(reason: string): string {
  const normalized = reason.trim().replace(/\s+/g, ' ');
  if (!normalized) {
    throw new Error('Agent task cancellation reason cannot be empty.');
  }
  return normalized;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
}

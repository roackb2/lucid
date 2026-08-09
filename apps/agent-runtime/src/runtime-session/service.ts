import type {
  AgentTurnExecutionHandle,
  AgentTurnExecutor,
} from './executor.js';
import type {
  RuntimeInvocationHandle,
  RuntimeSessionConfig,
  RuntimeTurnRequest,
} from './types.js';
import {
  RuntimeSessionStatusService,
  type RuntimeSessionStatusSnapshot,
} from './status.js';
import {
  RuntimeScopeBindingService,
  type BoundRuntimeScope,
} from './scope-binding.js';

export class RuntimeBusyError extends Error {
  readonly name = 'RuntimeBusyError';
}

export class RuntimeDuplicateInvocationError extends Error {
  readonly name = 'RuntimeDuplicateInvocationError';
}

export class RuntimeDeadlineError extends Error {
  readonly name = 'RuntimeDeadlineError';
}

const RECENT_INVOCATION_LIMIT = 128;

type ActiveInvocation = {
  invocationId: string;
  run: AgentTurnExecutionHandle;
  controller: AbortController;
  deadlineTimer?: ReturnType<typeof setTimeout>;
  removeCallerAbortListener: () => void;
};

type StartingInvocation = {
  controller: AbortController;
  promise: Promise<AgentTurnExecutionHandle>;
};

/** Coordinates one process-bound Runtime session without owning product data. */
export class RuntimeSessionService {
  private active?: ActiveInvocation;
  private starting?: StartingInvocation;
  private readonly recentCompletedInvocationIds = new Set<string>();
  private readonly recentCompletedInvocationOrder: string[] = [];

  constructor(
    private readonly options: {
      config: RuntimeSessionConfig;
      executor: AgentTurnExecutor;
      binding?: RuntimeScopeBindingService;
      status?: RuntimeSessionStatusService;
      now?: () => Date;
    },
  ) {}

  readStatus(): RuntimeSessionStatusSnapshot {
    return this.statusService().read();
  }

  async start(input: {
    runtimeSessionId: string;
    invocation: RuntimeTurnRequest;
    modelApiKey: string;
    callerSignal: AbortSignal;
  }): Promise<RuntimeInvocationHandle> {
    const deadline = this.resolveDeadline(input.invocation.deadlineAt);
    const binding = this.binding().bind({
      runtimeSessionId: input.runtimeSessionId,
      ...input.invocation.scope,
    });

    if (this.active || this.starting) {
      throw new RuntimeBusyError('This runtime session already has an active turn.');
    }
    if (this.recentCompletedInvocationIds.has(input.invocation.invocationId)) {
      throw new RuntimeDuplicateInvocationError(
        'This recent invocation identifier already completed in the current runtime process.',
      );
    }

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(input.callerSignal.reason);
    input.callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    if (input.callerSignal.aborted) {
      abortFromCaller();
    }

    const deadlineDelay = deadline.getTime() - this.now().getTime();
    const deadlineTimer = setTimeout(
      () => controller.abort(new RuntimeDeadlineError('The runtime invocation deadline elapsed.')),
      deadlineDelay,
    );
    deadlineTimer.unref();

    this.statusService().markExecuting();
    let run: AgentTurnExecutionHandle;
    const startPromise = Promise.resolve().then(() => this.options.executor.start({
      scopeKey: binding.scopeKey,
      executionSessionId: binding.executionSessionId,
      prompt: input.invocation.prompt,
      modelApiKey: input.modelApiKey,
      abortSignal: controller.signal,
    }));
    const starting: StartingInvocation = {
      controller,
      promise: startPromise,
    };
    this.starting = starting;
    try {
      run = await startPromise;
    } catch (error) {
      clearTimeout(deadlineTimer);
      input.callerSignal.removeEventListener('abort', abortFromCaller);
      this.statusService().markIdle();
      throw error;
    } finally {
      if (this.starting === starting) {
        this.starting = undefined;
      }
    }

    const active: ActiveInvocation = {
      invocationId: input.invocation.invocationId,
      run,
      controller,
      deadlineTimer,
      removeCallerAbortListener: () =>
        input.callerSignal.removeEventListener('abort', abortFromCaller),
    };
    this.active = active;
    controller.signal.addEventListener('abort', () => run.cancel(), { once: true });
    if (controller.signal.aborted) {
      run.cancel();
    }

    const result = run.result.finally(() => this.settle(active));
    result.catch(() => undefined);

    return {
      runId: run.runId,
      acceptedAt: this.now().toISOString(),
      // The execution signal cancels the agent, but the event subscription stays
      // open long enough to receive Heddle's truthful cancelled terminal.
      events: () => run.events(),
      cancel: () => {
        const wasActive = !controller.signal.aborted;
        controller.abort();
        return wasActive;
      },
      result,
    };
  }

  async shutdown(): Promise<void> {
    const starting = this.starting;
    if (starting) {
      starting.controller.abort(new Error('Runtime is shutting down.'));
      const run = await starting.promise.catch(() => undefined);
      if (run) {
        run.cancel();
        await run.result.catch(() => undefined);
      }
    }

    const active = this.active;
    if (!active) {
      return;
    }
    active.controller.abort(new Error('Runtime is shutting down.'));
    active.run.cancel();
    await active.run.result.catch(() => undefined);
  }

  boundScope(): BoundRuntimeScope | undefined {
    return this.binding().current();
  }

  private binding(): RuntimeScopeBindingService {
    return this.options.binding ??= new RuntimeScopeBindingService();
  }

  private resolveDeadline(deadlineAt?: string): Date {
    const now = this.now();
    const maximum = new Date(now.getTime() + this.options.config.maxInvocationMs);
    if (!deadlineAt) {
      return maximum;
    }

    const requested = new Date(deadlineAt);
    if (requested.getTime() <= now.getTime()) {
      throw new RuntimeDeadlineError('The runtime invocation deadline has already elapsed.');
    }
    return requested.getTime() < maximum.getTime() ? requested : maximum;
  }

  private settle(active: ActiveInvocation): void {
    if (this.active !== active) {
      return;
    }
    if (active.deadlineTimer) {
      clearTimeout(active.deadlineTimer);
    }
    active.removeCallerAbortListener();
    this.active = undefined;
    this.rememberCompletedInvocation(active.invocationId);
    this.statusService().markIdle();
  }

  private rememberCompletedInvocation(invocationId: string): void {
    this.recentCompletedInvocationIds.add(invocationId);
    this.recentCompletedInvocationOrder.push(invocationId);
    if (this.recentCompletedInvocationOrder.length <= RECENT_INVOCATION_LIMIT) {
      return;
    }
    const oldest = this.recentCompletedInvocationOrder.shift();
    if (oldest) {
      this.recentCompletedInvocationIds.delete(oldest);
    }
  }

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private statusService(): RuntimeSessionStatusService {
    return this.options.status ??= new RuntimeSessionStatusService(this.options.now);
  }
}

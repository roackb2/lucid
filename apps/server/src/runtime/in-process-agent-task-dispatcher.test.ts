import type {
  HeartbeatTask,
  HeartbeatTaskRunRequestSignal,
  RunHeartbeatTaskResult,
} from '@roackb2/heddle/advanced';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  InProcessAgentTaskDispatcher,
  resolveAgentTaskDispatchDecision,
} from './in-process-agent-task-dispatcher.js';
import type {
  AgentTaskInvocation,
  AgentTaskInvocationTarget,
} from './agent-task-invocation.js';

describe('in-process agent task dispatcher', () => {
  const dispatchers: InProcessAgentTaskDispatcher[] = [];

  afterEach(async () => {
    await Promise.all(dispatchers.map((dispatcher) => dispatcher.stop()));
    dispatchers.length = 0;
    vi.restoreAllMocks();
  });

  it('uses notification generations for a fast path without concurrent duplicate work', async () => {
    const firstRun = deferred<void>();
    const invocations: AgentTaskInvocation[] = [];
    const target: AgentTaskInvocationTarget = {
      invoke: vi.fn(async (invocation) => {
        invocations.push(invocation);
        if (invocations.length === 1) {
          await firstRun.promise;
        }
        return noWork(invocation.taskId);
      }),
    };
    const dispatcher = createDispatcher({ target });
    dispatcher.start();

    expect(dispatcher.notify(runRequest('lucid-agent-a', 1)).status)
      .toBe('queued');
    await vi.waitFor(() => expect(invocations).toHaveLength(1));
    expect(dispatcher.notify(runRequest('lucid-agent-a', 1)).status)
      .toBe('coalesced');
    expect(dispatcher.notify(runRequest('lucid-agent-a', 2)).status)
      .toBe('queued');
    expect(invocations).toHaveLength(1);

    firstRun.resolve();
    await vi.waitFor(() => expect(invocations).toHaveLength(2));
    expect(invocations.map(({ runRequestGeneration }) => runRequestGeneration))
      .toEqual([1, 2]);
  });

  it('uses the durable global gate and polling as the correctness fallback', async () => {
    let globallyEnabled = false;
    let globalGateReads = 0;
    const task = createDueTask('lucid-agent-polled');
    const store = {
      listTasks: vi.fn(async () => [task]),
    };
    const target: AgentTaskInvocationTarget = {
      invoke: vi.fn(async ({ taskId }) => {
        task.enabled = false;
        return noWork(taskId);
      }),
    };
    const dispatcher = createDispatcher({
      store,
      target,
      pollIntervalMs: 10,
      isGloballyEnabled: async () => {
        globalGateReads += 1;
        return globallyEnabled;
      },
    });
    dispatcher.start();
    dispatcher.notify(runRequest(task.id, 1));

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.listTasks).not.toHaveBeenCalled();
    expect(target.invoke).not.toHaveBeenCalled();
    expect(globalGateReads).toBeLessThan(10);

    globallyEnabled = true;
    await vi.waitFor(() => expect(target.invoke).toHaveBeenCalledTimes(1));
    expect(store.listTasks).toHaveBeenCalled();
  });

  it('bounds independent task concurrency with the shared semaphore', async () => {
    const releases = new Map<string, Deferred<void>>();
    let activeCount = 0;
    let maximumActiveCount = 0;
    const target: AgentTaskInvocationTarget = {
      invoke: vi.fn(async ({ taskId }) => {
        activeCount += 1;
        maximumActiveCount = Math.max(maximumActiveCount, activeCount);
        const release = deferred<void>();
        releases.set(taskId, release);
        await release.promise;
        activeCount -= 1;
        return noWork(taskId);
      }),
    };
    const dispatcher = createDispatcher({
      target,
      maxConcurrentInvocations: 2,
    });
    dispatcher.start();
    ['a', 'b', 'c'].forEach((suffix) => {
      dispatcher.notify(runRequest(`lucid-agent-${suffix}`, 1));
    });

    await vi.waitFor(() => expect(target.invoke).toHaveBeenCalledTimes(2));
    expect(maximumActiveCount).toBe(2);
    releases.get('lucid-agent-a')?.resolve();
    await vi.waitFor(() => expect(target.invoke).toHaveBeenCalledTimes(3));
    expect(maximumActiveCount).toBe(2);
    releases.forEach((release) => release.resolve());
  });

  it('retries ownership contention but respects Heddle durable schedules', async () => {
    const outcomes: RunHeartbeatTaskResult['status'][] = [];
    let attempts = 0;
    const target: AgentTaskInvocationTarget = {
      invoke: vi.fn(async ({ taskId }) => {
        attempts += 1;
        return attempts === 1
          ? { taskId, status: 'busy', failed: false }
          : noWork(taskId);
      }),
    };
    const dispatcher = createDispatcher({
      target,
      contentionRetryMs: 10,
      onOutcome: ({ result }) => outcomes.push(result.status),
    });
    dispatcher.start();
    dispatcher.notify(runRequest('lucid-agent-contention', 1));

    await vi.waitFor(() => expect(target.invoke).toHaveBeenCalledTimes(2));
    expect(outcomes).toEqual(['busy', 'not-found']);
    expect(resolveAgentTaskDispatchDecision('busy', 25)).toEqual({
      kind: 'retry-transiently',
      delayMs: 25,
    });
    expect(resolveAgentTaskDispatchDecision('claim-lost', 25)).toEqual({
      kind: 'retry-transiently',
      delayMs: 25,
    });
    for (const status of [
      'retry',
      'failed',
      'not-due',
      'cancelled',
    ] as const) {
      expect(resolveAgentTaskDispatchDecision(status, 25)).toEqual({
        kind: 'wait-for-durable-schedule',
      });
    }
    for (const status of ['settled', 'not-found', 'disabled'] as const) {
      expect(resolveAgentTaskDispatchDecision(status, 25)).toEqual({
        kind: 'complete-delivery',
      });
    }
  });

  it('aborts and awaits task cancellation and graceful shutdown', async () => {
    const invocations = new Map<string, AgentTaskInvocation>();
    const target: AgentTaskInvocationTarget = {
      invoke: vi.fn(async (invocation) => {
        invocations.set(invocation.taskId, invocation);
        await aborted(invocation.signal);
        return {
          taskId: invocation.taskId,
          status: 'cancelled',
          failed: false,
        };
      }),
    };
    const dispatcher = createDispatcher({
      target,
      maxConcurrentInvocations: 2,
    });
    dispatcher.start();
    dispatcher.notify(runRequest('lucid-agent-cancel', 1));
    await vi.waitFor(() => expect(invocations.size).toBe(1));

    const cancellation = await dispatcher.cancelTask(
      'lucid-agent-cancel',
      'User paused.',
    );
    expect(cancellation).toMatchObject({
      taskId: 'lucid-agent-cancel',
      disposition: 'cancelled',
    });
    expect(invocations.get('lucid-agent-cancel')?.signal.aborted)
      .toBe(true);

    dispatcher.notify(runRequest('lucid-agent-stop-a', 1));
    dispatcher.notify(runRequest('lucid-agent-stop-b', 1));
    await vi.waitFor(() => expect(invocations.size).toBe(3));
    await dispatcher.stop();
    expect(invocations.get('lucid-agent-stop-a')?.signal.aborted)
      .toBe(true);
    expect(invocations.get('lucid-agent-stop-b')?.signal.aborted)
      .toBe(true);
    expect(dispatcher.notify(runRequest('lucid-agent-late', 1)).status)
      .toBe('not-running');
  });

  it('retains notifications while paused and admits them after resume', async () => {
    const target: AgentTaskInvocationTarget = {
      invoke: vi.fn(async ({ taskId }) => noWork(taskId)),
    };
    const dispatcher = createDispatcher({ target });
    dispatcher.start();
    await dispatcher.pause('Operator paused global dispatch.');

    expect(dispatcher.notify(
      runRequest('lucid-agent-paused', 1),
    ).status).toBe('queued');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(target.invoke).not.toHaveBeenCalled();

    dispatcher.resume();
    await vi.waitFor(() => expect(target.invoke).toHaveBeenCalledTimes(1));
  });

  it('cancels an invocation that exceeds its configured wall-clock bound', async () => {
    const target: AgentTaskInvocationTarget = {
      invoke: vi.fn(async (invocation) => {
        await aborted(invocation.signal);
        return {
          taskId: invocation.taskId,
          status: 'cancelled',
          failed: false,
        };
      }),
    };
    const dispatcher = createDispatcher({
      target,
      invocationTimeoutMs: 10,
    });
    dispatcher.start();
    dispatcher.notify(runRequest('lucid-agent-timeout', 1));

    await vi.waitFor(() => expect(target.invoke).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      const invocation = vi.mocked(target.invoke).mock.calls[0]?.[0];
      expect(invocation?.signal.aborted).toBe(true);
      expect(invocation?.signal.reason).toContain('exceeded 10ms');
    });
  });

  function createDispatcher(
    overrides: Partial<
      ConstructorParameters<typeof InProcessAgentTaskDispatcher>[0]
    > = {},
  ): InProcessAgentTaskDispatcher {
    const dispatcher = new InProcessAgentTaskDispatcher({
      store: { listTasks: async () => [] },
      target: { invoke: async ({ taskId }) => noWork(taskId) },
      taskIdPrefix: 'lucid-agent-',
      pollIntervalMs: 1_000,
      maxConcurrentInvocations: 1,
      invocationTimeoutMs: 60_000,
      contentionRetryMs: 25,
      isGloballyEnabled: async () => true,
      ...overrides,
    });
    dispatchers.push(dispatcher);
    return dispatcher;
  }
});

function runRequest(
  taskId: string,
  generation: number,
): HeartbeatTaskRunRequestSignal {
  return {
    taskId,
    generation,
    disposition: generation === 1 ? 'requested' : 'coalesced',
    requestedAt: '2026-08-08T08:00:00.000Z',
    reason: 'test-work-arrived',
  };
}

function createDueTask(id: string): HeartbeatTask {
  return {
    id,
    task: `Process agent work for ${id}.`,
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2000-01-01T00:00:00.000Z',
    },
    state: {
      status: 'waiting',
      runRequest: {
        generation: 1,
        claimedGeneration: 0,
        requestedAt: '2000-01-01T00:00:00.000Z',
      },
    },
  };
}

function noWork(taskId: string): RunHeartbeatTaskResult {
  return { taskId, status: 'not-found', failed: false };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

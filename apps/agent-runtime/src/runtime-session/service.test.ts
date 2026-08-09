import { describe, expect, it } from 'vitest';
import {
  TestTurnExecutor,
  TestTurnHandle,
} from './__tests__/test-turn-executor.test-support.js';
import type { AgentTurnExecutor } from './executor.js';
import type { RuntimeTurnRequest } from './types.js';
import {
  RuntimeBusyError,
  RuntimeDeadlineError,
  RuntimeDuplicateInvocationError,
  RuntimeSessionService,
} from './service.js';
import { RuntimeScopeMismatchError } from './scope-binding.js';

describe('runtime session service', () => {
  it('binds scope, runs once, and tracks busy health through settlement', async () => {
    const executor = new TestTurnExecutor();
    const service = createService(executor);
    const handle = await service.start(startInput());

    expect(service.readStatus().state).toBe('executing');
    expect(executor.inputs[0]).toMatchObject({
      prompt: 'Inspect the workspace.',
      modelApiKey: 'model-key-for-test',
    });
    expect(executor.inputs[0]?.executionSessionId).toMatch(/^runtime-[a-f0-9]{64}$/);

    executor.latest().activity();
    executor.latest().finish();
    await expect(handle.result).resolves.toMatchObject({ outcome: 'done' });
    expect(service.readStatus().state).toBe('idle');
  });

  it('rejects concurrent work and a later cross-scope request', async () => {
    const executor = new TestTurnExecutor();
    const service = createService(executor);
    const first = await service.start(startInput());

    await expect(service.start({
      ...startInput(),
      invocation: invocation('invocation-002'),
    })).rejects.toBeInstanceOf(RuntimeBusyError);
    await expect(service.start({
      ...startInput(),
      invocation: {
        ...invocation('invocation-003'),
        scope: { ...invocation('invocation-003').scope, tenantId: 'company-b' },
      },
    })).rejects.toBeInstanceOf(RuntimeScopeMismatchError);

    executor.latest().finish();
    await first.result;
  });

  it('reserves admission while the Heddle executor is still starting', async () => {
    let release!: (handle: TestTurnHandle) => void;
    const executor: AgentTurnExecutor = {
      start: () => new Promise((resolve) => {
        release = resolve;
      }),
    };
    const service = new RuntimeSessionService({
      config: { maxInvocationMs: 15 * 60_000 },
      executor,
    });
    const firstStart = service.start(startInput());
    await Promise.resolve();

    await expect(service.start({
      ...startInput(),
      invocation: invocation('invocation-002'),
    })).rejects.toBeInstanceOf(RuntimeBusyError);

    const testRun = new TestTurnHandle('test-starting-run');
    release(testRun);
    const first = await firstStart;
    testRun.finish();
    await first.result;
  });

  it('restores healthy admission state when executor startup throws synchronously', async () => {
    const executor: AgentTurnExecutor = {
      start: () => {
        throw new Error('Executor startup failed');
      },
    };
    const service = new RuntimeSessionService({
      config: { maxInvocationMs: 15 * 60_000 },
      executor,
    });

    await expect(service.start(startInput())).rejects.toThrow(/startup failed/);
    expect(service.readStatus().state).toBe('idle');
    await expect(service.shutdown()).resolves.toBeUndefined();
  });

  it('rejects a completed invocation identifier instead of duplicating work', async () => {
    const executor = new TestTurnExecutor();
    const service = createService(executor);
    const first = await service.start(startInput());
    executor.latest().finish();
    await first.result;

    await expect(service.start(startInput())).rejects.toBeInstanceOf(
      RuntimeDuplicateInvocationError,
    );
    expect(executor.handles).toHaveLength(1);
  });

  it('cancels the exact active run when the caller aborts', async () => {
    const executor = new TestTurnExecutor();
    const service = createService(executor);
    const caller = new AbortController();
    const handle = await service.start({ ...startInput(), callerSignal: caller.signal });
    caller.abort();

    await expect(handle.result).rejects.toThrow(/Cancelled by test/);
    expect(executor.latest().cancelCalls).toBe(1);
    expect(service.readStatus().state).toBe('idle');
  });

  it('rejects an expired deadline before binding the process', async () => {
    const executor = new TestTurnExecutor();
    const service = createService(executor);
    await expect(service.start({
      ...startInput(),
      invocation: {
        ...invocation('invocation-expired'),
        deadlineAt: '2026-08-08T23:59:59.000Z',
      },
    })).rejects.toBeInstanceOf(RuntimeDeadlineError);
    expect(service.boundScope()).toBeUndefined();
  });
});

function createService(executor: TestTurnExecutor) {
  return new RuntimeSessionService({
    config: { maxInvocationMs: 15 * 60_000 },
    executor,
    now: () => new Date('2026-08-09T00:00:00.000Z'),
  });
}

function startInput() {
  return {
    runtimeSessionId: 's'.repeat(33),
    invocation: invocation('invocation-001'),
    modelApiKey: 'model-key-for-test',
    callerSignal: new AbortController().signal,
  };
}

function invocation(invocationId: string): RuntimeTurnRequest {
  return {
    invocationId,
    scope: {
      adopterId: 'heddle-customer',
      tenantId: 'company-a',
      userId: 'user-a',
      conversationId: 'conversation-a',
    },
    prompt: 'Inspect the workspace.',
  };
}

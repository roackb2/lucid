import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileHeartbeatTaskService,
  type HeartbeatTask,
} from '@roackb2/heddle/advanced';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { AgentWorker } from './agent-worker.js';

describe('agent worker', () => {
  const stateRoots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    stateRoots.splice(0).forEach((stateRoot) => {
      rmSync(stateRoot, { recursive: true, force: true });
    });
  });

  it('executes only the routed task without scanning or recovering owners', async () => {
    const now = new Date('2026-08-08T08:00:00.000Z');
    const store = createStore();
    const tasks = [createTask('agent-a'), createTask('agent-b')];
    await store.reconcileTasks({ namespace: 'agent-', desired: tasks });
    await Promise.all(tasks.map((task) => store.requestTaskRun(task.id, {
      requestedAt: now,
      reason: 'test-work-arrived',
    })));

    const listTasks = vi.spyOn(store, 'listTasks');
    const recoverInterruptedTasks = vi.spyOn(store, 'recoverInterruptedTasks');
    const handledTaskIds: string[] = [];
    const worker = new AgentWorker({
      store,
      now: () => now,
      handler: async (execution) => {
        handledTaskIds.push(execution.task.id);
        return execution.skip({ summary: 'Deterministic worker test.' });
      },
    });

    const result = await worker.invoke({
      taskId: 'agent-a',
      invocationId: 'invocation-a',
      runRequestGeneration: 1,
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('settled');
    expect(handledTaskIds).toEqual(['agent-a']);
    expect(listTasks).not.toHaveBeenCalled();
    expect(recoverInterruptedTasks).not.toHaveBeenCalled();
    await expect(store.loadTask('agent-b')).resolves.toMatchObject({
      id: 'agent-b',
      state: {
        runRequest: {
          generation: 1,
          claimedGeneration: 0,
        },
      },
    });
  });

  it('honors cancellation before looking up or invoking the task', async () => {
    const store = createStore();
    const loadTask = vi.spyOn(store, 'loadTask');
    const handler = vi.fn();
    const controller = new AbortController();
    controller.abort('test cancellation');
    const worker = new AgentWorker({ store, handler });

    const result = await worker.invoke({
      taskId: 'agent-cancelled',
      invocationId: 'invocation-cancelled',
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      taskId: 'agent-cancelled',
      status: 'cancelled',
      failed: false,
    });
    expect(loadTask).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  function createStore(): FileHeartbeatTaskService {
    const stateRoot = mkdtempSync(join(tmpdir(), 'lucid-targeted-worker-'));
    stateRoots.push(stateRoot);
    return new FileHeartbeatTaskService({ stateRoot });
  }
});

function createTask(id: string): HeartbeatTask {
  return {
    id,
    task: `Process agent work for ${id}.`,
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2099-01-01T00:00:00.000Z',
    },
  };
}

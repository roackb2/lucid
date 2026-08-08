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
import { RepresentativeAgentWorker } from './representative-agent-worker.js';

describe('representative agent worker', () => {
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
    const tasks = [createTask('representative-a'), createTask('representative-b')];
    await store.reconcileTasks({ namespace: 'representative-', desired: tasks });
    await Promise.all(tasks.map((task) => store.requestTaskRun(task.id, {
      requestedAt: now,
      reason: 'test-work-arrived',
    })));

    const listTasks = vi.spyOn(store, 'listTasks');
    const recoverInterruptedTasks = vi.spyOn(store, 'recoverInterruptedTasks');
    const handledTaskIds: string[] = [];
    const worker = new RepresentativeAgentWorker({
      store,
      now: () => now,
      handler: async (execution) => {
        handledTaskIds.push(execution.task.id);
        return execution.skip({ summary: 'Deterministic worker test.' });
      },
    });

    const result = await worker.invoke({
      taskId: 'representative-a',
      invocationId: 'invocation-a',
      runRequestGeneration: 1,
      signal: new AbortController().signal,
    });

    expect(result.status).toBe('settled');
    expect(handledTaskIds).toEqual(['representative-a']);
    expect(listTasks).not.toHaveBeenCalled();
    expect(recoverInterruptedTasks).not.toHaveBeenCalled();
    await expect(store.loadTask('representative-b')).resolves.toMatchObject({
      id: 'representative-b',
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
    const worker = new RepresentativeAgentWorker({ store, handler });

    const result = await worker.invoke({
      taskId: 'representative-cancelled',
      invocationId: 'invocation-cancelled',
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      taskId: 'representative-cancelled',
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
    task: `Process representative work for ${id}.`,
    enabled: true,
    schedule: {
      intervalMs: 60_000,
      nextRunAt: '2099-01-01T00:00:00.000Z',
    },
  };
}

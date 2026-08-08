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
import {
  TargetedRepresentativeAgentExecutionHost,
} from './representative-agent-execution-host.js';
import type {
  RepresentativeTaskInvocation,
} from './representative-task-invocation.js';

describe('targeted representative execution host', () => {
  const roots: string[] = [];
  const hosts: TargetedRepresentativeAgentExecutionHost[] = [];

  afterEach(async () => {
    await Promise.all(hosts.map((host) => (
      host.stop({ cancelRunning: true })
    )));
    roots.forEach((root) => rmSync(root, { force: true, recursive: true }));
    roots.length = 0;
    hosts.length = 0;
    vi.restoreAllMocks();
  });

  it('routes notification fast paths and cancels only locally owned work', async () => {
    const root = mkdtempSync(join(tmpdir(), 'lucid-targeted-host-'));
    roots.push(root);
    const authority = new FileHeartbeatTaskService({ stateRoot: root });
    await authority.createTask({
      id: 'lucid-representative-local',
      task: 'Run one local representative.',
      intervalMs: 60_000,
      defer: true,
    });
    const recoverInterruptedTasks = vi.spyOn(
      authority,
      'recoverInterruptedTasks',
    );

    const invocations: RepresentativeTaskInvocation[] = [];
    const host = new TargetedRepresentativeAgentExecutionHost({
      authority,
      createTarget: () => ({
        invoke: vi.fn(async (invocation) => {
          invocations.push(invocation);
          await aborted(invocation.signal);
          return {
            taskId: invocation.taskId,
            status: 'cancelled',
            failed: false,
          };
        }),
      }),
      taskIdPrefix: 'lucid-representative-',
      pollIntervalMs: 60_000,
      maxConcurrentInvocations: 1,
      invocationTimeoutMs: 60_000,
      recoveryIntervalMs: 60_000,
      isGloballyEnabled: async () => true,
    });
    hosts.push(host);
    host.start({
      globallyEnabled: true,
      handler: async (execution) => execution.skip({ summary: 'Unused.' }),
    });
    await vi.waitFor(() => expect(recoverInterruptedTasks).toHaveBeenCalled());
    await recoverInterruptedTasks.mock.results[0]?.value;

    const request = await authority.requestTaskRun(
      'lucid-representative-local',
      { reason: 'test-notification' },
    );
    host.notify(request);
    await vi.waitFor(() => expect(invocations).toHaveLength(1));

    await expect(host.cancelTask('lucid-representative-local', {
      reason: 'Participant paused.',
    })).resolves.toMatchObject({
      taskId: 'lucid-representative-local',
      disposition: 'cancelled',
      executionId: invocations[0]?.invocationId,
    });
    expect(invocations[0]?.signal.aborted).toBe(true);

    await authority.saveTask(remoteRunningTask());
    await expect(host.cancelTask('remote-running', {
      reason: 'Participant paused.',
    })).resolves.toMatchObject({
      taskId: 'remote-running',
      disposition: 'not-owned',
    });
  });
});

function remoteRunningTask(): HeartbeatTask {
  return {
    id: 'remote-running',
    task: 'Owned by another execution host.',
    enabled: true,
    schedule: { intervalMs: 60_000 },
    state: {
      status: 'running',
      execution: {
        executionId: 'remote-execution',
        ownerId: 'remote-owner',
        claimedAt: '2026-08-08T08:00:00.000Z',
      },
    },
  };
}

async function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

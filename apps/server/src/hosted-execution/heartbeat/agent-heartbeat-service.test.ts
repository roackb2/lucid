import {
  type HostedHeartbeatCoordinatorState,
  type HostedHeartbeatCoordinatorTaskApi,
  type HostedHeartbeatCoordinatorTaskView,
} from '@heddleagent/execution-host-client/coordinator';
import { describe, expect, it, vi } from 'vitest';
import { createLucidLogger } from '../../logger.js';
import { CoordinatorAgentHeartbeatService } from './agent-heartbeat-service.js';

const TASK_ID = 'lucid-representative-agent-a';

describe('coordinator agent heartbeat service', () => {
  it('preserves a user task preference while reconciling product state', async () => {
    const coordinator = coordinatorApi([task({ enabled: false })]);
    const service = new CoordinatorAgentHeartbeatService(
      productStore(),
      coordinator,
      policy(),
      createLucidLogger('silent'),
    );

    await service.initialize();

    expect(coordinator.pause).toHaveBeenCalledOnce();
    expect(coordinator.upsertTask).toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({ enabled: false }),
      undefined,
    );
    expect(coordinator.resume).toHaveBeenCalledOnce();
  });

  it('reports the coordinator gate and task state without a local scheduler', async () => {
    const coordinator = coordinatorApi([
      task({
        enabled: true,
        state: {
          status: 'complete',
          runAt: '2026-08-25T01:00:00.000Z',
          result: {
            kind: 'agent',
            summary: 'Checked the workspace.',
            outcome: 'done',
          },
        },
      }),
    ], 'paused');
    const service = new CoordinatorAgentHeartbeatService(
      productStore(),
      coordinator,
      policy(),
      createLucidLogger('silent'),
    );

    await expect(service.snapshot()).resolves.toMatchObject({
      enabled: true,
      dispatchEnabled: false,
      running: false,
      lastRunAt: '2026-08-25T01:00:00.000Z',
      tasks: [{
        taskId: TASK_ID,
        agentId: 'agent-a',
        status: 'complete',
        lastSummary: 'Checked the workspace.',
      }],
    });
  });
});

function coordinatorApi(
  initialTasks: HostedHeartbeatCoordinatorTaskView[],
  initialState: HostedHeartbeatCoordinatorState = 'running',
): HostedHeartbeatCoordinatorTaskApi & {
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  upsertTask: ReturnType<typeof vi.fn>;
} {
  const tasks = new Map(initialTasks.map((entry) => [entry.id, entry]));
  let state = initialState;
  const pause = vi.fn(async () => {
    state = 'paused';
  });
  const resume = vi.fn(async () => {
    state = 'running';
  });
  const upsertTask = vi.fn(async (taskId, input) => {
    tasks.set(taskId, task({
      enabled: input.enabled ?? true,
      workspaceId: input.workspaceId,
      name: input.name,
      task: input.task,
    }));
  });
  return {
    readState: async () => state,
    listTasks: async () => [...tasks.values()],
    readTask: async (taskId) => ({ task: tasks.get(taskId)!, runs: [] }),
    upsertTask,
    triggerTask: async (taskId) => tasks.get(taskId)!,
    deleteTask: async (taskId) => {
      tasks.delete(taskId);
    },
    pause,
    resume,
    drain: async () => {
      state = 'drained';
    },
  };
}

function task(
  overrides: Partial<HostedHeartbeatCoordinatorTaskView> = {},
): HostedHeartbeatCoordinatorTaskView {
  return {
    id: TASK_ID,
    taskId: TASK_ID,
    workspaceId: 'workspace-v1',
    name: 'Agent A background checks',
    task: 'Find relevant connections.',
    enabled: true,
    continuationMode: 'operator',
    schedule: { intervalMs: 60_000 },
    state: { status: 'idle' },
    ...overrides,
  };
}

function productStore() {
  let workspace = {
    id: 'workspace',
    versionId: 'workspace-v1',
    currentWake: 1,
    backgroundChecksEnabled: true,
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  };
  return {
    readWorkspace: async () => workspace,
    setBackgroundChecksEnabled: async (enabled: boolean) => {
      workspace = { ...workspace, backgroundChecksEnabled: enabled };
      return workspace;
    },
    reset: async ({ backgroundChecksEnabled }: { backgroundChecksEnabled: boolean }) => {
      workspace = { ...workspace, backgroundChecksEnabled };
    },
    listUsers: async () => [{
      id: 'user-a',
      workspaceId: 'workspace',
      kind: 'human' as const,
      status: 'active' as const,
      displayName: 'User A',
      privateContext: '',
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
    }],
    listAgents: async () => [{
      id: 'agent-a',
      workspaceId: 'workspace',
      userId: 'user-a',
      sortOrder: 1,
      name: 'Agent A',
      role: 'representative',
      color: '#000000',
      purpose: 'Find relevant connections.',
      instructions: '',
      status: 'idle' as const,
      runCount: 0,
      mailboxFloorSequence: 0,
      lastSeenSequence: 0,
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
    }],
  };
}

function policy() {
  return {
    intervalMs: 60_000,
    model: 'test-model',
    maxSteps: 4,
  };
}

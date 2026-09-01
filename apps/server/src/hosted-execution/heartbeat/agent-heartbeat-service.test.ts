import {
  type HostedHeartbeatAdmissionPhase,
  type HostedHeartbeatAdmissionTarget,
  type HostedHeartbeatAdmissionView,
  type HostedHeartbeatCoordinatorState,
  type HostedHeartbeatCoordinatorTaskApi,
  type HostedHeartbeatCoordinatorTaskView,
} from '@heddleagent/execution-host-client/coordinator';
import { describe, expect, it, vi } from 'vitest';
import { createLucidLogger } from '../../logger.js';
import {
  LUCID_BACKGROUND_WORK_GROUP_ID,
} from '../../lucid/agent/heartbeat-task-identity.js';
import { CoordinatorAgentHeartbeatService } from './agent-heartbeat-service.js';

const TASK_ID = 'lucid-representative-agent-a';
const BACKGROUND_ADMISSION_TARGET = {
  kind: 'group',
  groupId: LUCID_BACKGROUND_WORK_GROUP_ID,
} as const satisfies HostedHeartbeatAdmissionTarget;

describe('coordinator agent heartbeat service', () => {
  it('preserves a user task preference while reconciling product state', async () => {
    const coordinator = coordinatorApi([task({ enabled: false })]);
    const service = new CoordinatorAgentHeartbeatService(
      productStore(),
      coordinator,
      immediateMutationLock,
      policy(),
      createLucidLogger('silent'),
    );

    await service.initialize();

    expect(coordinator.pause).toHaveBeenCalledOnce();
    expect(coordinator.upsertTask).toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({
        admissionGroupId: LUCID_BACKGROUND_WORK_GROUP_ID,
        enabled: false,
      }),
      expect.any(AbortSignal),
    );
    expect(coordinator.resume).toHaveBeenCalledOnce();
    expect(coordinator.resumeAdmission).toHaveBeenCalledWith(
      BACKGROUND_ADMISSION_TARGET,
      expect.any(AbortSignal),
    );
    const controlSignals = [
      coordinator.listTasks.mock.calls[0]?.[0],
      coordinator.pause.mock.calls[0]?.[0],
      coordinator.upsertTask.mock.calls[0]?.[2],
      coordinator.resume.mock.calls[0]?.[0],
      coordinator.resumeAdmission.mock.calls[0]?.[1],
    ];
    expect(controlSignals[0]).toBeInstanceOf(AbortSignal);
    expect(new Set(controlSignals)).toHaveLength(1);
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
      immediateMutationLock,
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

  it('reports dispatch paused while the Lucid group is still preparing', async () => {
    const coordinator = coordinatorApi(
      [task()],
      'running',
      'preparing',
    );
    const service = new CoordinatorAgentHeartbeatService(
      productStore(),
      coordinator,
      immediateMutationLock,
      policy(),
      createLucidLogger('silent'),
    );

    await expect(service.snapshot()).resolves.toMatchObject({
      enabled: true,
      dispatchEnabled: false,
    });
  });

  it('keeps the provider namespace ready when Lucid background work is paused', async () => {
    const coordinator = coordinatorApi([task()]);
    const service = new CoordinatorAgentHeartbeatService(
      productStore(false),
      coordinator,
      immediateMutationLock,
      policy(),
      createLucidLogger('silent'),
    );

    await service.initialize();

    expect(coordinator.pauseAdmission).toHaveBeenCalledWith(
      BACKGROUND_ADMISSION_TARGET,
      expect.any(AbortSignal),
    );
    expect(coordinator.pauseAdmission.mock.invocationCallOrder[0])
      .toBeLessThan(coordinator.pause.mock.invocationCallOrder[0]!);
    expect(coordinator.resume).toHaveBeenCalledOnce();
    expect(coordinator.resumeAdmission).not.toHaveBeenCalled();
  });

  it('compensates the Lucid product gate when group preparation blocks', async () => {
    const store = productStore(false);
    const coordinator = coordinatorApi([task()], 'running', 'closed');
    coordinator.resumeAdmission.mockResolvedValueOnce(admissionView('blocked'));
    const service = new CoordinatorAgentHeartbeatService(
      store,
      coordinator,
      immediateMutationLock,
      policy(),
      createLucidLogger('silent'),
    );

    await expect(service.setGlobalBackgroundChecksEnabled(true))
      .rejects.toThrow('Lucid background admission could not resume: blocked.');

    expect((await store.readWorkspace()).backgroundChecksEnabled).toBe(false);
    expect(coordinator.pauseAdmission).toHaveBeenCalledWith(
      BACKGROUND_ADMISSION_TARGET,
      expect.any(AbortSignal),
    );
  });
});

function coordinatorApi(
  initialTasks: HostedHeartbeatCoordinatorTaskView[],
  initialState: HostedHeartbeatCoordinatorState = 'running',
  initialAdmissionPhase: HostedHeartbeatAdmissionPhase = 'ready',
): HostedHeartbeatCoordinatorTaskApi & {
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  pauseAdmission: ReturnType<typeof vi.fn>;
  resumeAdmission: ReturnType<typeof vi.fn>;
  listTasks: ReturnType<typeof vi.fn>;
  upsertTask: ReturnType<typeof vi.fn>;
} {
  const tasks = new Map(initialTasks.map((entry) => [entry.id, entry]));
  let namespaceState = initialState;
  let groupAdmission = admissionView(initialAdmissionPhase);
  const pause = vi.fn(async () => {
    namespaceState = 'paused';
  });
  const resume = vi.fn(async () => {
    namespaceState = 'running';
  });
  const upsertTask = vi.fn(async (taskId, input) => {
    tasks.set(taskId, task({
      admissionGroupId: input.admissionGroupId ?? undefined,
      enabled: input.enabled ?? true,
      workspaceId: input.workspaceId,
      name: input.name,
      task: input.task,
    }));
  });
  const pauseAdmission = vi.fn(async (target) => {
    expect(target).toEqual(BACKGROUND_ADMISSION_TARGET);
    groupAdmission = admissionView('closed', groupAdmission.revision + 1);
    return groupAdmission;
  });
  const resumeAdmission = vi.fn(async (target) => {
    expect(target).toEqual(BACKGROUND_ADMISSION_TARGET);
    groupAdmission = admissionView('ready', groupAdmission.revision + 1);
    return groupAdmission;
  });
  const listTasks = vi.fn(async () => [...tasks.values()]);
  return {
    readState: async () => namespaceState,
    listTasks,
    readTask: async (taskId) => ({ task: tasks.get(taskId)!, runs: [] }),
    readTaskActivity: async (taskId) => ({
      schemaVersion: 1,
      taskId,
      execution: null,
    }),
    upsertTask,
    triggerTask: async (taskId) => tasks.get(taskId)!,
    deleteTask: async (taskId) => {
      tasks.delete(taskId);
    },
    readAdmission: async (target) => {
      expect(target).toEqual(BACKGROUND_ADMISSION_TARGET);
      return groupAdmission;
    },
    pauseAdmission,
    resumeAdmission,
    pause,
    resume,
    drain: async () => {
      namespaceState = 'drained';
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
    admissionGroupId: LUCID_BACKGROUND_WORK_GROUP_ID,
    name: 'Agent A background checks',
    task: 'Find relevant connections.',
    enabled: true,
    continuationMode: 'operator',
    schedule: { intervalMs: 60_000 },
    state: { status: 'idle' },
    ...overrides,
  };
}

function productStore(backgroundChecksEnabled = true) {
  let workspace = {
    id: 'workspace',
    versionId: 'workspace-v1',
    currentWake: 1,
    backgroundChecksEnabled,
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

function admissionView(
  phase: HostedHeartbeatAdmissionPhase,
  revision = 1,
): HostedHeartbeatAdmissionView {
  const timestamp = '2026-08-25T00:00:00.000Z';
  return {
    schemaVersion: 1,
    target: BACKGROUND_ADMISSION_TARGET,
    desiredState: phase === 'closed' ? 'closed' : 'ready',
    phase,
    ...(phase === 'preparing' ? { transitionId: 'transition-1' } : {}),
    revision,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function policy() {
  return {
    intervalMs: 60_000,
    model: 'test-model',
    maxSteps: 4,
    controlTimeoutMs: 5_000,
  };
}

const immediateMutationLock = {
  runExclusive: async <Result>(operation: () => Promise<Result>) => (
    await operation()
  ),
};

import { describe, expect, it, vi } from 'vitest';
import { HostedHeartbeatTaskReconciler } from './coordinator-task-reconciler.js';

describe('HostedHeartbeatTaskReconciler', () => {
  it('replaces stale tasks and resumes only after desired state is durable', async () => {
    const operations: string[] = [];
    const coordinator = {
      pause: vi.fn(async () => { operations.push('pause'); }),
      listTasks: vi.fn(async () => [
        {
          id: 'lucid-representative-agent-a',
          workspaceId: 'workspace-before-reset',
        },
        {
          id: 'lucid-representative-stale',
          workspaceId: 'workspace-v1',
        },
      ]),
      deleteTask: vi.fn(async (taskId: string) => {
        operations.push(`delete:${taskId}`);
      }),
      upsertTask: vi.fn(async (taskId: string) => {
        operations.push(`upsert:${taskId}`);
      }),
      resume: vi.fn(async () => { operations.push('resume'); }),
    };
    const reconciler = new HostedHeartbeatTaskReconciler({
      readWorkspace: async () => ({
        id: 'workspace',
        versionId: 'workspace-v1',
        currentWake: 1,
        backgroundChecksEnabled: true,
        createdAt: '2026-08-23T00:00:00.000Z',
        updatedAt: '2026-08-23T00:00:00.000Z',
      }),
      listUsers: async () => [
        user('user-a', 'active'),
        user('user-b', 'retired'),
      ],
      listAgents: async () => [
        agent('agent-a', 'user-a'),
        agent('agent-b', 'user-b'),
      ],
    }, coordinator, {
      intervalMs: 60_000,
      model: 'test-model',
      maxSteps: 4,
    });

    await expect(reconciler.reconcile()).resolves.toEqual({
      deleted: 2,
      upserted: 1,
      resumed: true,
    });
    expect(coordinator.upsertTask).toHaveBeenCalledWith(
      'lucid-representative-agent-a',
      expect.objectContaining({
        workspaceId: 'workspace-v1',
        enabled: true,
        intervalMs: 60_000,
        model: 'test-model',
        maxSteps: 4,
        systemContext:
          'Before deciding whether anything is worth reporting, call the available read-only Lucid workspace snapshot tool and ground the decision in its result.',
      }),
      undefined,
    );
    expect(coordinator.upsertTask).not.toHaveBeenCalledWith(
      'lucid-representative-agent-b',
      expect.anything(),
      expect.anything(),
    );
    expect(operations[0]).toBe('pause');
    expect(operations).toContain('delete:lucid-representative-agent-a');
    expect(operations.at(-1)).toBe('resume');
  });
});

function user(id: string, status: 'active' | 'retired') {
  return {
    id,
    workspaceId: 'workspace',
    kind: 'human' as const,
    status,
    displayName: id,
    privateContext: '',
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  };
}

function agent(id: string, userId: string) {
  return {
    id,
    workspaceId: 'workspace',
    userId,
    sortOrder: 1,
    name: id,
    role: 'representative',
    color: '#000000',
    purpose: `Purpose for ${id}`,
    instructions: '',
    status: 'idle' as const,
    runCount: 0,
    mailboxFloorSequence: 0,
    lastSeenSequence: 0,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  };
}

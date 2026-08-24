import { describe, expect, it } from 'vitest';
import { readLucidHeartbeatTaskReconciliationInput } from './desired-task-catalog.js';

describe('readLucidHeartbeatTaskReconciliationInput', () => {
  it('projects current Lucid owners into Heddle desired tasks', async () => {
    const input = await readLucidHeartbeatTaskReconciliationInput({
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
    }, {
      intervalMs: 60_000,
      model: 'test-model',
      maxSteps: 4,
    });

    expect(input).toEqual({
      desiredTasks: [{
        taskId: 'lucid-representative-agent-a',
        input: expect.objectContaining({
          workspaceId: 'workspace-v1',
          enabled: true,
          intervalMs: 60_000,
          model: 'test-model',
          maxSteps: 4,
          systemContext:
            'Before deciding whether anything is worth reporting, call the available read-only Lucid workspace snapshot tool and ground the decision in its result.',
        }),
      }],
      resume: true,
    });
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

import { describe, expect, it } from 'vitest';
import {
  LUCID_BACKGROUND_WORK_GROUP_ID,
} from '../../lucid/agent/heartbeat-task-identity.js';
import { readLucidHeartbeatTaskCatalog } from './desired-task-catalog.js';

describe('readLucidHeartbeatTaskCatalog', () => {
  it('projects current Lucid owners into Heddle desired tasks', async () => {
    const input = await readLucidHeartbeatTaskCatalog({
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
      listAgentJobs: async () => [
        job('agent-a', 'agent-a'),
        job('agent-b', 'agent-b'),
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
          admissionGroupId: LUCID_BACKGROUND_WORK_GROUP_ID,
          name: 'agent-a: Interest discovery',
          task: 'Review the current Interest.',
          enabled: true,
          intervalMs: 60_000,
          model: 'test-model',
          maxSteps: 4,
          systemContext: expect.stringContaining(
            'Search Lucid with search_network_posts using a concise query derived from the current Interest',
          ),
        }),
      }],
      backgroundAdmissionReady: true,
    });
    expect(input.desiredTasks[0]!.input.systemContext).toContain(
      'the current Interest, check request, and your own network request are not Finding evidence',
    );
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

function job(id: string, agentId: string) {
  return {
    id,
    workspaceId: 'workspace',
    agentId,
    kind: 'interest-discovery' as const,
    name: 'Interest discovery',
    instructions: 'Review the current Interest.',
    cadenceMs: 60_000,
    enabled: true,
    scheduleMode: 'scheduled' as const,
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z',
  };
}

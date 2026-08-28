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
            'You are processing one Lucid product work claim with a fixed mailbox horizon. First call read_available_messages. For every guidance_saved event, call update_working_note with the revised durable context before communicating. For every interest_saved or check_requested event in that claim, call post_shared_message with the triggering event as reply_to_event_id and include every triggering sequence in source_event_ids. Publish the smallest privacy-preserving request that carries the user’s current constraints. Finish only after the required product actions succeed.',
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

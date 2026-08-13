import { describe, expect, it, vi } from 'vitest';
import type {
  AgentHeartbeatService,
} from '../agent/heartbeat-service.js';
import { UserNetworkService } from './service.js';
import type {
  UserNetworkStore,
  UserWithAgent,
} from './store.js';

describe('user network identity enrollment', () => {
  it('reconciles the new agent and returns product identifiers', async () => {
    const enrolled = userWithAgent();
    const enrollAuthenticatedUser = vi.fn(async () => enrolled);
    const reconcileAgentTasks = vi.fn(async () => undefined);
    const service = new UserNetworkService(
      { enrollAuthenticatedUser } as unknown as UserNetworkStore,
      { reconcileAgentTasks } as unknown as AgentHeartbeatService,
      { model: 'test-model', heddleVersion: 'test-version' },
    );

    await expect(service.enrollAuthenticatedUser({
      issuer: 'https://identity.example.test',
      subject: 'verified-subject',
      displayName: 'Avery',
      privateContext: 'One approved private goal.',
      contextApproved: true,
    })).resolves.toEqual({
      created: true,
      userId: enrolled.user.id,
      agentId: enrolled.agent.id,
      displayName: 'Avery',
      kind: 'human',
    });
    expect(enrollAuthenticatedUser).toHaveBeenCalledOnce();
    expect(reconcileAgentTasks).toHaveBeenCalledOnce();
  });
});

function userWithAgent(): UserWithAgent {
  const now = '2026-08-13T00:00:00.000Z';
  return {
    created: true,
    user: {
      id: 'user_avery',
      workspaceId: 'lucid-workspace',
      kind: 'human',
      status: 'active',
      displayName: 'Avery',
      privateContext: 'One approved private goal.',
      contextConsentAt: now,
      createdAt: now,
      updatedAt: now,
    },
    agent: {
      id: 'agent_avery',
      workspaceId: 'lucid-workspace',
      userId: 'user_avery',
      sortOrder: 2,
      name: 'Avery agent',
      role: 'Personal agent',
      color: '#ffffff',
      purpose: 'Represent Avery in the network.',
      instructions: 'Act for Avery.',
      status: 'idle',
      runCount: 0,
      mailboxFloorSequence: 0,
      lastSeenSequence: 0,
      createdAt: now,
      updatedAt: now,
    },
  };
}

import { describe, expect, it, vi } from 'vitest';
import type {
  RepresentativeAgentHeartbeatService,
} from '../representative/heartbeat-service.js';
import { ParticipantNetworkService } from './service.js';
import type {
  ParticipantNetworkStore,
  ParticipantWithAgent,
} from './store.js';

describe('participant network identity enrollment', () => {
  it('reconciles the new representative and returns product identifiers', async () => {
    const enrolled = participantWithAgent();
    const enrollAuthenticatedParticipant = vi.fn(async () => enrolled);
    const reconcileAgentTasks = vi.fn(async () => undefined);
    const service = new ParticipantNetworkService(
      { enrollAuthenticatedParticipant } as unknown as ParticipantNetworkStore,
      { reconcileAgentTasks } as unknown as RepresentativeAgentHeartbeatService,
      { model: 'test-model', heddleVersion: 'test-version' },
    );

    await expect(service.enrollAuthenticatedParticipant({
      issuer: 'https://identity.example.test',
      subject: 'verified-subject',
      displayName: 'Avery',
      privateContext: 'One approved private goal.',
      contextApproved: true,
    })).resolves.toEqual({
      created: true,
      participantId: enrolled.participant.id,
      representativeAgentId: enrolled.agent.id,
      displayName: 'Avery',
      kind: 'human',
    });
    expect(enrollAuthenticatedParticipant).toHaveBeenCalledOnce();
    expect(reconcileAgentTasks).toHaveBeenCalledOnce();
  });
});

function participantWithAgent(): ParticipantWithAgent {
  const now = '2026-08-13T00:00:00.000Z';
  return {
    created: true,
    participant: {
      id: 'participant_avery',
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
      participantId: 'participant_avery',
      sortOrder: 2,
      name: 'Avery representative',
      role: 'Personal representative',
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

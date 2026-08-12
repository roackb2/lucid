/** Focused PostgreSQL contract for provider identity enrollment. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../persistence/postgres/test-context.js';

describe('participant identity enrollment', () => {
  let database: PostgresDatabase;
  let stores: PostgresTestStores['stores'];

  beforeAll(async () => {
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-participant-identity-test',
      reset: false,
    }));
  });

  beforeEach(async () => {
    await stores.representative.reset({ backgroundChecksEnabled: true });
  });

  afterAll(async () => database.close());

  it('atomically enrolls one human participant for one authenticated subject', async () => {
    const identity = {
      issuer: 'https://identity.example.test',
      subject: 'subject-case-sensitive-A',
    };
    const privateContext = 'A private goal disclosed during first-time enrollment.';

    await expect(stores.network.enrollAuthenticatedParticipant({
      ...identity,
      displayName: 'Avery',
      privateContext,
      contextApproved: false,
    })).rejects.toThrow('knowingly allowed this context');

    const first = await stores.network.enrollAuthenticatedParticipant({
      ...identity,
      displayName: 'Avery',
      privateContext,
      contextApproved: true,
    });
    const retry = await stores.network.enrollAuthenticatedParticipant({
      ...identity,
      displayName: 'A changed profile must not create another principal',
      privateContext: 'A retry payload is not a profile-edit operation.',
      contextApproved: true,
    });

    expect(first).toMatchObject({
      created: true,
      participant: {
        kind: 'human',
        status: 'active',
        displayName: 'Avery',
        privateContext,
        contextConsentAt: expect.any(String),
      },
    });
    expect(first.participant.registrationKey).toBeUndefined();
    expect(retry).toMatchObject({
      created: false,
      participant: { id: first.participant.id, displayName: 'Avery' },
      agent: { id: first.agent.id },
    });
    expect(await stores.network.resolveParticipantIdentity(identity)).toEqual({
      participantId: first.participant.id,
      status: 'active',
    });
    expect(await stores.network.resolveParticipantIdentity({
      ...identity,
      subject: 'subject-case-sensitive-a',
    })).toBeUndefined();

    const diagnostics = await stores.network.readNetworkDiagnostics();
    expect(diagnostics.participants).toHaveLength(2);
    expect(diagnostics.agents).toHaveLength(2);
    expect(JSON.stringify(diagnostics)).not.toContain(identity.issuer);
    expect(JSON.stringify(diagnostics)).not.toContain(identity.subject);
    expect(JSON.stringify(diagnostics)).not.toContain(privateContext);
  });

  it('serializes concurrent enrollment across database pools', async () => {
    const secondary = await createPostgresTestStores({
      applicationName: 'lucid-participant-identity-concurrency-test',
      reset: false,
    });
    try {
      const input = {
        issuer: 'https://identity.example.test',
        subject: 'concurrent-subject',
        displayName: 'Concurrent participant',
        privateContext: 'Create exactly one representative and one join event.',
        contextApproved: true as const,
      };

      const [first, second] = await Promise.all([
        stores.network.enrollAuthenticatedParticipant(input),
        secondary.stores.network.enrollAuthenticatedParticipant(input),
      ]);

      expect(new Set([first.participant.id, second.participant.id]).size).toBe(1);
      expect(new Set([first.agent.id, second.agent.id]).size).toBe(1);
      expect([first.created, second.created].sort()).toEqual([false, true]);
      expect((await stores.network.readNetworkDiagnostics()).events.filter(
        ({ kind, targetParticipantId }) => (
          kind === 'participant_added'
          && targetParticipantId === first.participant.id
        ),
      )).toHaveLength(1);
    } finally {
      await secondary.database.close();
    }
  });

  it('keeps workspace commands and projections scoped to each participant', async () => {
    const participantA = await stores.network.enrollAuthenticatedParticipant({
      issuer: 'https://identity.example.test',
      subject: 'participant-a',
      displayName: 'Participant A',
      privateContext: 'Private context for participant A.',
      contextApproved: true,
    });
    const participantB = await stores.network.enrollAuthenticatedParticipant({
      issuer: 'https://identity.example.test',
      subject: 'participant-b',
      displayName: 'Participant B',
      privateContext: 'Private context for participant B.',
      contextApproved: true,
    });

    await stores.workspace.saveInterest(
      participantA.participant.id,
      'A-only discovery assignment',
    );
    await stores.workspace.saveInterest(
      participantB.participant.id,
      'B-only discovery assignment',
    );

    const [snapshotA, snapshotB] = await Promise.all([
      stores.workspace.readSnapshot(participantA.participant.id),
      stores.workspace.readSnapshot(participantB.participant.id),
    ]);

    expect(snapshotA).toMatchObject({
      user: { id: participantA.participant.id },
      representative: {
        id: participantA.agent.id,
        participantId: participantA.participant.id,
        isUserAgent: true,
      },
      interest: { content: 'A-only discovery assignment' },
    });
    expect(snapshotB).toMatchObject({
      user: { id: participantB.participant.id },
      representative: {
        id: participantB.agent.id,
        participantId: participantB.participant.id,
        isUserAgent: true,
      },
      interest: { content: 'B-only discovery assignment' },
    });
    expect(JSON.stringify(snapshotA)).not.toContain(
      'B-only discovery assignment',
    );
    expect(JSON.stringify(snapshotB)).not.toContain(
      'A-only discovery assignment',
    );
  });
});

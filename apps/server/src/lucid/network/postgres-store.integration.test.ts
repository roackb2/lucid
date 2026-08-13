/** Focused PostgreSQL contract for provider identity enrollment. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../persistence/postgres/test-context.js';

describe('user identity enrollment', () => {
  let database: PostgresDatabase;
  let stores: PostgresTestStores['stores'];

  beforeAll(async () => {
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-user-identity-test',
      reset: false,
    }));
  });

  beforeEach(async () => {
    await stores.agent.reset({ backgroundChecksEnabled: true });
  });

  afterAll(async () => database.close());

  it('atomically enrolls one human user for one authenticated subject', async () => {
    const identity = {
      issuer: 'https://identity.example.test',
      subject: 'subject-case-sensitive-A',
    };
    const privateContext = 'A private goal disclosed during first-time enrollment.';

    await expect(stores.network.enrollAuthenticatedUser({
      ...identity,
      displayName: 'Avery',
      privateContext,
      contextApproved: false,
    })).rejects.toThrow('knowingly allowed this context');

    const first = await stores.network.enrollAuthenticatedUser({
      ...identity,
      displayName: 'Avery',
      privateContext,
      contextApproved: true,
    });
    const retry = await stores.network.enrollAuthenticatedUser({
      ...identity,
      displayName: 'A changed profile must not create another principal',
      privateContext: 'A retry payload is not a profile-edit operation.',
      contextApproved: true,
    });

    expect(first).toMatchObject({
      created: true,
      user: {
        kind: 'human',
        status: 'active',
        displayName: 'Avery',
        privateContext,
        contextConsentAt: expect.any(String),
      },
    });
    expect(first.user.registrationKey).toBeUndefined();
    expect(retry).toMatchObject({
      created: false,
      user: { id: first.user.id, displayName: 'Avery' },
      agent: { id: first.agent.id },
    });
    expect(await stores.network.resolveUserIdentity(identity)).toEqual({
      userId: first.user.id,
      status: 'active',
    });
    expect(await stores.network.resolveUserIdentity({
      ...identity,
      subject: 'subject-case-sensitive-a',
    })).toBeUndefined();

    const diagnostics = await stores.network.readNetworkDiagnostics();
    expect(diagnostics.users).toHaveLength(2);
    expect(diagnostics.agents).toHaveLength(2);
    expect(JSON.stringify(diagnostics)).not.toContain(identity.issuer);
    expect(JSON.stringify(diagnostics)).not.toContain(identity.subject);
    expect(JSON.stringify(diagnostics)).not.toContain(privateContext);
  });

  it('serializes concurrent enrollment across database pools', async () => {
    const secondary = await createPostgresTestStores({
      applicationName: 'lucid-user-identity-concurrency-test',
      reset: false,
    });
    try {
      const input = {
        issuer: 'https://identity.example.test',
        subject: 'concurrent-subject',
        displayName: 'Concurrent user',
        privateContext: 'Create exactly one agent and one join event.',
        contextApproved: true as const,
      };

      const [first, second] = await Promise.all([
        stores.network.enrollAuthenticatedUser(input),
        secondary.stores.network.enrollAuthenticatedUser(input),
      ]);

      expect(new Set([first.user.id, second.user.id]).size).toBe(1);
      expect(new Set([first.agent.id, second.agent.id]).size).toBe(1);
      expect([first.created, second.created].sort()).toEqual([false, true]);
      expect((await stores.network.readNetworkDiagnostics()).events.filter(
        ({ kind, targetUserId }) => (
          kind === 'user_added'
          && targetUserId === first.user.id
        ),
      )).toHaveLength(1);
    } finally {
      await secondary.database.close();
    }
  });

  it('keeps workspace commands and projections scoped to each user', async () => {
    const userA = await stores.network.enrollAuthenticatedUser({
      issuer: 'https://identity.example.test',
      subject: 'user-a',
      displayName: 'User A',
      privateContext: 'Private context for user A.',
      contextApproved: true,
    });
    const userB = await stores.network.enrollAuthenticatedUser({
      issuer: 'https://identity.example.test',
      subject: 'user-b',
      displayName: 'User B',
      privateContext: 'Private context for user B.',
      contextApproved: true,
    });

    await stores.workspace.saveInterest(
      userA.user.id,
      'A-only discovery assignment',
    );
    await stores.workspace.saveInterest(
      userB.user.id,
      'B-only discovery assignment',
    );

    const [snapshotA, snapshotB] = await Promise.all([
      stores.workspace.readSnapshot(userA.user.id),
      stores.workspace.readSnapshot(userB.user.id),
    ]);

    expect(snapshotA).toMatchObject({
      user: { id: userA.user.id },
      agent: {
        id: userA.agent.id,
        userId: userA.user.id,
        isCurrentUserAgent: true,
      },
      interest: { content: 'A-only discovery assignment' },
    });
    expect(snapshotB).toMatchObject({
      user: { id: userB.user.id },
      agent: {
        id: userB.agent.id,
        userId: userB.user.id,
        isCurrentUserAgent: true,
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

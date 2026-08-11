/**
 * Real PostgreSQL contract and contention tests for Lucid persistence.
 *
 * Set LUCID_POSTGRES_TEST_URL to an isolated database. The suite migrates it
 * and truncates only Lucid-owned tables between cases; it never creates or
 * destroys the database itself.
 */
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_USER_ID,
  USER_AGENT_ID,
} from '../lucid/local-participant.js';
import { defineLucidStoreContract } from './postgres-persistence.test-support.js';
import type { PostgresDatabase } from '../infrastructure/postgres/database.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../lucid/persistence/postgres/test-context.js';
import { PostgresRepresentativeWakeStore } from '../lucid/representative/postgres-store.js';

async function createStore(options?: { reset?: boolean }) {
  return await createPostgresTestStores({
    applicationName: 'lucid-postgres-integration-test',
    reset: options?.reset,
  });
}

describe('PostgreSQL persistence integration', () => {
  defineLucidStoreContract({
    name: 'PostgreSQL Lucid adapter contract',
    create: async () => {
      const { database, stores } = await createStore();
      return {
        stores,
        close: async () => database.close(),
      };
    },
  });

  describe('PostgreSQL Lucid adapter concurrency', () => {
    let primaryDatabase: PostgresDatabase | undefined;
    let primary: PostgresTestStores['stores'];
    let secondaryDatabase: PostgresDatabase | undefined;
    let secondary: PostgresTestStores['stores'];

    beforeEach(async () => {
      ({ database: primaryDatabase, stores: primary } =
        await createStore());
      ({ database: secondaryDatabase, stores: secondary } =
        await createStore({ reset: false }));
    });

    afterEach(async () => {
      await Promise.all(
        [primaryDatabase, secondaryDatabase]
          .filter((database): database is PostgresDatabase => Boolean(database))
          .map(async (database) => database.close()),
      );
      primaryDatabase = undefined;
      secondaryDatabase = undefined;
    });

    it('allows only one process to claim the same representative wake', async () => {
      await primary.workspace.saveInterest('Find one durable multi-host wake example.');

      const claims = await Promise.allSettled([
        primary.representative.beginAgentWake(USER_AGENT_ID, 'wake_primary'),
        secondary.representative.beginAgentWake(USER_AGENT_ID, 'wake_secondary'),
      ]);
      const successfulClaims = claims.flatMap((claim) => (
        claim.status === 'fulfilled' && claim.value ? [claim.value] : []
      ));
      const rejectedClaims = claims.filter(
        (claim) => claim.status === 'rejected',
      );

      expect(successfulClaims).toHaveLength(1);
      expect(rejectedClaims).toHaveLength(1);
      expect(String((rejectedClaims[0] as PromiseRejectedResult).reason))
        .toContain('already running');
      expect((await requireAgent(primary.representative, USER_AGENT_ID)).status)
        .toBe('running');
    });

    it('deduplicates simultaneous idempotent event writes across processes', async () => {
      const idempotencyKey = 'integration:concurrent-event';
      const content = 'Both processes are retrying the same durable side effect.';

      const [first, second] = await Promise.all([
        primary.network.saveParticipantInput(
          LOCAL_USER_ID,
          content,
          idempotencyKey,
        ),
        secondary.network.saveParticipantInput(
          LOCAL_USER_ID,
          content,
          idempotencyKey,
        ),
      ]);

      expect(second).toEqual(first);
      expect((await primary.network.readNetworkDiagnostics()).events.filter(
        (event) => event.idempotencyKey === idempotencyKey,
      )).toHaveLength(1);
    });

    it('does not steal an active claim when another API process initializes', async () => {
      await primary.workspace.saveInterest('Keep this wake owned by its active worker.');
      const wake = await primary.representative.beginAgentWake(
        USER_AGENT_ID,
        'wake_owned',
      );

      await secondary.representative.initialize();

      expect(wake).toBeDefined();
      expect((await requireAgent(secondary.representative, USER_AGENT_ID)))
        .toMatchObject({
        status: 'running',
        activeWakeId: wake!.wakeId,
      });
      await expect(secondary.representative.beginAgentWake(
        USER_AGENT_ID,
        'wake_stolen',
      ))
        .rejects.toThrow('already running');
    });

    it('rejects settlement from an earlier attempt after the wake is reclaimed', async () => {
      await primary.workspace.saveInterest('Fence every late writer after a retry.');
      const firstAttempt = await primary.representative.beginAgentWake(
        USER_AGENT_ID,
        'claim_first_attempt',
      );
      await primary.representative.failAgentWake(
        USER_AGENT_ID,
        firstAttempt!.claimToken,
      );

      const retry = await secondary.representative.beginAgentWake(
        USER_AGENT_ID,
        'claim_retry_attempt',
      );

      expect(retry).toMatchObject({
        wakeId: firstAttempt!.wakeId,
        claimToken: 'claim_retry_attempt',
        horizonSequence: firstAttempt!.horizonSequence,
      });
      await expect(primary.representative.completeAgentWake(
        USER_AGENT_ID,
        firstAttempt!.claimToken,
        firstAttempt!.horizonSequence,
      )).rejects.toThrow('no longer owned');
      await expect(primary.representative.failAgentWake(
        USER_AGENT_ID,
        firstAttempt!.claimToken,
      )).rejects.toThrow('no longer owned');
      expect(await requireAgent(secondary.representative, USER_AGENT_ID))
        .toMatchObject({
          status: 'running',
          activeWakeClaimToken: retry!.claimToken,
        });
    });
  });

  describe('PostgreSQL Lucid adapter reconnect durability', () => {
    it('creates a fresh workspace with background dispatch paused', async () => {
      const fresh = await createStore();
      try {
        await fresh.database.orm.execute(
          sql`truncate table lucid.discovery_workspaces restart identity cascade`,
        );
        const representative = new PostgresRepresentativeWakeStore(
          fresh.database,
        );

        await representative.initialize();

        expect((await representative.readWorkspace()).backgroundChecksEnabled)
          .toBe(false);
      } finally {
        await fresh.database.close();
      }
    });

    it('preserves participant state after every connection closes', async () => {
      const first = await createStore();
      const interest = await first.stores.workspace.saveInterest(
        'Remember this assignment across a complete pool restart.',
      );
      await first.database.close();

      const reopened = await createStore({ reset: false });
      try {
        expect(await reopened.stores.workspace.findSavedInterest()).toEqual(
          interest,
        );
      } finally {
        await reopened.database.close();
      }
    });
  });
});

async function requireAgent(
  representative: PostgresTestStores['stores']['representative'],
  agentId: string,
) {
  const agent = (await representative.listAgents()).find(
    ({ id }) => id === agentId,
  );
  if (!agent) {
    throw new Error(`Representative agent not found: ${agentId}`);
  }
  return agent;
}

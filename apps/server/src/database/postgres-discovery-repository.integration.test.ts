/**
 * Real PostgreSQL contract and contention tests for Lucid persistence.
 *
 * Set LUCID_POSTGRES_TEST_URL to an isolated database. The suite migrates it
 * and truncates only Lucid-owned tables between cases; it never creates or
 * destroys the database itself.
 */
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_USER_ID,
  USER_AGENT_ID,
} from '../lucid/local-participant.js';
import { defineDiscoveryRepositoryContract } from '../lucid/discovery-repository.test-support.js';
import { LucidPostgresDatabase } from './postgres-database.js';
import { PostgresDiscoveryRepository } from './postgres-discovery-repository.js';

const TEST_DATABASE_URL = process.env.LUCID_POSTGRES_TEST_URL?.trim();
const MIGRATIONS_ROOT = fileURLToPath(
  new URL('../../drizzle-postgres', import.meta.url),
);

if (!TEST_DATABASE_URL && process.env.LUCID_REQUIRE_POSTGRES_TESTS === '1') {
  throw new Error(
    'LUCID_POSTGRES_TEST_URL is required by the PostgreSQL integration test command.',
  );
}

async function createRepository(options?: { reset?: boolean }) {
  if (!TEST_DATABASE_URL) {
    throw new Error('PostgreSQL integration tests are not configured.');
  }
  const database = new LucidPostgresDatabase({
    url: TEST_DATABASE_URL,
    applicationName: 'lucid-postgres-integration-test',
  });
  await database.migrate(MIGRATIONS_ROOT);
  const repository = new PostgresDiscoveryRepository(database);
  await repository.initialize();
  if (options?.reset ?? true) {
    await repository.reset({ backgroundChecksEnabled: true });
  }
  return { database, repository };
}

if (TEST_DATABASE_URL) {
  defineDiscoveryRepositoryContract({
    name: 'PostgreSQL discovery repository contract',
    create: async () => {
      const { database, repository } = await createRepository();
      return {
        repository,
        close: async () => database.close(),
      };
    },
  });

  describe('PostgreSQL discovery repository concurrency', () => {
    let primaryDatabase: LucidPostgresDatabase | undefined;
    let primary: PostgresDiscoveryRepository;
    let secondaryDatabase: LucidPostgresDatabase | undefined;
    let secondary: PostgresDiscoveryRepository;

    beforeEach(async () => {
      ({ database: primaryDatabase, repository: primary } =
        await createRepository());
      ({ database: secondaryDatabase, repository: secondary } =
        await createRepository({ reset: false }));
    });

    afterEach(async () => {
      await Promise.all(
        [primaryDatabase, secondaryDatabase]
          .filter((database): database is LucidPostgresDatabase => Boolean(database))
          .map(async (database) => database.close()),
      );
      primaryDatabase = undefined;
      secondaryDatabase = undefined;
    });

    it('allows only one process to claim the same representative wake', async () => {
      await primary.saveInterest('Find one durable multi-host wake example.');

      const claims = await Promise.allSettled([
        primary.beginAgentWake(USER_AGENT_ID, 'wake_primary'),
        secondary.beginAgentWake(USER_AGENT_ID, 'wake_secondary'),
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
      expect((await primary.requireAgent(USER_AGENT_ID)).status).toBe('running');
    });

    it('deduplicates simultaneous idempotent event writes across processes', async () => {
      const input = {
        kind: 'participant_input' as const,
        targetAgentId: USER_AGENT_ID,
        targetParticipantId: LOCAL_USER_ID,
        idempotencyKey: 'integration:concurrent-event',
        title: 'One concurrent input',
        content: 'Both processes are retrying the same durable side effect.',
      };

      const [first, second] = await Promise.all([
        primary.appendEvent(input),
        secondary.appendEvent(input),
      ]);

      expect(second).toEqual(first);
      expect((await primary.readNetworkDiagnostics()).events.filter(
        ({ idempotencyKey }) => idempotencyKey === input.idempotencyKey,
      )).toHaveLength(1);
    });

    it('does not steal an active claim when another API process initializes', async () => {
      await primary.saveInterest('Keep this wake owned by its active worker.');
      const wake = await primary.beginAgentWake(USER_AGENT_ID, 'wake_owned');

      await secondary.initialize();

      expect(wake).toBeDefined();
      expect((await secondary.requireAgent(USER_AGENT_ID))).toMatchObject({
        status: 'running',
        activeWakeId: wake!.wakeId,
      });
      await expect(secondary.beginAgentWake(USER_AGENT_ID, 'wake_stolen'))
        .rejects.toThrow('already running');
    });

    it('rejects settlement from an earlier attempt after the wake is reclaimed', async () => {
      await primary.saveInterest('Fence every late writer after a retry.');
      const firstAttempt = await primary.beginAgentWake(
        USER_AGENT_ID,
        'claim_first_attempt',
      );
      await primary.failAgentWake(
        USER_AGENT_ID,
        firstAttempt!.claimToken,
      );

      const retry = await secondary.beginAgentWake(
        USER_AGENT_ID,
        'claim_retry_attempt',
      );

      expect(retry).toMatchObject({
        wakeId: firstAttempt!.wakeId,
        claimToken: 'claim_retry_attempt',
        horizonSequence: firstAttempt!.horizonSequence,
      });
      await expect(primary.completeAgentWake(
        USER_AGENT_ID,
        firstAttempt!.claimToken,
        firstAttempt!.horizonSequence,
      )).rejects.toThrow('no longer owned');
      await expect(primary.failAgentWake(
        USER_AGENT_ID,
        firstAttempt!.claimToken,
      )).rejects.toThrow('no longer owned');
      expect(await secondary.requireAgent(USER_AGENT_ID)).toMatchObject({
        status: 'running',
        activeWakeClaimToken: retry!.claimToken,
      });
    });
  });

  describe('PostgreSQL discovery repository reconnect durability', () => {
    it('preserves participant state after every connection closes', async () => {
      const first = await createRepository();
      const interest = await first.repository.saveInterest(
        'Remember this assignment across a complete pool restart.',
      );
      await first.database.close();

      const reopened = await createRepository({ reset: false });
      try {
        expect(await reopened.repository.findSavedInterest()).toEqual(interest);
      } finally {
        await reopened.database.close();
      }
    });
  });
} else {
  describe.skip('PostgreSQL discovery repository integration', () => {
    it('requires LUCID_POSTGRES_TEST_URL', () => undefined);
  });
}

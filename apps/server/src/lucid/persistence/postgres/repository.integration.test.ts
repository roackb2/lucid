/**
 * Real PostgreSQL contract and contention tests for Lucid persistence.
 *
 * Set LUCID_POSTGRES_TEST_URL to an isolated database. The suite migrates it
 * and truncates only Lucid-owned tables between cases; it never creates or
 * destroys the database itself.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_USER_ID,
  USER_AGENT_ID,
} from '../../local-participant.js';
import { defineLucidRepositoryContract } from './repository-contract.test-support.js';
import type { PostgresDatabase } from '../../../infrastructure/postgres/database.js';
import { PostgresLucidRepository } from './repository.js';
import { createPostgresTestRepository } from './test-context.js';

async function createRepository(options?: { reset?: boolean }) {
  return await createPostgresTestRepository({
    applicationName: 'lucid-postgres-integration-test',
    reset: options?.reset,
  });
}

describe('PostgreSQL persistence integration', () => {
  defineLucidRepositoryContract({
    name: 'PostgreSQL Lucid adapter contract',
    create: async () => {
      const { database, repository } = await createRepository();
      return {
        repository,
        close: async () => database.close(),
      };
    },
  });

  describe('PostgreSQL Lucid adapter concurrency', () => {
    let primaryDatabase: PostgresDatabase | undefined;
    let primary: PostgresLucidRepository;
    let secondaryDatabase: PostgresDatabase | undefined;
    let secondary: PostgresLucidRepository;

    beforeEach(async () => {
      ({ database: primaryDatabase, repository: primary } =
        await createRepository());
      ({ database: secondaryDatabase, repository: secondary } =
        await createRepository({ reset: false }));
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

  describe('PostgreSQL Lucid adapter reconnect durability', () => {
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
});

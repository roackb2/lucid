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
  LOCAL_AGENT_ID,
} from '../lucid/local-user.js';
import { LUCID_WORKSPACE_ID } from '../lucid/workspace/workspace-identity.js';
import { defineLucidStoreContract } from './postgres-persistence.test-support.js';
import type { PostgresDatabase } from '../infrastructure/postgres/database.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../lucid/persistence/postgres/test-context.js';
import { PostgresAgentWakeStore } from '../lucid/agent/postgres-store.js';
import {
  LUCID_BACKGROUND_WORK_GROUP_ID,
} from '../lucid/agent/heartbeat-task-identity.js';
import {
  AgentCommunicationClaimError,
} from '../lucid/agent/communication/store.js';

const PRIMARY_TEST_APPLICATION = 'lucid-postgres-integration-primary';
const SECONDARY_TEST_APPLICATION = 'lucid-postgres-integration-secondary';

async function createStore(options?: {
  reset?: boolean;
  applicationName?: string;
}) {
  return await createPostgresTestStores({
    applicationName:
      options?.applicationName ?? 'lucid-postgres-integration-test',
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
        await createStore({ applicationName: PRIMARY_TEST_APPLICATION }));
      ({ database: secondaryDatabase, stores: secondary } =
        await createStore({
          reset: false,
          applicationName: SECONDARY_TEST_APPLICATION,
        }));
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

    it('allows only one process to claim the same agent wake', async () => {
      await primary.workspace.saveInterest(
        LOCAL_USER_ID,
        'Find one durable multi-host wake example.',
      );

      const claims = await Promise.allSettled([
        primary.agent.beginAgentWake(LOCAL_AGENT_ID, 'wake_primary'),
        secondary.agent.beginAgentWake(LOCAL_AGENT_ID, 'wake_secondary'),
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
      expect((await requireAgent(primary.agent, LOCAL_AGENT_ID)).status)
        .toBe('running');
    });

    it('fences communication writes with the current execution claim', async () => {
      await primary.workspace.saveInterest(
        LOCAL_USER_ID,
        'Keep stale execution attempts from writing into a retry.',
      );
      const first = await primary.agent.beginAgentWake(
        LOCAL_AGENT_ID,
        'execution-first',
      );
      expect(first).toBeDefined();
      await primary.agent.interruptAgentWake(
        LOCAL_AGENT_ID,
        first!.claimToken,
      );
      const retry = await secondary.agent.beginAgentWake(
        LOCAL_AGENT_ID,
        'execution-retry',
      );
      expect(retry).toBeDefined();

      const event = {
        wakeNumber: first!.wakeNumber,
        kind: 'agent_wake_no_action' as const,
        actorAgentId: LOCAL_AGENT_ID,
        idempotencyKey: `${first!.wakeId}:action:1`,
        title: 'No action',
        content: 'No relevant match was available.',
      };
      await expect(primary.communication.appendClaimedCommunicationEvent({
        agentId: LOCAL_AGENT_ID,
        workId: first!.wakeId,
        executionId: first!.claimToken,
        workNumber: first!.wakeNumber,
      }, event)).rejects.toBeInstanceOf(AgentCommunicationClaimError);

      await expect(secondary.communication.appendClaimedCommunicationEvent({
        agentId: LOCAL_AGENT_ID,
        workId: retry!.wakeId,
        executionId: retry!.claimToken,
        workNumber: retry!.wakeNumber,
      }, event)).resolves.toMatchObject({
        idempotencyKey: event.idempotencyKey,
        content: event.content,
      });
      expect((await primary.network.readNetworkDiagnostics()).events.filter(
        ({ idempotencyKey }) => idempotencyKey === event.idempotencyKey,
      )).toHaveLength(1);
    });

    it('deduplicates simultaneous idempotent event writes across processes', async () => {
      const idempotencyKey = 'integration:concurrent-event';
      const content = 'Both processes are retrying the same durable side effect.';

      const [first, second] = await Promise.all([
        primary.network.saveUserInput(
          LOCAL_USER_ID,
          content,
          idempotencyKey,
        ),
        secondary.network.saveUserInput(
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

    it('deduplicates one background resume boundary across API processes', async () => {
      const input = {
        admissionGroupId: LUCID_BACKGROUND_WORK_GROUP_ID,
        transitionId: 'integration:shared-resume-transition',
      };
      const [first, second] = await Promise.all([
        primary.agent.prepareBackgroundChecksResume(input),
        secondary.agent.prepareBackgroundChecksResume(input),
      ]);

      expect(second).toEqual(first);
      expect((await primary.network.readNetworkDiagnostics()).events.filter(
        (event) => event.kind === 'background_resume_prepared'
          && event.metadata.transitionId === input.transitionId,
      )).toHaveLength(1);
    });

    it('serializes event appends with wake-horizon selection', async () => {
      let releaseWorkspaceLock = () => undefined;
      let reportWorkspaceLocked = () => undefined;
      const workspaceLockReleased = new Promise<void>((resolve) => {
        releaseWorkspaceLock = resolve;
      });
      const workspaceLocked = new Promise<void>((resolve) => {
        reportWorkspaceLocked = resolve;
      });
      const horizonTransaction = primaryDatabase!.orm.transaction(
        async (transaction) => {
          await transaction.execute(sql`
            select id
            from lucid.discovery_workspaces
            where id = ${LUCID_WORKSPACE_ID}
            for update
          `);
          reportWorkspaceLocked();
          await workspaceLockReleased;
        },
      );
      await workspaceLocked;

      const append = secondary.network.saveUserInput(
        LOCAL_USER_ID,
        'Do not let this committed input fall behind a later wake horizon.',
        'integration:commit-safe-horizon',
      );
      try {
        await expect.poll(async () => {
          const [row] = await primaryDatabase!.client<{
            waiting: number;
          }[]>`
            select count(*)::int as waiting
            from pg_stat_activity
            where application_name = ${SECONDARY_TEST_APPLICATION}
              and wait_event_type = 'Lock'
          `;
          return row?.waiting ?? 0;
        }).toBeGreaterThan(0);
      } finally {
        releaseWorkspaceLock();
        await horizonTransaction;
      }

      const event = await append;
      const wake = await primary.agent.beginAgentWake(
        LOCAL_AGENT_ID,
        'wake_after_serialized_append',
      );
      expect(wake?.visibleEvents).toContainEqual(event);
      expect(wake?.horizonSequence).toBeGreaterThanOrEqual(event.sequence);
    });

    it('does not steal an active claim when another API process initializes', async () => {
      await primary.workspace.saveInterest(
        LOCAL_USER_ID,
        'Keep this wake owned by its active worker.',
      );
      const wake = await primary.agent.beginAgentWake(
        LOCAL_AGENT_ID,
        'wake_owned',
      );

      await secondary.agent.initialize();

      expect(wake).toBeDefined();
      expect((await requireAgent(secondary.agent, LOCAL_AGENT_ID)))
        .toMatchObject({
        status: 'running',
        activeWakeId: wake!.wakeId,
      });
      await expect(secondary.agent.beginAgentWake(
        LOCAL_AGENT_ID,
        'wake_stolen',
      ))
        .rejects.toThrow('already running');
    });

    it('rejects settlement from an earlier attempt after the wake is reclaimed', async () => {
      await primary.workspace.saveInterest(
        LOCAL_USER_ID,
        'Fence every late writer after a retry.',
      );
      const firstAttempt = await primary.agent.beginAgentWake(
        LOCAL_AGENT_ID,
        'claim_first_attempt',
      );
      await primary.agent.failAgentWake(
        LOCAL_AGENT_ID,
        firstAttempt!.claimToken,
      );

      const retry = await secondary.agent.beginAgentWake(
        LOCAL_AGENT_ID,
        'claim_retry_attempt',
      );

      expect(retry).toMatchObject({
        wakeId: firstAttempt!.wakeId,
        claimToken: 'claim_retry_attempt',
        horizonSequence: firstAttempt!.horizonSequence,
      });
      await expect(primary.agent.completeAgentWake(
        LOCAL_AGENT_ID,
        firstAttempt!.claimToken,
        firstAttempt!.horizonSequence,
      )).rejects.toThrow('no longer owned');
      await expect(primary.agent.failAgentWake(
        LOCAL_AGENT_ID,
        firstAttempt!.claimToken,
      )).rejects.toThrow('no longer owned');
      expect(await requireAgent(secondary.agent, LOCAL_AGENT_ID))
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
        const agent = new PostgresAgentWakeStore(
          fresh.database,
        );

        await agent.initialize();

        expect((await agent.readWorkspace()).backgroundChecksEnabled)
          .toBe(false);
      } finally {
        await fresh.database.close();
      }
    });

    it('preserves user state after every connection closes', async () => {
      const first = await createStore();
      const interest = await first.stores.workspace.saveInterest(
        LOCAL_USER_ID,
        'Remember this assignment across a complete pool restart.',
      );
      await first.database.close();

      const reopened = await createStore({ reset: false });
      try {
        expect(await reopened.stores.workspace.findSavedInterest(LOCAL_USER_ID)).toEqual(
          interest,
        );
      } finally {
        await reopened.database.close();
      }
    });
  });
});

async function requireAgent(
  agentStore: PostgresTestStores['stores']['agent'],
  agentId: string,
) {
  const agent = (await agentStore.listAgents()).find(
    ({ id }) => id === agentId,
  );
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return agent;
}

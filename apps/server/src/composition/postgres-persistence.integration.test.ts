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
  HostedHeartbeatDelegatedExecution,
  HostedHeartbeatExecutionService,
  HostedHeartbeatAdmissionView,
  HostedHeartbeatCoordinatorState,
  HostedHeartbeatCoordinatorTaskApi,
  HostedHeartbeatCoordinatorTaskInput,
  HostedHeartbeatCoordinatorTaskView,
  type HostedHeartbeatExecutionApi,
  type HostedHeartbeatExecutionPreparationRequest,
} from '@heddleagent/execution-host-client/coordinator';
import type {
  ExecutionAuthorityIssuer,
  IssuedExecutionAuthorityMetadata,
} from '@heddleagent/execution-host-client/authority';
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
  taskIdForAgentJob,
} from '../lucid/agent/heartbeat-task-identity.js';
import { AgentJobService } from '../lucid/agent/jobs/service.js';
import {
  AgentCommunicationClaimError,
} from '../lucid/agent/communication/store.js';
import { AgentWorkService } from '../lucid/agent/work-service.js';
import { createLucidLogger } from '../logger.js';
import {
  CoordinatorAgentHeartbeatService,
} from '../hosted-execution/heartbeat/agent-heartbeat-service.js';
import {
  LucidBackgroundChecksAdmissionLifecycle,
} from '../hosted-execution/heartbeat/admission-lifecycle.js';
import {
  LucidHeartbeatExecutionLifecycle,
} from '../hosted-execution/heartbeat/execution-lifecycle.js';
import {
  PublishingJobWorkService,
} from '../lucid/information-network/publishing-job-work-service.js';
import {
  PostgresBackgroundChecksMutationLock,
} from '../hosted-execution/heartbeat/mutation-lock.js';

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
      await primary.agent.setBackgroundChecksEnabled(true);
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

    it('does not let resume abandon an atomically recovering wake', async () => {
      await primary.workspace.saveInterest(
        LOCAL_USER_ID,
        'Preserve this unread horizon when the provider recovers the attempt.',
      );
      const interrupted = await primary.agent.beginAgentWake(
        LOCAL_AGENT_ID,
        'execution_before_recovery_race',
      );

      let releaseWorkspaceLock = () => undefined;
      let reportWorkspaceLocked = () => undefined;
      const workspaceLockReleased = new Promise<void>((resolve) => {
        releaseWorkspaceLock = resolve;
      });
      const workspaceLocked = new Promise<void>((resolve) => {
        reportWorkspaceLocked = resolve;
      });
      const lockTransaction = primaryDatabase!.orm.transaction(
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

      const recovering = primary.agent.beginAgentWake(
        LOCAL_AGENT_ID,
        'execution_after_recovery_race',
        interrupted!.claimToken,
      );
      let preparation:
        ReturnType<typeof secondary.agent.prepareBackgroundChecksResume>
        | undefined;
      try {
        await expect.poll(async () => (
          await countLockWaiters(primaryDatabase!, PRIMARY_TEST_APPLICATION)
        )).toBeGreaterThan(0);
        preparation = secondary.agent.prepareBackgroundChecksResume({
          admissionGroupId: LUCID_BACKGROUND_WORK_GROUP_ID,
          transitionId: 'resume-racing-atomic-recovery',
        });
        await expect.poll(async () => (
          await countLockWaiters(primaryDatabase!, SECONDARY_TEST_APPLICATION)
        )).toBeGreaterThan(0);
      } finally {
        releaseWorkspaceLock();
        await lockTransaction;
      }

      const [recovered, prepared] = await Promise.all([
        recovering,
        preparation!,
      ]);
      expect(recovered).toMatchObject({
        wakeId: interrupted!.wakeId,
        claimToken: 'execution_after_recovery_race',
        horizonSequence: interrupted!.horizonSequence,
      });
      expect(prepared).toEqual({
        status: 'waiting',
        reason: 'agent-wake-running',
        runningAgentIds: [LOCAL_AGENT_ID],
      });
      const events = (await primary.network.readNetworkDiagnostics()).events;
      expect(events).toContainEqual(expect.objectContaining({
        title: 'Interrupted agent wake recovered',
      }));
      expect(events.some((event) => (
        event.kind === 'background_resume_prepared'
        && event.metadata.transitionId === 'resume-racing-atomic-recovery'
      ))).toBe(false);
      expect(events.some((event) => (
        event.metadata.resolution === 'not-retried-after-resume'
        && event.metadata.transitionId === 'resume-racing-atomic-recovery'
      ))).toBe(false);
    });

    it('lets an exact paused recovery settle before fresh resume becomes ready', async () => {
      const work = new AgentWorkService(
        primary.agent,
        primary.workspace,
        primary.communication,
        { triggerAgent: async () => undefined },
        createLucidLogger('silent'),
        { retryDelayMs: 10_000 },
      );
      const lifecycle = new LucidBackgroundChecksAdmissionLifecycle(
        primary.agent,
      );
      await primary.workspace.saveInterest(
        LOCAL_USER_ID,
        'Recover this already-owned Interest check without admitting fresh work.',
      );
      const first = await work.claimWork({
        agentId: LOCAL_AGENT_ID,
        executionId: 'execution_before_paused_crash',
        signal: AbortSignal.timeout(5_000),
      });
      expect(first).toMatchObject({ kind: 'claimed' });
      if (first.kind !== 'claimed') {
        throw new Error(
          'Expected the initial provider execution to claim work.',
        );
      }

      await primary.agent.setBackgroundChecksEnabled(false);
      await expect(work.claimWork({
        agentId: LOCAL_AGENT_ID,
        executionId: 'execution_stale_paused_recovery',
        interruptedExecutionId: 'different_interrupted_execution',
        signal: AbortSignal.timeout(5_000),
      })).resolves.toEqual({
        kind: 'skipped',
        summary: 'Background checks are paused.',
      });
      const recovered = await work.claimWork({
        agentId: LOCAL_AGENT_ID,
        executionId: 'execution_after_paused_crash',
        interruptedExecutionId: 'execution_before_paused_crash',
        signal: AbortSignal.timeout(5_000),
      });
      expect(recovered).toMatchObject({
        kind: 'claimed',
        work: {
          executionId: 'execution_after_paused_crash',
          workId: first.work.workId,
        },
      });
      await expect(work.completeWork({
        agentId: LOCAL_AGENT_ID,
        executionId: 'execution_after_paused_crash',
        result: {
          decision: 'complete',
          summary: 'The replacement attempt finished after product pause.',
          runId: 'run-after-paused-crash',
          outcome: 'done',
        },
        signal: AbortSignal.timeout(5_000),
      })).resolves.toEqual({
        kind: 'retry',
        summary: 'Background checks paused before Lucid commit.',
        delayMs: 10_000,
      });
      expect(await requireAgent(primary.agent, LOCAL_AGENT_ID)).toMatchObject({
        status: 'idle',
        activeWakeClaimToken: 'execution_after_paused_crash',
      });

      await primary.agent.setBackgroundChecksEnabled(true);
      await expect(lifecycle.prepareResume({
        schemaVersion: 1,
        target: {
          kind: 'group',
          groupId: LUCID_BACKGROUND_WORK_GROUP_ID,
        },
        transitionId: 'resume-after-paused-recovery-settled',
        signal: AbortSignal.timeout(5_000),
      })).resolves.toEqual({
        status: 'ready',
        summary: 'Lucid prepared a fresh background-work boundary.',
      });
      expect(await requireAgent(primary.agent, LOCAL_AGENT_ID)).toMatchObject({
        status: 'idle',
        activeWakeId: undefined,
        activeWakeClaimToken: undefined,
      });
    });

    it('does not replay retained recovery diagnostics into later ordinary work', async () => {
      const work = new AgentWorkService(
        primary.agent,
        primary.workspace,
        primary.communication,
        { triggerAgent: async () => undefined },
        createLucidLogger('silent'),
        { retryDelayMs: 10_000 },
      );
      const agentJobs = new AgentJobService(primary.agentJobs);
      const productLifecycle = new LucidHeartbeatExecutionLifecycle(
        agentJobs,
        work,
        new PublishingJobWorkService(agentJobs),
        {
          tenantId: 'lucid-integration',
          productSessionId: 'lucid-integration-session',
        },
      );
      const executionService = new HostedHeartbeatExecutionService({
        authority: integrationExecutionAuthority(),
        lifecycle: productLifecycle,
        runtimeSessionNamespace: 'lucid-integration-runtime',
        maxExecutionMs: 60_000,
        now: () => new Date('2026-09-01T00:00:00.000Z'),
      });
      const preparationRequests: HostedHeartbeatExecutionPreparationRequest[] = [];
      const executions: HostedHeartbeatExecutionApi = {
        prepare: async (input, signal) => {
          preparationRequests.push(input);
          return await executionService.prepare(input, signal);
        },
        settle: async (input, signal) => (
          await executionService.settle(input, signal)
        ),
      };
      const providerExecution = new HostedHeartbeatDelegatedExecution({
        executions,
        executionHost: {
          streamHeartbeatTask: async function* () {
            throw new Error('Runtime transport is not used by this handler test.');
          },
        },
        modelCredentials: {
          resolveModelCredential: async () => ({
            type: 'api-key',
            apiKey: 'integration-model-key',
          }),
        },
      });
      const taskId = taskIdForAgentJob(LOCAL_AGENT_ID);
      const retainedRecovery = {
        interruptedExecutionId: 'execution-before-provider-recovery',
        replacementStatus: 'claimed' as const,
        replacementExecutionId: 'execution-exact-provider-recovery',
      };
      const sourceSequenceByExecution = new Map<string, number>();
      const runProviderExecution = async (executionId: string) => {
        const signal = AbortSignal.timeout(5_000);
        return await providerExecution.handle({
          task: {
            id: taskId,
            state: { recovery: retainedRecovery },
          },
          executionId,
          signal,
          runAgent: async () => {
            const sourceSequence = sourceSequenceByExecution.get(executionId);
            if (sourceSequence === undefined) {
              throw new Error(`Missing product source for ${executionId}.`);
            }
            await work.executeTool({
              userId: LOCAL_USER_ID,
              executionId,
              toolName: 'post_shared_message',
              arguments: {
                reply_to_event_id: sourceSequence,
                content: 'Who has one concrete example for this Interest?',
                source_event_ids: [sourceSequence],
              },
              signal,
            });
            return {
              decision: 'complete' as const,
              summary: 'Completed one bounded Interest check.',
              state: {
                runId: `run-${executionId}`,
                outcome: 'done' as const,
              },
            };
          },
          skip: ({ summary }) => ({ kind: 'skipped' as const, summary }),
          retry: ({ summary, delayMs }) => ({
            kind: 'retry' as const,
            summary,
            delayMs,
          }),
          block: ({ summary }) => ({ kind: 'blocked' as const, summary }),
        });
      };

      const recoveredInterest = await primary.workspace.saveInterest(
        LOCAL_USER_ID,
        'Complete this Interest through one exact provider recovery.',
      );
      sourceSequenceByExecution.set(
        retainedRecovery.replacementExecutionId,
        recoveredInterest.sequence,
      );
      await expect(work.claimWork({
        agentId: LOCAL_AGENT_ID,
        executionId: retainedRecovery.interruptedExecutionId,
        signal: AbortSignal.timeout(5_000),
      })).resolves.toMatchObject({ kind: 'claimed' });
      await expect(runProviderExecution(
        retainedRecovery.replacementExecutionId,
      )).resolves.toMatchObject({
        decision: 'complete',
        state: { outcome: 'done' },
      });

      const ordinaryInterest = await primary.workspace.saveInterest(
        LOCAL_USER_ID,
        'This later Interest must become ordinary fresh work.',
      );
      sourceSequenceByExecution.set(
        'execution-after-retained-recovery-diagnostics',
        ordinaryInterest.sequence,
      );
      await expect(runProviderExecution(
        'execution-after-retained-recovery-diagnostics',
      )).resolves.toMatchObject({
        decision: 'complete',
        state: { outcome: 'done' },
      });
      expect(preparationRequests).toEqual([
        {
          schemaVersion: 2,
          taskId,
          executionId: retainedRecovery.replacementExecutionId,
          interruptedExecutionId: retainedRecovery.interruptedExecutionId,
        },
        {
          schemaVersion: 2,
          taskId,
          executionId: 'execution-after-retained-recovery-diagnostics',
        },
      ]);
      expect(await requireAgent(primary.agent, LOCAL_AGENT_ID)).toMatchObject({
        status: 'idle',
        runCount: 3,
        activeWakeId: undefined,
        activeWakeClaimToken: undefined,
      });
    });

    it('serializes full heartbeat mutations across two Lucid service instances', async () => {
      const coordinator = createOrderedCoordinatorCluster();
      const policy = {
        intervalMs: 60_000,
        model: 'test-model',
        maxSteps: 4,
        controlTimeoutMs: 5_000,
      };
      const firstService = new CoordinatorAgentHeartbeatService(
        primary.agent,
        new AgentJobService(primary.agentJobs),
        coordinator.forReplica('primary'),
        new PostgresBackgroundChecksMutationLock(primaryDatabase!, 5_000),
        policy,
        createLucidLogger('silent'),
      );
      const secondService = new CoordinatorAgentHeartbeatService(
        secondary.agent,
        new AgentJobService(secondary.agentJobs),
        coordinator.forReplica('secondary'),
        new PostgresBackgroundChecksMutationLock(secondaryDatabase!, 5_000),
        policy,
        createLucidLogger('silent'),
      );

      const firstMutation = firstService.reconcileAgentTasks();
      await coordinator.firstNamespacePauseEntered;
      const secondMutation = secondService.reconcileAgentTasks();
      try {
        await expect.poll(async () => (
          await countLockWaiters(primaryDatabase!, SECONDARY_TEST_APPLICATION)
        )).toBeGreaterThan(0);
        expect(coordinator.trace.some(({ replica }) => (
          replica === 'secondary'
        ))).toBe(false);
      } finally {
        coordinator.releaseFirstNamespacePause();
      }
      await Promise.all([firstMutation, secondMutation]);

      const lastPrimaryOperation = coordinator.trace.findLastIndex(
        ({ replica }) => replica === 'primary',
      );
      const firstSecondaryOperation = coordinator.trace.findIndex(
        ({ replica }) => replica === 'secondary',
      );
      expect(lastPrimaryOperation).toBeGreaterThanOrEqual(0);
      expect(firstSecondaryOperation).toBeGreaterThan(lastPrimaryOperation);
      expect(await coordinator.forReplica('observer').readState())
        .toBe('running');
      await expect(coordinator.forReplica('observer').readAdmission({
        kind: 'group',
        groupId: LUCID_BACKGROUND_WORK_GROUP_ID,
      })).resolves.toMatchObject({ phase: 'ready' });
    });

    it('bounds advisory mutation-lock acquisition across replicas', async () => {
      const firstLock = new PostgresBackgroundChecksMutationLock(
        primaryDatabase!,
        5_000,
      );
      const secondLock = new PostgresBackgroundChecksMutationLock(
        secondaryDatabase!,
        1_000,
      );
      let reportFirstLockAcquired = () => undefined;
      let releaseFirstLock = () => undefined;
      const firstLockAcquired = new Promise<void>((resolve) => {
        reportFirstLockAcquired = resolve;
      });
      const firstLockReleased = new Promise<void>((resolve) => {
        releaseFirstLock = resolve;
      });
      const heldMutation = firstLock.runExclusive(async () => {
        reportFirstLockAcquired();
        await firstLockReleased;
      });
      await firstLockAcquired;

      try {
        const startedAt = Date.now();
        let lockError: unknown;
        try {
          await secondLock.runExclusive(async () => undefined);
        } catch (error) {
          lockError = error;
        }
        expect((lockError as { cause?: { code?: string } }).cause?.code)
          .toBe('55P03');
        expect(Date.now() - startedAt).toBeLessThan(5_000);
      } finally {
        releaseFirstLock();
        await heldMutation;
      }
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

async function countLockWaiters(
  database: PostgresDatabase,
  applicationName: string,
): Promise<number> {
  const [row] = await database.client<{ waiting: number }[]>`
    select count(*)::int as waiting
    from pg_stat_activity
    where application_name = ${applicationName}
      and wait_event_type = 'Lock'
  `;
  return row?.waiting ?? 0;
}

function createOrderedCoordinatorCluster() {
  const tasks = new Map<string, HostedHeartbeatCoordinatorTaskView>();
  const trace: Array<{ replica: string; operation: string }> = [];
  let namespaceState: HostedHeartbeatCoordinatorState = 'running';
  let groupAdmission = coordinatorAdmissionView('ready', 1);
  let namespacePauseCount = 0;
  let reportFirstNamespacePause = () => undefined;
  let releaseFirstNamespacePause = () => undefined;
  const firstNamespacePauseEntered = new Promise<void>((resolve) => {
    reportFirstNamespacePause = resolve;
  });
  const firstNamespacePauseReleased = new Promise<void>((resolve) => {
    releaseFirstNamespacePause = resolve;
  });
  const record = (replica: string, operation: string) => {
    trace.push({ replica, operation });
  };

  const forReplica = (replica: string): HostedHeartbeatCoordinatorTaskApi => ({
    readState: async (signal) => {
      signal?.throwIfAborted();
      record(replica, 'namespace.read');
      return namespaceState;
    },
    listTasks: async (signal) => {
      signal?.throwIfAborted();
      record(replica, 'tasks.list');
      return [...tasks.values()];
    },
    readTask: async (taskId, signal) => {
      signal?.throwIfAborted();
      record(replica, 'task.read');
      return { task: tasks.get(taskId)!, runs: [] };
    },
    readTaskActivity: async (taskId, signal) => {
      signal?.throwIfAborted();
      record(replica, 'activity.read');
      return { schemaVersion: 1, taskId, execution: null };
    },
    upsertTask: async (taskId, input, signal) => {
      signal?.throwIfAborted();
      record(replica, 'task.upsert');
      tasks.set(taskId, coordinatorTaskView(taskId, input));
    },
    triggerTask: async (taskId, signal) => {
      signal?.throwIfAborted();
      record(replica, 'task.trigger');
      return tasks.get(taskId)!;
    },
    deleteTask: async (taskId, signal) => {
      signal?.throwIfAborted();
      record(replica, 'task.delete');
      tasks.delete(taskId);
    },
    readAdmission: async (target, signal) => {
      signal?.throwIfAborted();
      record(replica, `${target.kind}.admission.read`);
      return target.kind === 'group'
        ? groupAdmission
        : coordinatorAdmissionView(
            namespaceState === 'running' ? 'ready' : 'closed',
            1,
            target,
          );
    },
    pauseAdmission: async (target, signal) => {
      signal?.throwIfAborted();
      record(replica, `${target.kind}.admission.pause`);
      if (target.kind === 'namespace') {
        namespaceState = 'paused';
        return coordinatorAdmissionView('closed', 2, target);
      }
      groupAdmission = coordinatorAdmissionView(
        'closed',
        groupAdmission.revision + 1,
      );
      return groupAdmission;
    },
    resumeAdmission: async (target, signal) => {
      signal?.throwIfAborted();
      record(replica, `${target.kind}.admission.resume`);
      if (target.kind === 'namespace') {
        namespaceState = 'running';
        return coordinatorAdmissionView('ready', 2, target);
      }
      groupAdmission = coordinatorAdmissionView(
        'ready',
        groupAdmission.revision + 1,
      );
      return groupAdmission;
    },
    pause: async (signal) => {
      signal?.throwIfAborted();
      namespacePauseCount += 1;
      record(replica, 'namespace.pause.enter');
      if (namespacePauseCount === 1) {
        reportFirstNamespacePause();
        await firstNamespacePauseReleased;
      }
      signal?.throwIfAborted();
      namespaceState = 'paused';
      record(replica, 'namespace.pause.exit');
    },
    resume: async (signal) => {
      signal?.throwIfAborted();
      namespaceState = 'running';
      record(replica, 'namespace.resume');
    },
    drain: async (signal) => {
      signal?.throwIfAborted();
      namespaceState = 'drained';
      record(replica, 'namespace.drain');
    },
  });

  return {
    trace,
    forReplica,
    firstNamespacePauseEntered,
    releaseFirstNamespacePause,
  };
}

function coordinatorTaskView(
  taskId: string,
  input: HostedHeartbeatCoordinatorTaskInput,
): HostedHeartbeatCoordinatorTaskView {
  return {
    id: taskId,
    taskId,
    workspaceId: input.workspaceId,
    admissionGroupId: input.admissionGroupId,
    name: input.name,
    task: input.task,
    enabled: input.enabled ?? true,
    continuationMode: input.continuationMode ?? 'operator',
    schedule: { intervalMs: input.intervalMs },
    state: { status: 'idle' },
  };
}

function coordinatorAdmissionView(
  phase: 'closed' | 'ready',
  revision: number,
  target: HostedHeartbeatAdmissionView['target'] = {
    kind: 'group',
    groupId: LUCID_BACKGROUND_WORK_GROUP_ID,
  },
): HostedHeartbeatAdmissionView {
  const timestamp = '2026-09-01T00:00:00.000Z';
  return {
    schemaVersion: 1,
    target,
    desiredState: phase,
    phase,
    revision,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function integrationExecutionAuthority(): ExecutionAuthorityIssuer {
  return {
    issue: async (input) => {
      const issuedAt = '2026-09-01T00:00:00.000Z';
      const expiresAt = '2026-09-01T00:01:00.000Z';
      const metadata: IssuedExecutionAuthorityMetadata = {
        scope: {
          adopterId: 'lucid-integration',
          ...input.scope,
        },
        runtimeSessionId: input.runtimeSessionId,
        invocationId: input.invocationId,
        workflow: input.workflow,
        runtimeToolPolicy: input.runtimeToolPolicy,
        issuedAt,
        executionExpiresAt: expiresAt,
        mcp: {
          capabilityId: `capability-${input.invocationId}`,
          serverId: 'lucid-integration-mcp',
          allowedTools: [...(input.mcp?.allowedTools ?? [])],
          expiresAt,
        },
      };
      return {
        metadata,
        executionAssertion: () => `assertion-${input.invocationId}`,
        mcpCapability: () => `capability-token-${input.invocationId}`,
        toJSON: () => metadata,
      };
    },
  };
}

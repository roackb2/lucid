/** Real-PostgreSQL contract for durable Agent-job intent and fencing. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import dayjs from 'dayjs';
import type { PostgresDatabase } from '../../../infrastructure/postgres/database.js';
import { LOCAL_AGENT_ID, LOCAL_USER_ID } from '../../local-user.js';
import {
  postgresAgentJobPublishingPreferences as publishingPreferences,
  postgresAgentJobPublishingTopics as publishingTopics,
  postgresAgentJobs as agentJobs,
  postgresNetworkPosts as networkPosts,
  postgresNetworkProfiles as networkProfiles,
} from '../../persistence/postgres/schema.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../../persistence/postgres/test-context.js';
import { LUCID_WORKSPACE_ID } from '../../workspace/workspace-identity.js';
import { AgentJobDisabledError } from './store.js';
import { AgentJobService } from './service.js';

const PUBLISHER_JOB_ID = 'publisher-job';
const REQUESTED_AT = '2026-09-04T07:00:00.000Z';

describe('PostgreSQL Agent job store', () => {
  let database: PostgresDatabase;
  let stores: PostgresTestStores['stores'];

  beforeAll(async () => {
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-agent-jobs-test',
      reset: false,
    }));
  });

  beforeEach(async () => {
    await stores.agent.reset({ backgroundChecksEnabled: true });
    await insertPublisherJob(database);
  });

  afterAll(async () => database.close());

  it('reads one general job with private, job-owned publishing preferences', async () => {
    await expect(stores.agentJobs.readAgentJob(PUBLISHER_JOB_ID))
      .resolves.toEqual({
        id: PUBLISHER_JOB_ID,
        workspaceId: LUCID_WORKSPACE_ID,
        agentId: LOCAL_AGENT_ID,
        kind: 'information-network-publishing',
        name: 'Local information publisher',
        instructions: 'Find one current, source-backed item worth publishing.',
        cadenceMs: 10_800_000,
        enabled: true,
        scheduleMode: 'manual',
        publishingPreferences: {
          topics: ['Agent systems', 'Distributed systems'],
          region: 'Taiwan',
          intendedAudience: 'Software builders',
          tone: 'Clear and practical',
          sourceGuidance: 'Prefer primary sources.',
          updatedAt: REQUESTED_AT,
        },
        createdAt: REQUESTED_AT,
        updatedAt: REQUESTED_AT,
      });
  });

  it('initializes one stable Interest job without overwriting existing policy', async () => {
    const primaryService = serviceFor(stores);
    const secondaryService = serviceFor(stores);
    const [first, second] = await Promise.all([
      primaryService.ensureInterestDiscoveryJob(
        LOCAL_AGENT_ID,
        10_800_000,
      ),
      secondaryService.ensureInterestDiscoveryJob(
        LOCAL_AGENT_ID,
        10_800_000,
      ),
    ]);
    const localAgent = (await stores.agent.listAgents()).find(
      ({ id }) => id === LOCAL_AGENT_ID,
    );

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      id: LOCAL_AGENT_ID,
      agentId: LOCAL_AGENT_ID,
      kind: 'interest-discovery',
      name: 'Interest discovery',
      instructions: localAgent?.purpose,
      cadenceMs: 10_800_000,
      enabled: true,
      scheduleMode: 'scheduled',
    });

    await database.orm.update(agentJobs).set({
      cadenceMs: 60_000,
      enabled: false,
    }).where(eq(agentJobs.id, LOCAL_AGENT_ID));
    await expect(primaryService.ensureInterestDiscoveryJob(
      LOCAL_AGENT_ID,
      120_000,
    )).resolves.toMatchObject({
      cadenceMs: 60_000,
      enabled: false,
    });
  });

  it('coalesces concurrent run requests across PostgreSQL pools', async () => {
    const secondary = await createPostgresTestStores({
      applicationName: 'lucid-agent-jobs-contention-test',
      reset: false,
    });
    try {
      const first = serviceFor(stores, 'request-1');
      const second = serviceFor(secondary.stores, 'request-2');

      const receipts = await Promise.all([
        first.requestRunOnce(PUBLISHER_JOB_ID),
        second.requestRunOnce(PUBLISHER_JOB_ID),
      ]);

      expect(receipts.map(({ outcome }) => outcome).sort()).toEqual([
        'already-requested',
        'requested',
      ]);
      expect(new Set(receipts.map(({ request }) => request.id)).size).toBe(1);
      await expect(stores.agentJobs.readLatestRunRequest(PUBLISHER_JOB_ID))
        .resolves.toMatchObject({ state: 'requested' });
    } finally {
      await secondary.database.close();
    }
  });

  it('rejects new run intent for a disabled job', async () => {
    await database.orm.update(agentJobs).set({ enabled: false });

    await expect(serviceFor(stores).requestRunOnce(PUBLISHER_JOB_ID))
      .rejects.toBeInstanceOf(AgentJobDisabledError);
  });

  it('claims once, transfers exact recovery, and fences stale execution', async () => {
    const service = serviceFor(stores);
    const requested = await service.requestRunOnce(PUBLISHER_JOB_ID);
    const first = await service.claimPendingRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-1',
    });

    expect(first).toMatchObject({
      workId: requested.request.id,
      executionId: 'execution-1',
      runRequest: { state: 'claimed' },
      agent: {
        activeJobId: PUBLISHER_JOB_ID,
        activeWakeId: requested.request.id,
        activeWakeClaimToken: 'execution-1',
      },
    });
    await expect(service.claimPendingRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-1',
    })).resolves.toMatchObject({
      workId: requested.request.id,
      executionId: 'execution-1',
    });
    await expect(service.claimPendingRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-2',
    })).resolves.toBeUndefined();
    await expect(service.claimPendingRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-2',
      interruptedExecutionId: 'wrong-execution',
    })).resolves.toBeUndefined();

    const recovered = await service.claimPendingRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-2',
      interruptedExecutionId: 'execution-1',
    });
    expect(recovered).toMatchObject({
      workId: requested.request.id,
      executionId: 'execution-2',
      runRequest: { currentExecutionId: 'execution-2' },
    });
    const [agentAfterRecovery] = await stores.agent.listAgents();
    expect(agentAfterRecovery).toMatchObject({ runCount: 1 });
    expect(dayjs(agentAfterRecovery?.lastRunAt).toISOString())
      .toBe(REQUESTED_AT);
    await expect(service.readClaimedRun(
      PUBLISHER_JOB_ID,
      'execution-1',
    )).resolves.toBeUndefined();
    await expect(service.readClaimedRun(
      PUBLISHER_JOB_ID,
      'execution-2',
    )).resolves.toMatchObject({ workId: requested.request.id });
  });

  it('blocks new work while paused but permits exact recovery transfer', async () => {
    const service = serviceFor(stores);
    await service.requestRunOnce(PUBLISHER_JOB_ID);
    await stores.agent.setBackgroundChecksEnabled(false);

    await expect(service.claimPendingRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-paused',
    })).resolves.toBeUndefined();

    await stores.agent.setBackgroundChecksEnabled(true);
    await service.claimPendingRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-before-pause',
    });
    await stores.agent.setBackgroundChecksEnabled(false);
    await database.orm.update(agentJobs).set({ enabled: false });
    await expect(service.claimPendingRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-after-pause',
      interruptedExecutionId: 'execution-before-pause',
    })).resolves.toMatchObject({
      executionId: 'execution-after-pause',
      runRequest: { currentExecutionId: 'execution-after-pause' },
    });
  });

  it('returns interrupted work to pending without changing its stable ID', async () => {
    const service = serviceFor(stores);
    const requested = await service.requestRunOnce(PUBLISHER_JOB_ID);
    await service.claimPendingRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-1',
    });

    await service.interruptRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-1',
    });

    await expect(service.readLatestRunRequest(PUBLISHER_JOB_ID))
      .resolves.toMatchObject({
        id: requested.request.id,
        agentJobId: PUBLISHER_JOB_ID,
        state: 'requested',
        requestedAt: REQUESTED_AT,
      });
    await expect(service.claimPendingRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-2',
    })).resolves.toMatchObject({
      workId: requested.request.id,
      executionId: 'execution-2',
    });
  });

  it('settles a source-free completion truthfully as no-post without retry intent', async () => {
    const service = serviceFor(stores);
    await service.requestRunOnce(PUBLISHER_JOB_ID);
    await service.claimPendingRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-1',
    });

    await service.settleRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-1',
      outcome: 'no-post',
      outcomeSummary: 'No sufficiently reliable source was available.',
    });

    await expect(service.readLatestRunRequest(PUBLISHER_JOB_ID))
      .resolves.toMatchObject({
        state: 'settled',
        outcome: 'no-post',
        outcomeSummary: 'No sufficiently reliable source was available.',
      });
    await expect(service.claimPendingRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-2',
    })).resolves.toBeUndefined();
    expect((await stores.agent.listAgents())[0]).toMatchObject({
      status: 'idle',
      activeJobId: undefined,
      activeWakeId: undefined,
      runCount: 1,
    });
  });

  it('recognizes a durable Post when execution fails after its side effect', async () => {
    const service = serviceFor(stores);
    const request = await service.requestRunOnce(PUBLISHER_JOB_ID);
    await service.claimPendingRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-1',
    });
    await insertPublishedPost(database, request.request.id);

    await service.failRun({
      agentJobId: PUBLISHER_JOB_ID,
      executionId: 'execution-1',
      summary: 'The response stream ended after the product write.',
    });

    await expect(service.readLatestRunRequest(PUBLISHER_JOB_ID))
      .resolves.toMatchObject({
        state: 'settled',
        outcome: 'published',
        publishedPostId: 'publisher-post',
        outcomeSummary: undefined,
      });
  });
});

function serviceFor(
  stores: PostgresTestStores['stores'],
  id = 'request-1',
): AgentJobService {
  return new AgentJobService(stores.agentJobs, {
    createId: () => id,
    now: () => REQUESTED_AT,
  });
}

async function insertPublisherJob(database: PostgresDatabase): Promise<void> {
  await database.orm.insert(agentJobs).values({
    id: PUBLISHER_JOB_ID,
    workspaceId: LUCID_WORKSPACE_ID,
    agentId: LOCAL_AGENT_ID,
    kind: 'information-network-publishing',
    name: 'Local information publisher',
    instructions: 'Find one current, source-backed item worth publishing.',
    cadenceMs: 10_800_000,
    enabled: true,
    scheduleMode: 'manual',
    createdAt: REQUESTED_AT,
    updatedAt: REQUESTED_AT,
  });
  await database.orm.insert(publishingPreferences).values({
    agentJobId: PUBLISHER_JOB_ID,
    region: 'Taiwan',
    intendedAudience: 'Software builders',
    tone: 'Clear and practical',
    sourceGuidance: 'Prefer primary sources.',
    createdAt: REQUESTED_AT,
    updatedAt: REQUESTED_AT,
  });
  await database.orm.insert(publishingTopics).values([
    { agentJobId: PUBLISHER_JOB_ID, position: 0, topic: 'Agent systems' },
    { agentJobId: PUBLISHER_JOB_ID, position: 1, topic: 'Distributed systems' },
  ]);
}

async function insertPublishedPost(
  database: PostgresDatabase,
  runRequestId: string,
): Promise<void> {
  await database.orm.insert(networkProfiles).values({
    id: 'publisher-profile',
    workspaceId: LUCID_WORKSPACE_ID,
    userId: LOCAL_USER_ID,
    publicDescription: 'A controlled local publisher.',
    publishingFocus: 'Agent systems',
    createdAt: REQUESTED_AT,
    updatedAt: REQUESTED_AT,
  });
  await database.orm.insert(networkPosts).values({
    id: 'publisher-post',
    workspaceId: LUCID_WORKSPACE_ID,
    authorProfileId: 'publisher-profile',
    authorAgentId: LOCAL_AGENT_ID,
    createdByAgentJobId: PUBLISHER_JOB_ID,
    createdByAgentJobRunRequestId: runRequestId,
    publicationMethod: 'agent',
    title: 'A durable publication',
    body: 'The Post remains authoritative after an ambiguous Runtime result.',
    publishedAt: REQUESTED_AT,
    createdAt: REQUESTED_AT,
    createdByExecutionId: 'execution-1',
    idempotencyKey: `${runRequestId}:publish-text-post`,
  });
}

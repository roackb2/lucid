import {
  and,
  asc,
  desc,
  eq,
  inArray,
} from 'drizzle-orm';
import dayjs from 'dayjs';
import type { PostgresDatabase } from '../../../infrastructure/postgres/database.js';
import {
  toAgent,
  toUser,
} from '../../persistence/postgres/records.js';
import {
  postgresAgentJobPublishingPreferences as publishingPreferences,
  postgresAgentJobPublishingTopics as publishingTopics,
  postgresAgentJobRunRequests as runRequests,
  postgresAgentJobs as agentJobs,
  postgresAgents as agents,
  postgresNetworkPosts as networkPosts,
  postgresUsers as users,
  postgresDiscoveryWorkspaces as workspaces,
} from '../../persistence/postgres/schema.js';
import {
  AgentJobClaimError,
  AgentJobDisabledError,
  AgentJobNotFoundError,
  type AgentJobStore,
} from './store.js';
import {
  agentJobKindSchema,
  agentJobRunOutcomeSchema,
  agentJobRunRequestStateSchema,
  agentJobScheduleModeSchema,
  type AgentJob,
  type AgentJobPublishingPreferences,
  type AgentJobRunOutcome,
  type AgentJobRunRequest,
  type AgentJobWorkClaim,
} from './types.js';
import { LUCID_WORKSPACE_ID } from '../../workspace/workspace-identity.js';

type LucidPostgresTransaction = Parameters<
  Parameters<PostgresDatabase['orm']['transaction']>[0]
>[0];
type AgentJobRow = typeof agentJobs.$inferSelect;
type PublishingPreferencesRow = typeof publishingPreferences.$inferSelect;
type RunRequestRow = typeof runRequests.$inferSelect;

/** PostgreSQL authority for Agent jobs, run intent, and execution fencing. */
export class PostgresAgentJobStore implements AgentJobStore {
  constructor(private readonly database: PostgresDatabase) {}

  /**
   * Creates only the code-owned Interest job for an existing Agent.
   * The workspace lock serializes concurrent initialization and preserves the
   * same workspace -> job -> Agent lock order used by run admission.
   */
  async ensureInterestDiscoveryJob(
    input: Parameters<AgentJobStore['ensureInterestDiscoveryJob']>[0],
  ): ReturnType<AgentJobStore['ensureInterestDiscoveryJob']> {
    return await this.database.orm.transaction(async (transaction) => {
      const [workspaceRow] = await transaction.select().from(workspaces)
        .where(eq(workspaces.id, LUCID_WORKSPACE_ID))
        .for('update')
        .limit(1);
      if (!workspaceRow) {
        throw new Error(
          'Discovery workspace is missing. Run the database migration and restart the service.',
        );
      }
      const existingJobRow = await lockAgentJob(transaction, input.agentId);
      const [agentRow] = await transaction.select().from(agents)
        .where(eq(agents.id, input.agentId))
        .for('update')
        .limit(1);
      if (!agentRow || agentRow.workspaceId !== workspaceRow.id) {
        throw new Error(
          'Lucid cannot initialize an Interest job for an unknown Agent.',
        );
      }
      if (existingJobRow) {
        if (
          existingJobRow.agentId !== agentRow.id
          || existingJobRow.workspaceId !== agentRow.workspaceId
          || existingJobRow.kind !== 'interest-discovery'
        ) {
          throw new Error(
            'The Agent ID is already owned by an incompatible Agent job.',
          );
        }
        const existingJob = await readAgentJob(transaction, existingJobRow.id);
        if (!existingJob) {
          throw new Error('Lucid could not reload the existing Interest job.');
        }
        return existingJob;
      }

      const instructions = agentRow.purpose.trim()
        || agentRow.instructions.trim()
        || 'Review new Lucid Network activity against the owner\'s current Interest.';
      const [createdJobRow] = await transaction.insert(agentJobs).values({
        id: agentRow.id,
        workspaceId: agentRow.workspaceId,
        agentId: agentRow.id,
        kind: 'interest-discovery',
        name: 'Interest discovery',
        instructions,
        cadenceMs: input.cadenceMs,
        enabled: true,
        scheduleMode: 'scheduled',
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      }).returning();
      if (!createdJobRow) {
        throw new Error('Lucid did not persist the Interest job.');
      }
      return toAgentJob(createdJobRow);
    });
  }

  async listAgentJobs(): Promise<AgentJob[]> {
    return await this.database.orm.transaction(async (transaction) => {
      const rows = await transaction
        .select()
        .from(agentJobs)
        .orderBy(asc(agentJobs.createdAt), asc(agentJobs.id));
      if (rows.length === 0) {
        return [];
      }
      const jobIds = rows.map(({ id }) => id);
      const [preferenceRows, topicRows] = await Promise.all([
        transaction.select().from(publishingPreferences).where(
          inArray(publishingPreferences.agentJobId, jobIds),
        ),
        transaction.select().from(publishingTopics).where(
          inArray(publishingTopics.agentJobId, jobIds),
        ).orderBy(
          asc(publishingTopics.agentJobId),
          asc(publishingTopics.position),
        ),
      ]);
      const topicsByJobId = topicRows.reduce<Map<string, string[]>>(
        (topics, row) => topics.set(
          row.agentJobId,
          [...(topics.get(row.agentJobId) ?? []), row.topic],
        ),
        new Map(),
      );
      const preferencesByJobId = new Map(preferenceRows.map((row) => [
        row.agentJobId,
        toPublishingPreferences(
          row,
          topicsByJobId.get(row.agentJobId) ?? [],
        ),
      ]));
      return rows.map((row) => toAgentJob(
        row,
        preferencesByJobId.get(row.id),
      ));
    });
  }

  async readAgentJob(agentJobId: string): Promise<AgentJob | undefined> {
    return await this.database.orm.transaction(async (transaction) => (
      await readAgentJob(transaction, agentJobId)
    ));
  }

  async readLatestRunRequest(
    agentJobId: string,
  ): Promise<AgentJobRunRequest | undefined> {
    return await this.database.orm.transaction(async (transaction) => {
      const [row] = await transaction
        .select()
        .from(runRequests)
        .where(eq(runRequests.agentJobId, agentJobId))
        .orderBy(desc(runRequests.requestedAt), desc(runRequests.id))
        .limit(1);
      return row ? await toRunRequest(transaction, row) : undefined;
    });
  }

  /** Locks the job so concurrent callers return one shared active request. */
  async requestRunOnce(
    input: Parameters<AgentJobStore['requestRunOnce']>[0],
  ): ReturnType<AgentJobStore['requestRunOnce']> {
    return await this.database.orm.transaction(async (transaction) => {
      const job = await lockAgentJob(transaction, input.agentJobId);
      if (!job) {
        throw new AgentJobNotFoundError();
      }
      if (!job.enabled) {
        throw new AgentJobDisabledError();
      }
      const [activeRequest] = await transaction
        .select()
        .from(runRequests)
        .where(and(
          eq(runRequests.agentJobId, job.id),
          inArray(runRequests.state, ['requested', 'claimed']),
        ))
        .orderBy(asc(runRequests.requestedAt), asc(runRequests.id))
        .limit(1);
      if (activeRequest) {
        return {
          outcome: 'already-requested',
          request: await toRunRequest(transaction, activeRequest),
        };
      }
      const [created] = await transaction.insert(runRequests).values({
        id: input.runRequestId,
        agentJobId: job.id,
        state: 'requested',
        requestedAt: input.requestedAt,
      }).returning();
      if (!created) {
        throw new Error('Lucid did not persist the Agent job run request.');
      }
      return {
        outcome: 'requested',
        request: toRunRequestWithoutPost(created),
      };
    });
  }

  /**
   * Atomically claims pending intent or transfers one exact interrupted claim.
   * A stale recovery request never falls through to unrelated pending work.
   */
  async claimPendingRun(
    input: Parameters<AgentJobStore['claimPendingRun']>[0],
  ): ReturnType<AgentJobStore['claimPendingRun']> {
    return await this.database.orm.transaction(async (transaction) => {
      // Match the shared admission lock order: workspace, job, then Agent.
      // This prevents cross-workflow deadlocks.
      const [workspaceRow] = await transaction.select().from(workspaces)
        .where(eq(workspaces.id, LUCID_WORKSPACE_ID))
        .for('update')
        .limit(1);
      if (!workspaceRow) {
        throw new Error(
          'Discovery workspace is missing. Run the database migration and restart the service.',
        );
      }
      const jobRow = await lockAgentJob(transaction, input.agentJobId);
      if (
        !jobRow
        || jobRow.workspaceId !== workspaceRow.id
      ) {
        return undefined;
      }
      const [agentRow] = await transaction
        .select()
        .from(agents)
        .where(eq(agents.id, jobRow.agentId))
        .for('update')
        .limit(1);
      if (!agentRow || agentRow.workspaceId !== jobRow.workspaceId) {
        return undefined;
      }
      const [userRow] = await transaction
        .select()
        .from(users)
        .where(eq(users.id, agentRow.userId))
        .limit(1);
      if (
        !userRow
        || userRow.workspaceId !== jobRow.workspaceId
      ) {
        return undefined;
      }

      if (input.interruptedExecutionId) {
        return await transferInterruptedRun(transaction, {
          jobRow,
          agentRow,
          userRow,
          executionId: input.executionId,
          interruptedExecutionId: input.interruptedExecutionId,
          recoveredAt: input.claimedAt,
        });
      }
      const replayedClaim = await readReplayedRun(transaction, {
        jobRow,
        agentRow,
        userRow,
        executionId: input.executionId,
      });
      if (replayedClaim) {
        return replayedClaim;
      }
      if (
        !jobRow.enabled
        || userRow.status !== 'active'
        || !workspaceRow.backgroundChecksEnabled
      ) {
        return undefined;
      }
      if (
        agentRow.status !== 'idle'
        || agentRow.activeWakeId !== null
        || agentRow.activeWakeClaimToken !== null
      ) {
        return undefined;
      }

      const [requestRow] = await transaction
        .select()
        .from(runRequests)
        .where(and(
          eq(runRequests.agentJobId, jobRow.id),
          eq(runRequests.state, 'requested'),
        ))
        .orderBy(asc(runRequests.requestedAt), asc(runRequests.id))
        .for('update')
        .limit(1);
      if (!requestRow) {
        return undefined;
      }

      const wakeNumber = workspaceRow.currentWake + 1;
      await transaction
        .update(workspaces)
        .set({
          currentWake: wakeNumber,
          updatedAt: input.claimedAt,
        })
        .where(eq(workspaces.id, jobRow.workspaceId));
      const [claimedRequest] = await transaction.update(runRequests).set({
        state: 'claimed',
        currentExecutionId: input.executionId,
        claimedAt: input.claimedAt,
      }).where(and(
        eq(runRequests.id, requestRow.id),
        eq(runRequests.state, 'requested'),
      )).returning();
      const [claimedAgent] = await transaction.update(agents).set({
        status: 'running',
        activeJobId: jobRow.id,
        activeWakeId: requestRow.id,
        activeWakeClaimToken: input.executionId,
        activeWakeNumber: wakeNumber,
        // Publishing work deliberately does not advance the mailbox cursor.
        activeWakeHorizon: agentRow.lastSeenSequence,
        // Count the admitted run once. Replay and recovery transfer only the
        // execution fence and retain this original acceptance timestamp.
        runCount: agentRow.runCount + 1,
        lastRunAt: input.claimedAt,
        updatedAt: input.claimedAt,
      }).where(and(
        eq(agents.id, agentRow.id),
        eq(agents.status, 'idle'),
      )).returning();
      if (!claimedRequest || !claimedAgent) {
        throw new Error('Lucid could not atomically claim the Agent job run.');
      }
      return await toWorkClaim(transaction, {
        jobRow,
        requestRow: claimedRequest,
        agentRow: claimedAgent,
        userRow,
        executionId: input.executionId,
      });
    });
  }

  async readClaimedRun(
    agentJobId: string,
    executionId: string,
  ): Promise<AgentJobWorkClaim | undefined> {
    return await this.database.orm.transaction(async (transaction) => {
      const [jobRow] = await transaction.select().from(agentJobs).where(
        eq(agentJobs.id, agentJobId),
      ).limit(1);
      if (!jobRow) {
        return undefined;
      }
      const [agentRow] = await transaction.select().from(agents).where(and(
        eq(agents.id, jobRow.agentId),
        eq(agents.activeJobId, jobRow.id),
        eq(agents.activeWakeClaimToken, executionId),
      )).limit(1);
      if (!agentRow?.activeWakeId) {
        return undefined;
      }
      const [[userRow], [requestRow]] = await Promise.all([
        transaction.select().from(users).where(
          eq(users.id, agentRow.userId),
        ).limit(1),
        transaction.select().from(runRequests).where(and(
          eq(runRequests.id, agentRow.activeWakeId),
          eq(runRequests.agentJobId, jobRow.id),
          eq(runRequests.state, 'claimed'),
          eq(runRequests.currentExecutionId, executionId),
        )).limit(1),
      ]);
      return userRow && requestRow
        ? await toWorkClaim(transaction, {
          jobRow,
          requestRow,
          agentRow,
          userRow,
          executionId,
        })
        : undefined;
    });
  }

  async settleRun(
    input: Parameters<AgentJobStore['settleRun']>[0],
  ): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      const claimed = await lockClaimedRun(transaction, input);
      if (!claimed) {
        if (await wasSettledByExecution(transaction, input)) {
          return;
        }
        throw new AgentJobClaimError();
      }
      const publishedPostId = await readPublishedPostId(
        transaction,
        claimed.requestRow.id,
      );
      if (
        input.outcome === 'published'
          ? publishedPostId !== input.publishedPostId
          : publishedPostId !== undefined
      ) {
        throw new Error(
          'Agent job settlement does not match its durable Post effect.',
        );
      }
      await settleClaimedRun(transaction, claimed, {
        outcome: input.outcome,
        outcomeSummary: input.outcomeSummary,
        settledAt: input.settledAt,
      });
    });
  }

  async failRun(
    input: Parameters<AgentJobStore['failRun']>[0],
  ): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      const claimed = await lockClaimedRun(transaction, input);
      if (!claimed) {
        if (await wasSettledByExecution(transaction, input)) {
          return;
        }
        throw new AgentJobClaimError();
      }
      const publishedPostId = await readPublishedPostId(
        transaction,
        claimed.requestRow.id,
      );
      await settleClaimedRun(transaction, claimed, {
        outcome: publishedPostId ? 'published' : 'failed',
        outcomeSummary: publishedPostId ? undefined : input.outcomeSummary,
        settledAt: input.settledAt,
      });
    });
  }

  async interruptRun(
    input: Parameters<AgentJobStore['interruptRun']>[0],
  ): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      const claimed = await lockClaimedRun(transaction, input);
      if (!claimed) {
        return;
      }
      const publishedPostId = await readPublishedPostId(
        transaction,
        claimed.requestRow.id,
      );
      if (publishedPostId) {
        await settleClaimedRun(transaction, claimed, {
          outcome: 'published',
          settledAt: input.interruptedAt,
        });
        return;
      }
      await transaction.update(runRequests).set({
        state: 'requested',
        currentExecutionId: null,
        claimedAt: null,
      }).where(eq(runRequests.id, claimed.requestRow.id));
      await releaseAgentClaim(
        transaction,
        claimed.agentRow.id,
        input.executionId,
        input.interruptedAt,
      );
    });
  }
}

async function readReplayedRun(
  transaction: LucidPostgresTransaction,
  input: {
    jobRow: AgentJobRow;
    agentRow: typeof agents.$inferSelect;
    userRow: typeof users.$inferSelect;
    executionId: string;
  },
): Promise<AgentJobWorkClaim | undefined> {
  if (
    input.agentRow.status !== 'running'
    || input.agentRow.activeJobId !== input.jobRow.id
    || !input.agentRow.activeWakeId
    || input.agentRow.activeWakeClaimToken !== input.executionId
  ) {
    return undefined;
  }
  const [requestRow] = await transaction.select().from(runRequests).where(and(
    eq(runRequests.id, input.agentRow.activeWakeId),
    eq(runRequests.agentJobId, input.jobRow.id),
    eq(runRequests.state, 'claimed'),
    eq(runRequests.currentExecutionId, input.executionId),
  )).for('update').limit(1);
  return requestRow
    ? await toWorkClaim(transaction, { ...input, requestRow })
    : undefined;
}

async function lockAgentJob(
  transaction: LucidPostgresTransaction,
  agentJobId: string,
): Promise<AgentJobRow | undefined> {
  const [row] = await transaction.select().from(agentJobs).where(
    eq(agentJobs.id, agentJobId),
  ).for('update').limit(1);
  return row;
}

async function readAgentJob(
  transaction: LucidPostgresTransaction,
  agentJobId: string,
): Promise<AgentJob | undefined> {
  const [row] = await transaction.select().from(agentJobs).where(
    eq(agentJobs.id, agentJobId),
  ).limit(1);
  if (!row) {
    return undefined;
  }
  const [preferenceRow] = await transaction.select()
    .from(publishingPreferences)
    .where(eq(publishingPreferences.agentJobId, row.id))
    .limit(1);
  const topics = preferenceRow
    ? await transaction.select({ topic: publishingTopics.topic })
      .from(publishingTopics)
      .where(eq(publishingTopics.agentJobId, row.id))
      .orderBy(asc(publishingTopics.position))
    : [];
  return toAgentJob(
    row,
    preferenceRow
      ? toPublishingPreferences(
        preferenceRow,
        topics.map(({ topic }) => topic),
      )
      : undefined,
  );
}

async function transferInterruptedRun(
  transaction: LucidPostgresTransaction,
  input: {
    jobRow: AgentJobRow;
    agentRow: typeof agents.$inferSelect;
    userRow: typeof users.$inferSelect;
    executionId: string;
    interruptedExecutionId: string;
    recoveredAt: string;
  },
): Promise<AgentJobWorkClaim | undefined> {
  if (
    input.agentRow.status !== 'running'
    || input.agentRow.activeJobId !== input.jobRow.id
    || !input.agentRow.activeWakeId
    || input.agentRow.activeWakeClaimToken !== input.interruptedExecutionId
  ) {
    return undefined;
  }
  const [requestRow] = await transaction.select().from(runRequests).where(and(
    eq(runRequests.id, input.agentRow.activeWakeId),
    eq(runRequests.agentJobId, input.jobRow.id),
    eq(runRequests.state, 'claimed'),
    eq(runRequests.currentExecutionId, input.interruptedExecutionId),
  )).for('update').limit(1);
  if (!requestRow) {
    return undefined;
  }
  const [transferredRequest] = await transaction.update(runRequests).set({
    currentExecutionId: input.executionId,
  }).where(and(
    eq(runRequests.id, requestRow.id),
    eq(runRequests.currentExecutionId, input.interruptedExecutionId),
  )).returning();
  const [transferredAgent] = await transaction.update(agents).set({
    activeWakeClaimToken: input.executionId,
    updatedAt: input.recoveredAt,
  }).where(and(
    eq(agents.id, input.agentRow.id),
    eq(agents.activeWakeClaimToken, input.interruptedExecutionId),
  )).returning();
  if (!transferredRequest || !transferredAgent) {
    throw new Error('Lucid could not atomically recover the Agent job run.');
  }
  return await toWorkClaim(transaction, {
    jobRow: input.jobRow,
    requestRow: transferredRequest,
    agentRow: transferredAgent,
    userRow: input.userRow,
    executionId: input.executionId,
  });
}

type LockedClaim = {
  jobRow: AgentJobRow;
  agentRow: typeof agents.$inferSelect;
  requestRow: RunRequestRow;
};

async function lockClaimedRun(
  transaction: LucidPostgresTransaction,
  input: { agentJobId: string; executionId: string },
): Promise<LockedClaim | undefined> {
  const jobRow = await lockAgentJob(transaction, input.agentJobId);
  if (!jobRow) {
    return undefined;
  }
  const [agentRow] = await transaction.select().from(agents).where(
    eq(agents.id, jobRow.agentId),
  ).for('update').limit(1);
  if (
    !agentRow
    || agentRow.status !== 'running'
    || agentRow.activeJobId !== jobRow.id
    || !agentRow.activeWakeId
    || agentRow.activeWakeClaimToken !== input.executionId
  ) {
    return undefined;
  }
  const [requestRow] = await transaction.select().from(runRequests).where(and(
    eq(runRequests.id, agentRow.activeWakeId),
    eq(runRequests.agentJobId, jobRow.id),
    eq(runRequests.state, 'claimed'),
    eq(runRequests.currentExecutionId, input.executionId),
  )).for('update').limit(1);
  return requestRow ? { jobRow, agentRow, requestRow } : undefined;
}

async function wasSettledByExecution(
  transaction: LucidPostgresTransaction,
  input: { agentJobId: string; executionId: string },
): Promise<boolean> {
  const [row] = await transaction.select({ id: runRequests.id })
    .from(runRequests)
    .where(and(
      eq(runRequests.agentJobId, input.agentJobId),
      eq(runRequests.currentExecutionId, input.executionId),
      eq(runRequests.state, 'settled'),
    )).limit(1);
  return row !== undefined;
}

async function settleClaimedRun(
  transaction: LucidPostgresTransaction,
  claimed: LockedClaim,
  input: {
    outcome: AgentJobRunOutcome;
    outcomeSummary?: string;
    settledAt: string;
  },
): Promise<void> {
  await transaction.update(runRequests).set({
    state: 'settled',
    outcome: input.outcome,
    outcomeSummary: input.outcomeSummary,
    settledAt: input.settledAt,
  }).where(and(
    eq(runRequests.id, claimed.requestRow.id),
    eq(runRequests.state, 'claimed'),
    eq(runRequests.currentExecutionId, claimed.requestRow.currentExecutionId!),
  ));
  await releaseAgentClaim(
    transaction,
    claimed.agentRow.id,
    claimed.requestRow.currentExecutionId!,
    input.settledAt,
  );
}

async function releaseAgentClaim(
  transaction: LucidPostgresTransaction,
  agentId: string,
  executionId: string,
  timestamp: string,
): Promise<void> {
  const [released] = await transaction.update(agents).set({
    status: 'idle',
    activeJobId: null,
    activeWakeId: null,
    activeWakeClaimToken: null,
    activeWakeNumber: null,
    activeWakeHorizon: null,
    updatedAt: timestamp,
  }).where(and(
    eq(agents.id, agentId),
    eq(agents.activeWakeClaimToken, executionId),
  )).returning({ id: agents.id });
  if (!released) {
    throw new AgentJobClaimError();
  }
}

async function readPublishedPostId(
  transaction: LucidPostgresTransaction,
  runRequestId: string,
): Promise<string | undefined> {
  const [post] = await transaction.select({ id: networkPosts.id })
    .from(networkPosts)
    .where(eq(networkPosts.createdByAgentJobRunRequestId, runRequestId))
    .limit(1);
  return post?.id;
}

async function toWorkClaim(
  transaction: LucidPostgresTransaction,
  input: {
    jobRow: AgentJobRow;
    requestRow: RunRequestRow;
    agentRow: typeof agents.$inferSelect;
    userRow: typeof users.$inferSelect;
    executionId: string;
  },
): Promise<AgentJobWorkClaim> {
  const job = await readAgentJob(transaction, input.jobRow.id);
  if (!job) {
    throw new AgentJobNotFoundError();
  }
  const runRequest = await toRunRequest(transaction, input.requestRow);
  return {
    job,
    runRequest,
    agent: toAgent(input.agentRow),
    user: toUser(input.userRow),
    workId: runRequest.id,
    executionId: input.executionId,
  };
}

async function toRunRequest(
  transaction: LucidPostgresTransaction,
  row: RunRequestRow,
): Promise<AgentJobRunRequest> {
  return {
    ...toRunRequestWithoutPost(row),
    publishedPostId: await readPublishedPostId(transaction, row.id),
  };
}

function toRunRequestWithoutPost(row: RunRequestRow): AgentJobRunRequest {
  return {
    id: row.id,
    agentJobId: row.agentJobId,
    state: agentJobRunRequestStateSchema.parse(row.state),
    outcome: row.outcome
      ? agentJobRunOutcomeSchema.parse(row.outcome)
      : undefined,
    currentExecutionId: row.currentExecutionId ?? undefined,
    outcomeSummary: row.outcomeSummary ?? undefined,
    requestedAt: dayjs(row.requestedAt).toISOString(),
    claimedAt: row.claimedAt ? dayjs(row.claimedAt).toISOString() : undefined,
    settledAt: row.settledAt ? dayjs(row.settledAt).toISOString() : undefined,
  };
}

function toAgentJob(
  row: AgentJobRow,
  preferences?: AgentJobPublishingPreferences,
): AgentJob {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    kind: agentJobKindSchema.parse(row.kind),
    name: row.name,
    instructions: row.instructions,
    cadenceMs: row.cadenceMs,
    enabled: row.enabled,
    scheduleMode: agentJobScheduleModeSchema.parse(row.scheduleMode),
    publishingPreferences: preferences,
    createdAt: dayjs(row.createdAt).toISOString(),
    updatedAt: dayjs(row.updatedAt).toISOString(),
  };
}

function toPublishingPreferences(
  row: PublishingPreferencesRow,
  topics: string[],
): AgentJobPublishingPreferences {
  return {
    topics,
    region: row.region ?? undefined,
    intendedAudience: row.intendedAudience ?? undefined,
    tone: row.tone ?? undefined,
    sourceGuidance: row.sourceGuidance ?? undefined,
    updatedAt: dayjs(row.updatedAt).toISOString(),
  };
}

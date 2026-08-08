/**
 * PostgreSQL implementation of Heddle's targeted heartbeat task-store port.
 *
 * Every read-transform-write transition locks one current task row. Heddle's
 * public projector remains the only owner of task lifecycle semantics; this
 * adapter owns database atomicity, execution fencing, leases, and persistence.
 */
import { randomUUID } from 'node:crypto';
import {
  HeartbeatTaskControlPolicy,
  HeartbeatTaskExecutionEligibilityPolicy,
  HeartbeatTaskStateProjector,
  HeartbeatTaskViewProjector,
  type AgentLoopCheckpoint,
  type CreateHeartbeatTaskInput,
  type HeartbeatTaskAdministrationService,
  type HeartbeatTask,
  type HeartbeatTaskExecution,
  type HeartbeatTaskRunRecord,
  type HeartbeatTaskRunRecordEntry,
  type HeartbeatTargetedTaskStore,
  type ListHeartbeatRunViewsOptions,
  type ReadHeartbeatTaskOptions,
  type ReconcileHeartbeatTasksInput,
  type ReconcileHeartbeatTasksResult,
  type UpdateHeartbeatTaskInput,
} from '@roackb2/heddle/advanced';
import dayjs from 'dayjs';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import {
  postgresHeartbeatRunRecords as heartbeatRunRecords,
  postgresHeartbeatTasks as heartbeatTasks,
} from './schema.js';
import type {
  PostgresDatabase,
} from '../../../infrastructure/postgres/database.js';

export type PostgresHeartbeatTaskStoreOptions = {
  database: PostgresDatabase;
  /** Isolates one hosted service or test fixture inside the shared schema. */
  namespace: string;
  /** Must exceed the host's maximum bounded worker attempt duration. */
  executionLeaseMs: number;
};

type HeartbeatTaskRow = typeof heartbeatTasks.$inferSelect;
type HeartbeatRunRecordRow = typeof heartbeatRunRecords.$inferSelect;
type LucidPostgresTransaction = Parameters<
  Parameters<PostgresDatabase['orm']['transaction']>[0]
>[0];

type WriteTaskOptions = {
  leaseExpiresAt: string | null;
  checkpoint?: AgentLoopCheckpoint;
};

/**
 * Durable task authority used by request-routed or queue-routed Heddle workers.
 *
 * The store intentionally does not implement in-process run-request events.
 * Durable requests remain the source of truth and the host dispatcher owns
 * low-latency delivery. Run history is persisted and fully queryable.
 */
export class PostgresHeartbeatTaskStore implements
  HeartbeatTargetedTaskStore,
  HeartbeatTaskAdministrationService
{
  private readonly database: PostgresDatabase;
  private readonly namespace: string;
  private readonly executionLeaseMs: number;

  constructor(options: PostgresHeartbeatTaskStoreOptions) {
    this.database = options.database;
    this.namespace = normalizeNamespace(options.namespace);
    this.executionLeaseMs = requirePositiveSafeInteger(
      options.executionLeaseMs,
      'Heartbeat execution lease',
    );
  }

  async listTasks(): Promise<HeartbeatTask[]> {
    const rows = await this.database.orm
      .select()
      .from(heartbeatTasks)
      .where(eq(heartbeatTasks.namespace, this.namespace))
      .orderBy(asc(heartbeatTasks.taskId));
    return rows.map((row) => this.taskFromRow(row));
  }

  async loadTask(taskId: string): Promise<HeartbeatTask | undefined> {
    const [row] = await this.database.orm
      .select()
      .from(heartbeatTasks)
      .where(this.taskIdentity(taskId))
      .limit(1);
    return row ? this.taskFromRow(row) : undefined;
  }

  async saveTask(task: HeartbeatTask): Promise<void> {
    const normalized = HeartbeatTaskStateProjector.normalize(task);
    const projection = this.persistenceProjection(
      normalized,
      this.leaseFromTask(normalized),
    );
    const createdAt = dayjs().toISOString();

    await this.database.orm
      .insert(heartbeatTasks)
      .values({
        namespace: this.namespace,
        taskId: normalized.id,
        ...projection,
        createdAt,
      })
      .onConflictDoUpdate({
        target: [heartbeatTasks.namespace, heartbeatTasks.taskId],
        set: {
          ...projection,
          version: sql`${heartbeatTasks.version} + 1`,
        },
      });
  }

  async loadCheckpoint(
    task: HeartbeatTask,
  ): Promise<AgentLoopCheckpoint | undefined> {
    const [row] = await this.database.orm
      .select({ checkpoint: heartbeatTasks.checkpoint })
      .from(heartbeatTasks)
      .where(this.taskIdentity(task.id))
      .limit(1);
    return row?.checkpoint ?? undefined;
  }

  async saveCheckpoint(
    task: HeartbeatTask,
    checkpoint: AgentLoopCheckpoint,
  ): Promise<void> {
    const saved = await this.database.orm
      .update(heartbeatTasks)
      .set({
        checkpoint,
        updatedAt: dayjs().toISOString(),
        version: sql`${heartbeatTasks.version} + 1`,
      })
      .where(this.taskIdentity(task.id))
      .returning({ taskId: heartbeatTasks.taskId });
    if (saved.length === 0) {
      throw new Error(`Heartbeat task not found: ${task.id}`);
    }
  }

  async requestTaskRun(
    taskId: string,
    options: Parameters<HeartbeatTargetedTaskStore['requestTaskRun']>[1] = {},
  ) {
    return await this.database.orm.transaction(async (transaction) => {
      const row = await this.lockTask(transaction, taskId);
      if (!row) {
        throw new Error(`Heartbeat task not found: ${taskId}`);
      }
      const task = this.taskFromRow(row);
      const projected = HeartbeatTaskControlPolicy.requestTaskRun({
        task,
        options,
        now: dayjs().toDate(),
      });
      await this.writeTask(transaction, projected.task, {
        leaseExpiresAt: row.leaseExpiresAt,
      });
      return projected;
    });
  }

  async claimTaskExecution(
    input: Parameters<HeartbeatTargetedTaskStore['claimTaskExecution']>[0],
  ) {
    const claimedAt = requireDate(input.claimedAt, 'Heartbeat claim timestamp');
    return await this.database.orm.transaction(async (transaction) => {
      const row = await this.lockTask(transaction, input.taskId);
      if (!row) {
        return { status: 'not-found' } as const;
      }
      const task = this.taskFromRow(row);
      if (!task.enabled) {
        return { status: 'disabled' } as const;
      }
      if (task.state?.status === 'running') {
        return { status: 'busy' } as const;
      }
      if (input.claimMode === 'due') {
        const eligibility = HeartbeatTaskExecutionEligibilityPolicy.evaluate(
          task,
          claimedAt,
        );
        if (!eligibility.eligible) {
          return eligibility.reason === 'not-due'
            ? { status: 'not-due', task } as const
            : { status: eligibility.reason } as const;
        }
      }

      const runningTask = HeartbeatTaskStateProjector.markRunning({
        task,
        now: claimedAt,
        loadedCheckpoint: input.loadedCheckpoint,
        execution: input.execution,
      });
      await this.writeTask(transaction, runningTask, {
        leaseExpiresAt: this.leaseExpiresAt(claimedAt),
      });
      return { status: 'claimed', task: runningTask } as const;
    });
  }

  async completeTaskExecution(
    input: Parameters<HeartbeatTargetedTaskStore['completeTaskExecution']>[0],
  ) {
    const completedAt = requireDate(
      input.completedAt,
      'Heartbeat completion timestamp',
    );
    return await this.database.orm.transaction(async (transaction) => {
      const row = await this.lockTask(transaction, input.taskId);
      if (!row || !this.executionMatches(row, input.execution)) {
        return { status: 'claim-lost' } as const;
      }
      if (input.signal?.aborted) {
        return { status: 'cancelled' } as const;
      }

      const task = this.taskFromRow(row);
      const execution = requireCurrentExecution(task, input.execution);
      const nextTask = HeartbeatTaskStateProjector.afterResult({
        task,
        execution,
        result: input.result,
        now: completedAt,
        loadedCheckpoint: input.loadedCheckpoint,
      });
      const outcome = nextTask.state?.lastExecution;
      const record: HeartbeatTaskRunRecord = {
        task: nextTask,
        result: input.result,
        loadedCheckpoint: input.loadedCheckpoint,
        outcome: outcome?.kind === 'agent'
          && outcome.executionId === input.execution.executionId
          ? outcome
          : {
            kind: 'agent',
            executionId: input.execution.executionId,
            summary: input.result.summary,
            finishedAt: input.result.state.finishedAt,
            runRequestGeneration: execution.runRequestGeneration,
          },
      };
      await this.writeTask(transaction, nextTask, {
        leaseExpiresAt: null,
        checkpoint: input.checkpoint,
      });
      await this.insertRunRecord(transaction, record);
      return { status: 'saved', task: nextTask, record } as const;
    });
  }

  async failTaskExecution(
    input: Parameters<HeartbeatTargetedTaskStore['failTaskExecution']>[0],
  ) {
    const failedAt = requireDate(input.failedAt, 'Heartbeat failure timestamp');
    return await this.database.orm.transaction(async (transaction) => {
      const row = await this.lockTask(transaction, input.taskId);
      if (!row || !this.executionMatches(row, input.execution)) {
        return { status: 'claim-lost' } as const;
      }
      if (input.signal?.aborted) {
        return { status: 'cancelled' } as const;
      }

      const task = this.taskFromRow(row);
      const nextTask = HeartbeatTaskStateProjector.afterFailure({
        task,
        execution: requireCurrentExecution(task, input.execution),
        error: input.error,
        now: failedAt,
        retryMs: input.retryMs,
      });
      await this.writeTask(transaction, nextTask, { leaseExpiresAt: null });
      return { status: 'saved', task: nextTask } as const;
    });
  }

  async recordTaskExecutionOutcome(
    input: Parameters<
      HeartbeatTargetedTaskStore['recordTaskExecutionOutcome']
    >[0],
  ) {
    const finishedAt = requireDate(
      input.finishedAt,
      'Heartbeat outcome timestamp',
    );
    return await this.database.orm.transaction(async (transaction) => {
      const row = await this.lockTask(transaction, input.taskId);
      if (!row || !this.executionMatches(row, input.execution)) {
        return { status: 'claim-lost' } as const;
      }
      if (input.signal?.aborted) {
        return { status: 'cancelled' } as const;
      }

      const task = this.taskFromRow(row);
      const execution = requireCurrentExecution(task, input.execution);
      const project = {
        skipped: () => HeartbeatTaskStateProjector.afterSkip({
          task,
          execution,
          summary: input.summary,
          now: finishedAt,
        }),
        cancelled: () => HeartbeatTaskStateProjector.afterCancellation({
          task,
          execution,
          summary: input.summary,
          reason: input.reason,
          now: finishedAt,
        }),
        retry: () => HeartbeatTaskStateProjector.afterHandlerRetry({
          task,
          execution,
          summary: input.summary,
          agentRunId: requireText(input.agentRunId, 'Heartbeat retry agent run id'),
          retryMs: requireNumber(input.retryMs, 'Heartbeat retry delay'),
          now: finishedAt,
        }),
        blocked: () => HeartbeatTaskStateProjector.afterHandlerBlock({
          task,
          execution,
          summary: input.summary,
          agentRunId: requireText(input.agentRunId, 'Heartbeat blocked agent run id'),
          now: finishedAt,
        }),
      } satisfies Record<typeof input.kind, () => HeartbeatTask>;
      const nextTask = project[input.kind]();
      const outcome = nextTask.state?.lastExecution;
      if (!outcome || outcome.kind !== input.kind) {
        throw new Error(
          `Heartbeat task ${input.taskId} did not project a ${input.kind} execution outcome.`,
        );
      }
      const record: HeartbeatTaskRunRecord = { task: nextTask, outcome };
      await this.writeTask(transaction, nextTask, { leaseExpiresAt: null });
      await this.insertRunRecord(transaction, record);
      return { status: 'saved', task: nextTask, record } as const;
    });
  }

  async recoverInterruptedTasks(
    input: Parameters<HeartbeatTargetedTaskStore['recoverInterruptedTasks']>[0],
  ) {
    const recoveredAt = requireDate(
      input.recoveredAt,
      'Heartbeat recovery timestamp',
    );
    return await this.database.orm.transaction(async (transaction) => {
      const rows = await transaction
        .select()
        .from(heartbeatTasks)
        .where(and(
          eq(heartbeatTasks.namespace, this.namespace),
          eq(heartbeatTasks.status, 'running'),
          lte(heartbeatTasks.leaseExpiresAt, recoveredAt.toISOString()),
        ))
        .for('update', { skipLocked: true });
      const recovered = [];
      for (const row of rows) {
        const projected = HeartbeatTaskStateProjector.afterRecovery({
          task: this.taskFromRow(row),
          now: recoveredAt,
          reason: input.reason,
        });
        await this.writeTask(transaction, projected.task, {
          leaseExpiresAt: null,
        });
        recovered.push(projected);
      }
      return recovered;
    });
  }

  async saveRunRecord(record: HeartbeatTaskRunRecord): Promise<void> {
    await this.insertRunRecord(this.database.orm, record);
  }

  async listRunRecords(
    options: Parameters<
      NonNullable<HeartbeatTargetedTaskStore['listRunRecords']>
    >[0] = {},
  ): Promise<HeartbeatTaskRunRecordEntry[]> {
    const limit = normalizeLimit(options.limit);
    const predicate = options.taskId
      ? and(
        eq(heartbeatRunRecords.namespace, this.namespace),
        eq(heartbeatRunRecords.taskId, options.taskId),
      )
      : eq(heartbeatRunRecords.namespace, this.namespace);
    const query = this.database.orm
      .select()
      .from(heartbeatRunRecords)
      .where(predicate)
      .orderBy(desc(heartbeatRunRecords.createdAt), desc(heartbeatRunRecords.id));
    const rows = limit ? await query.limit(limit) : await query;
    return rows.map((row) => this.runRecordEntry(row));
  }

  async loadRunRecord(
    id: string,
  ): Promise<HeartbeatTaskRunRecordEntry | undefined> {
    const [row] = await this.database.orm
      .select()
      .from(heartbeatRunRecords)
      .where(and(
        eq(heartbeatRunRecords.namespace, this.namespace),
        or(
          eq(heartbeatRunRecords.id, id),
          eq(heartbeatRunRecords.executionId, id),
          eq(heartbeatRunRecords.runId, id),
        ),
      ))
      .orderBy(desc(heartbeatRunRecords.createdAt))
      .limit(1);
    return row ? this.runRecordEntry(row) : undefined;
  }

  async listTaskViews() {
    return HeartbeatTaskViewProjector.projectTasks(await this.listTasks());
  }

  async listRunViews(options: ListHeartbeatRunViewsOptions = {}) {
    return (await this.listRunRecords(options))
      .map((run) => HeartbeatTaskViewProjector.projectRun(run));
  }

  async createTask(input: CreateHeartbeatTaskInput) {
    return await this.database.orm.transaction(async (transaction) => {
      await this.lockTaskCatalog(transaction);
      const currentTasks = (await this.lockNamespaceTasks(transaction))
        .map((row) => this.taskFromRow(row));
      const task = HeartbeatTaskControlPolicy.createTask({
        input,
        existingTasks: currentTasks,
        now: dayjs().toDate(),
      });
      await this.insertTask(transaction, task);
      return HeartbeatTaskViewProjector.projectTask(task);
    });
  }

  async reconcileTasks(
    input: ReconcileHeartbeatTasksInput,
  ): Promise<ReconcileHeartbeatTasksResult> {
    return await this.database.orm.transaction(async (transaction) => {
      await this.lockTaskCatalog(transaction);
      const currentTasks = (await this.lockNamespaceTasks(transaction))
        .map((row) => this.taskFromRow(row));
      const reconciliation = HeartbeatTaskControlPolicy.reconcileTasks({
        currentTasks,
        input,
      });

      for (const task of reconciliation.created) {
        await this.insertTask(transaction, task);
      }
      await this.deleteTasks(
        transaction,
        reconciliation.deleted.map((task) => task.id),
      );
      return reconciliation;
    });
  }

  async updateTask(taskId: string, input: UpdateHeartbeatTaskInput) {
    const task = await this.updateStoredTask(taskId, (currentTask) => (
      HeartbeatTaskControlPolicy.updateTask({
        task: currentTask,
        input,
        now: dayjs().toDate(),
      })
    ));
    return HeartbeatTaskViewProjector.projectTask(task);
  }

  async deleteTask(taskId: string) {
    const task = await this.database.orm.transaction(async (transaction) => {
      const row = await this.lockTask(transaction, taskId);
      if (!row) {
        throw new Error(`Heartbeat task not found: ${taskId}`);
      }
      const currentTask = this.taskFromRow(row);
      HeartbeatTaskControlPolicy.assertTaskCanBeDeleted(currentTask);
      await this.deleteTasks(transaction, [taskId]);
      return currentTask;
    });
    return HeartbeatTaskViewProjector.projectTask(task);
  }

  async resumeTask(taskId: string) {
    const task = await this.updateStoredTask(taskId, (currentTask) => (
      HeartbeatTaskControlPolicy.resumeTask({
        task: currentTask,
        now: dayjs().toDate(),
      })
    ));
    return HeartbeatTaskViewProjector.projectTask(task);
  }

  async readTask(taskId: string, options: ReadHeartbeatTaskOptions = {}) {
    const task = await this.requireTask(taskId);
    const runs = await this.listRunViews({
      taskId,
      limit: options.runLimit ?? 50,
    });
    return {
      task: HeartbeatTaskViewProjector.projectTask(task),
      runs,
    };
  }

  async readRun(taskId: string, runId: string) {
    await this.requireTask(taskId);
    const run = runId === 'latest'
      ? (await this.listRunRecords({ taskId, limit: 1 }))[0]
      : await this.loadRunRecord(runId);
    return run?.taskId === taskId
      ? HeartbeatTaskViewProjector.projectRun(run)
      : undefined;
  }

  async setTaskEnabled(taskId: string, enabled: boolean) {
    const task = await this.updateStoredTask(taskId, (currentTask) => (
      HeartbeatTaskControlPolicy.setTaskEnabled({
        task: currentTask,
        enabled,
        now: dayjs().toDate(),
      })
    ));
    return HeartbeatTaskViewProjector.projectTask(task);
  }

  async triggerTaskRun(taskId: string) {
    const result = await this.requestTaskRun(taskId, {
      reason: 'manual-trigger',
    });
    return HeartbeatTaskViewProjector.projectTask(result.task);
  }

  async requireTask(taskId: string): Promise<HeartbeatTask> {
    const task = await this.loadTask(taskId);
    if (!task) {
      throw new Error(`Heartbeat task not found: ${taskId}`);
    }
    return task;
  }

  private taskIdentity(taskId: string) {
    return and(
      eq(heartbeatTasks.namespace, this.namespace),
      eq(heartbeatTasks.taskId, taskId),
    );
  }

  private async lockTask(
    transaction: LucidPostgresTransaction,
    taskId: string,
  ): Promise<HeartbeatTaskRow | undefined> {
    const [row] = await transaction
      .select()
      .from(heartbeatTasks)
      .where(this.taskIdentity(taskId))
      .for('update')
      .limit(1);
    return row;
  }

  /** Serializes namespace-wide create and reconciliation membership changes. */
  private async lockTaskCatalog(
    transaction: LucidPostgresTransaction,
  ): Promise<void> {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(
        hashtext('lucid-heddle-task-catalog'),
        hashtext(${this.namespace})
      )`,
    );
  }

  private async lockNamespaceTasks(
    transaction: LucidPostgresTransaction,
  ): Promise<HeartbeatTaskRow[]> {
    return await transaction
      .select()
      .from(heartbeatTasks)
      .where(eq(heartbeatTasks.namespace, this.namespace))
      .orderBy(asc(heartbeatTasks.taskId))
      .for('update');
  }

  private async insertTask(
    transaction: LucidPostgresTransaction,
    task: HeartbeatTask,
  ): Promise<void> {
    const normalized = HeartbeatTaskStateProjector.normalize(task);
    await transaction.insert(heartbeatTasks).values({
      namespace: this.namespace,
      taskId: normalized.id,
      ...this.persistenceProjection(normalized, this.leaseFromTask(normalized)),
      createdAt: dayjs().toISOString(),
    });
  }

  private async deleteTasks(
    transaction: LucidPostgresTransaction,
    taskIds: string[],
  ): Promise<void> {
    if (taskIds.length === 0) {
      return;
    }
    const predicate = and(
      eq(heartbeatTasks.namespace, this.namespace),
      inArray(heartbeatTasks.taskId, taskIds),
    );
    await transaction.delete(heartbeatRunRecords).where(and(
      eq(heartbeatRunRecords.namespace, this.namespace),
      inArray(heartbeatRunRecords.taskId, taskIds),
    ));
    await transaction.delete(heartbeatTasks).where(predicate);
  }

  private async updateStoredTask(
    taskId: string,
    update: (task: HeartbeatTask) => HeartbeatTask,
  ): Promise<HeartbeatTask> {
    return await this.database.orm.transaction(async (transaction) => {
      const row = await this.lockTask(transaction, taskId);
      if (!row) {
        throw new Error(`Heartbeat task not found: ${taskId}`);
      }
      const task = update(this.taskFromRow(row));
      await this.writeTask(transaction, task, {
        leaseExpiresAt: row.leaseExpiresAt,
      });
      return task;
    });
  }

  private async writeTask(
    transaction: LucidPostgresTransaction,
    task: HeartbeatTask,
    options: WriteTaskOptions,
  ): Promise<void> {
    const projection = this.persistenceProjection(task, options.leaseExpiresAt);
    const checkpoint = options.checkpoint
      ? { checkpoint: options.checkpoint }
      : {};
    const updated = await transaction
      .update(heartbeatTasks)
      .set({
        ...projection,
        ...checkpoint,
        version: sql`${heartbeatTasks.version} + 1`,
      })
      .where(this.taskIdentity(task.id))
      .returning({ taskId: heartbeatTasks.taskId });
    if (updated.length === 0) {
      throw new Error(`Heartbeat task not found: ${task.id}`);
    }
  }

  private persistenceProjection(
    task: HeartbeatTask,
    leaseExpiresAt: string | null,
  ) {
    const normalized = HeartbeatTaskStateProjector.normalize(task);
    const status = normalized.state?.status ?? 'idle';
    const execution = normalized.state?.execution;
    if (status === 'running' && !execution) {
      throw new Error(
        `Running heartbeat task ${normalized.id} is missing its execution identity.`,
      );
    }
    if (status === 'running' && !leaseExpiresAt) {
      throw new Error(
        `Running heartbeat task ${normalized.id} is missing its execution lease.`,
      );
    }

    return {
      task: normalized,
      enabled: normalized.enabled,
      status,
      nextRunAt: normalizeOptionalTimestamp(
        normalized.schedule.nextRunAt,
        `Heartbeat task ${normalized.id} next-run timestamp`,
      ),
      executionId: status === 'running' ? execution?.executionId : null,
      executionOwnerId: status === 'running' ? execution?.ownerId : null,
      leaseExpiresAt: status === 'running' ? leaseExpiresAt : null,
      updatedAt: normalizeOptionalTimestamp(
        normalized.state?.updatedAt,
        `Heartbeat task ${normalized.id} update timestamp`,
      ) ?? dayjs().toISOString(),
    };
  }

  private taskFromRow(row: HeartbeatTaskRow): HeartbeatTask {
    const task = HeartbeatTaskStateProjector.normalize(row.task);
    if (task.id !== row.taskId) {
      throw new Error(
        `Heartbeat task row ${row.taskId} contains mismatched task ${task.id}.`,
      );
    }
    const execution = task.state?.execution;
    const consistent = row.status === (task.state?.status ?? 'idle')
      && row.enabled === task.enabled
      && row.executionId === (execution?.executionId ?? null)
      && row.executionOwnerId === (execution?.ownerId ?? null);
    if (!consistent) {
      throw new Error(`Heartbeat task row ${row.taskId} has inconsistent fencing columns.`);
    }
    return task;
  }

  private executionMatches(
    row: HeartbeatTaskRow,
    execution: HeartbeatTaskExecution,
  ): boolean {
    return row.status === 'running'
      && row.executionId === execution.executionId
      && row.executionOwnerId === execution.ownerId
      && row.task.state?.execution?.executionId === execution.executionId
      && row.task.state.execution.ownerId === execution.ownerId;
  }

  private leaseFromTask(task: HeartbeatTask): string | null {
    if (task.state?.status !== 'running') {
      return null;
    }
    const claimedAt = requireDate(
      task.state.execution?.claimedAt,
      `Heartbeat task ${task.id} claim timestamp`,
    );
    return this.leaseExpiresAt(claimedAt);
  }

  private leaseExpiresAt(claimedAt: Date): string {
    return dayjs(claimedAt)
      .add(this.executionLeaseMs, 'millisecond')
      .toISOString();
  }

  private async insertRunRecord(
    database: Pick<PostgresDatabase['orm'], 'insert'>,
    record: HeartbeatTaskRunRecord,
  ): Promise<void> {
    const details = resolveRunRecord(record);
    await database.insert(heartbeatRunRecords).values({
      namespace: this.namespace,
      id: randomUUID(),
      taskId: record.task.id,
      workspaceId: record.task.workspaceId,
      executionId: details.executionId,
      runId: record.result?.state.runId,
      createdAt: requireDate(
        details.finishedAt,
        'Heartbeat run-record completion timestamp',
      ).toISOString(),
      record,
    });
  }

  private runRecordEntry(row: HeartbeatRunRecordRow): HeartbeatTaskRunRecordEntry {
    return {
      id: row.id,
      path: `heddle-postgres://${encodeURIComponent(this.namespace)}/runs/${row.id}`,
      taskId: row.taskId,
      workspaceId: row.workspaceId ?? undefined,
      executionId: row.executionId,
      runId: row.runId ?? undefined,
      createdAt: row.createdAt,
      record: row.record,
    };
  }
}

function normalizeNamespace(namespace: string): string {
  const normalized = namespace.trim();
  if (!normalized || normalized.length > 200) {
    throw new Error('Heartbeat store namespace must contain 1 to 200 characters.');
  }
  return normalized;
}

function requirePositiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function requireDate(value: Date | string | undefined, label: string): Date {
  const parsed = dayjs(value);
  if (!parsed.isValid()) {
    throw new Error(`${label} must be valid.`);
  }
  return parsed.toDate();
}

function normalizeOptionalTimestamp(
  value: string | undefined,
  label: string,
): string | null {
  return value === undefined ? null : requireDate(value, label).toISOString();
}

function requireCurrentExecution(
  task: HeartbeatTask,
  fallback: HeartbeatTaskExecution,
): HeartbeatTaskExecution {
  return task.state?.execution ?? fallback;
}

function requireText(value: string | undefined, label: string): string {
  if (!value) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function requireNumber(value: number | undefined, label: string): number {
  if (value === undefined) {
    throw new Error(`${label} is required.`);
  }
  return value;
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) {
    return undefined;
  }
  return requirePositiveSafeInteger(limit, 'Heartbeat run-record limit');
}

function resolveRunRecord(record: HeartbeatTaskRunRecord) {
  if (record.outcome) {
    return record.outcome;
  }
  if (!record.result) {
    throw new Error(`Heartbeat record for task ${record.task.id} has no outcome.`);
  }
  return {
    executionId: record.result.state.runId,
    finishedAt: record.result.state.finishedAt,
  };
}

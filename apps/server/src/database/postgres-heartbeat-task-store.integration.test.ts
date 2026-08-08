/**
 * Real PostgreSQL certification for Lucid's Heddle task-store adapter.
 *
 * Set LUCID_POSTGRES_TEST_URL to an isolated database. Every canonical Heddle
 * scenario uses two independent pools sharing one opaque namespace, then
 * removes only rows created for that namespace.
 */
import { randomUUID } from 'node:crypto';
import {
  HeartbeatTaskStateProjector,
  type HeartbeatTask,
  type HeartbeatTaskExecution,
  type HeartbeatTargetedTaskStore,
} from '@roackb2/heddle/advanced';
import {
  HeartbeatTaskStoreConformance,
  type HeartbeatTaskStoreConformanceHarness,
} from '@roackb2/heddle/heartbeat/testing';
import dayjs from 'dayjs';
import { and, eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { LucidPostgresDatabase } from './postgres-database.js';
import {
  POSTGRES_MIGRATIONS_ROOT,
  POSTGRES_TEST_DATABASE_URL,
} from './postgres-test-harness.js';
import {
  postgresHeartbeatRunRecords as heartbeatRunRecords,
  postgresHeartbeatTasks as heartbeatTasks,
} from './postgres-heartbeat-schema.js';
import { PostgresHeartbeatTaskStore } from './postgres-heartbeat-task-store.js';

const NOW = new Date('2026-08-08T08:00:00.000Z');
const TEST_EXECUTION_LEASE_MS = 60_000;

describe('PostgreSQL heartbeat persistence', () => {
  const databasesByNamespace = new Map<string, LucidPostgresDatabase[]>();
  const databaseByStore = new WeakMap<
    HeartbeatTargetedTaskStore,
    LucidPostgresDatabase
  >();
  let migrationDatabase: LucidPostgresDatabase | undefined;

  const harness: HeartbeatTaskStoreConformanceHarness = {
    createStore: (namespace) => {
      const database = new LucidPostgresDatabase({
        url: POSTGRES_TEST_DATABASE_URL,
        maxConnections: 2,
        applicationName: 'lucid-heartbeat-store-conformance',
      });
      const store = new PostgresHeartbeatTaskStore({
        database,
        namespace,
        executionLeaseMs: TEST_EXECUTION_LEASE_MS,
      });
      databasesByNamespace.set(namespace, [
        ...(databasesByNamespace.get(namespace) ?? []),
        database,
      ]);
      databaseByStore.set(store, database);
      return store;
    },
    cleanupNamespace: async (namespace) => {
      const databases = databasesByNamespace.get(namespace) ?? [];
      const [database] = databases;
      try {
        if (database) {
          await database.orm.delete(heartbeatRunRecords).where(
            eq(heartbeatRunRecords.namespace, namespace),
          );
          await database.orm.delete(heartbeatTasks).where(
            eq(heartbeatTasks.namespace, namespace),
          );
        }
      } finally {
        await Promise.all(databases.map(async (entry) => entry.close()));
        databasesByNamespace.delete(namespace);
      }
    },
    now: () => NOW,
    makeExecutionRecoverable: async ({
      namespace,
      store,
      task,
      execution,
      recoverAt,
    }) => {
      const database = databaseByStore.get(store);
      if (!database) {
        throw new Error('Conformance store database was not registered.');
      }
      const runningTask = asRunningTask(task, execution);
      const updated = await database.orm
        .update(heartbeatTasks)
        .set({
          task: runningTask,
          enabled: runningTask.enabled,
          status: 'running',
          nextRunAt: runningTask.schedule.nextRunAt,
          executionId: execution.executionId,
          executionOwnerId: execution.ownerId,
          leaseExpiresAt: dayjs(recoverAt).subtract(1, 'millisecond').toISOString(),
          updatedAt: runningTask.state?.updatedAt ?? recoverAt.toISOString(),
        })
        .where(and(
          eq(heartbeatTasks.namespace, namespace),
          eq(heartbeatTasks.taskId, task.id),
        ))
        .returning({ taskId: heartbeatTasks.taskId });
      if (updated.length !== 1) {
        throw new Error(`Conformance task not found: ${task.id}`);
      }
    },
    capabilities: { runHistory: true },
  };

  beforeAll(async () => {
    migrationDatabase = new LucidPostgresDatabase({
      url: POSTGRES_TEST_DATABASE_URL,
      maxConnections: 1,
      applicationName: 'lucid-heartbeat-store-migrator',
    });
    await migrationDatabase.migrate(POSTGRES_MIGRATIONS_ROOT);
  });

  afterAll(async () => {
    await Promise.all(
      [...databasesByNamespace.keys()].map(async (namespace) => {
        await harness.cleanupNamespace(namespace);
      }),
    );
    await migrationDatabase?.close();
  });

  describe('PostgreSQL Heddle targeted task store conformance', () => {
    HeartbeatTaskStoreConformance.createScenarios(harness).forEach((scenario) => {
      it(scenario.name, scenario.run, 30_000);
    });
  });

  describe('PostgreSQL Heddle task administration', () => {
    let namespace: string;
    let first: PostgresHeartbeatTaskStore;
    let second: PostgresHeartbeatTaskStore;

    beforeEach(async () => {
      namespace = `administration-${randomUUID()}`;
      first = await harness.createStore(namespace) as PostgresHeartbeatTaskStore;
      second = await harness.createStore(namespace) as PostgresHeartbeatTaskStore;
    });

    afterEach(async () => {
      await harness.cleanupNamespace(namespace);
    });

    it('serializes conflicting task creation across API processes', async () => {
      const input = {
        id: 'representative:conflict',
        task: 'Run exactly one representative-agent cycle.',
        intervalMs: 60_000,
        defer: false,
      };
      const attempts = await Promise.allSettled([
        first.createTask(input),
        second.createTask(input),
      ]);

      expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      expect(await first.listTaskViews()).toHaveLength(1);
    });

    it('applies update, enablement, trigger, and resume policy to the latest row', async () => {
      const taskId = 'representative:controlled';
      await first.createTask({
        id: taskId,
        task: 'Inspect the latest mailbox.',
        intervalMs: 60_000,
        defer: false,
      });

      const updated = await second.updateTask(taskId, {
        name: 'Controlled representative',
        intervalMs: 120_000,
      });
      expect(updated).toMatchObject({
        name: 'Controlled representative',
        schedule: { intervalMs: 120_000 },
      });
      expect(await first.setTaskEnabled(taskId, false)).toMatchObject({
        enabled: false,
        state: { status: 'idle' },
      });
      expect(await second.setTaskEnabled(taskId, true)).toMatchObject({
        enabled: true,
        state: { status: 'waiting' },
      });
      expect(await first.triggerTaskRun(taskId)).toMatchObject({
        state: { runRequest: { pending: true } },
      });

      const execution = createExecution('controlled');
      expect(await second.claimTaskExecution({
        taskId,
        execution,
        loadedCheckpoint: false,
        claimedAt: new Date(execution.claimedAt),
        claimMode: 'due',
      })).toMatchObject({ status: 'claimed' });
      expect(await first.setTaskEnabled(taskId, false)).toMatchObject({
        enabled: false,
        state: { status: 'running' },
      });
      expect(await second.recordTaskExecutionOutcome({
        taskId,
        execution,
        kind: 'skipped',
        summary: 'No mailbox work remained.',
        finishedAt: dayjs().toDate(),
      })).toMatchObject({ status: 'saved' });
      expect(await first.resumeTask(taskId)).toMatchObject({
        enabled: true,
        state: { status: 'waiting' },
      });
    });

    it('rejects deletion while claimed and removes task history after settlement', async () => {
      const taskId = 'representative:deletion';
      await first.createTask({
        id: taskId,
        task: 'Create one inspectable history entry.',
        intervalMs: 60_000,
        defer: false,
      });
      const execution = createExecution('deletion');
      await second.claimTaskExecution({
        taskId,
        execution,
        loadedCheckpoint: false,
        claimedAt: new Date(execution.claimedAt),
        claimMode: 'due',
      });

      await expect(first.deleteTask(taskId)).rejects.toThrow('is running');
      await second.recordTaskExecutionOutcome({
        taskId,
        execution,
        kind: 'skipped',
        summary: 'History was persisted before deletion.',
        finishedAt: dayjs().toDate(),
      });
      const detail = await first.readTask(taskId);
      expect(detail.runs).toHaveLength(1);
      expect(await second.readRun(taskId, 'latest')).toMatchObject({
        taskId,
        executionId: execution.executionId,
      });

      expect(await first.deleteTask(taskId)).toMatchObject({ taskId });
      expect(await second.loadTask(taskId)).toBeUndefined();
      expect(await second.listRunRecords({ taskId })).toEqual([]);
    });

    it('reconciles one task-id namespace while preserving a running obsolete task', async () => {
      const keepId = 'representative:keep';
      const idleId = 'representative:obsolete-idle';
      const runningId = 'representative:obsolete-running';
      const unrelatedId = 'maintenance:unrelated';
      await Promise.all([
        first.createTask({ id: keepId, name: 'Stored name', task: 'Keep.', defer: false }),
        first.createTask({ id: idleId, task: 'Delete while idle.', defer: false }),
        first.createTask({ id: runningId, task: 'Preserve while running.', defer: false }),
        first.createTask({ id: unrelatedId, task: 'Stay outside reconciliation.', defer: false }),
      ]);
      const execution = createExecution('reconcile-running');
      await second.claimTaskExecution({
        taskId: runningId,
        execution,
        loadedCheckpoint: false,
        claimedAt: new Date(execution.claimedAt),
        claimMode: 'due',
      });
      const newTask = createDesiredTask('representative:new');
      const reconciliation = await first.reconcileTasks({
        namespace: 'representative:',
        desired: [
          { ...createDesiredTask(keepId), name: 'Desired name must not overwrite' },
          newTask,
        ],
      });

      expect(reconciliation.created.map(({ id }) => id)).toEqual([newTask.id]);
      expect(reconciliation.deleted.map(({ id }) => id)).toEqual([idleId]);
      expect(reconciliation.preservedRunning.map(({ id }) => id)).toEqual([runningId]);
      expect(await first.loadTask(idleId)).toBeUndefined();
      expect(await first.loadTask(runningId)).toMatchObject({
        state: { execution: { executionId: execution.executionId } },
      });
      expect(await first.loadTask(keepId)).toMatchObject({ name: 'Stored name' });
      expect(await first.loadTask(unrelatedId)).toBeDefined();

      await second.recordTaskExecutionOutcome({
        taskId: runningId,
        execution,
        kind: 'skipped',
        summary: 'Running reconciliation work settled.',
        finishedAt: dayjs().toDate(),
      });
      const afterSettlement = await first.reconcileTasks({
        namespace: 'representative:',
        desired: [createDesiredTask(keepId), newTask],
      });
      expect(afterSettlement.deleted.map(({ id }) => id)).toEqual([runningId]);
      expect(await first.loadTask(runningId)).toBeUndefined();
    });

    it('preserves both an operator update and a concurrent execution claim', async () => {
      const taskId = 'representative:update-claim-race';
      await first.createTask({
        id: taskId,
        task: 'Race one claim with one operator update.',
        intervalMs: 60_000,
        defer: false,
      });
      const execution = createExecution('update-claim-race');

      const [updated, claimed] = await Promise.all([
        first.updateTask(taskId, { name: 'Updated without losing claim' }),
        second.claimTaskExecution({
          taskId,
          execution,
          loadedCheckpoint: false,
          claimedAt: new Date(execution.claimedAt),
          claimMode: 'any',
        }),
      ]);

      expect(updated.name).toBe('Updated without losing claim');
      expect(claimed.status).toBe('claimed');
      expect(await first.loadTask(taskId)).toMatchObject({
        name: 'Updated without losing claim',
        state: {
          status: 'running',
          execution: { executionId: execution.executionId },
        },
      });
    });
  });
});

function asRunningTask(
  task: HeartbeatTask,
  execution: HeartbeatTaskExecution,
): HeartbeatTask {
  return HeartbeatTaskStateProjector.markRunning({
    task,
    execution,
    loadedCheckpoint: false,
    now: new Date(execution.claimedAt),
  });
}

function createExecution(label: string): HeartbeatTaskExecution {
  return {
    executionId: `${label}-${randomUUID()}`,
    ownerId: `owner-${randomUUID()}`,
    claimedAt: dayjs().toISOString(),
  };
}

function createDesiredTask(id: string): HeartbeatTask {
  return {
    id,
    task: `Process ${id}.`,
    enabled: true,
    continuationMode: 'operator',
    schedule: {
      intervalMs: 60_000,
      nextRunAt: dayjs().subtract(1, 'second').toISOString(),
    },
    state: {
      status: 'waiting',
      updatedAt: dayjs().toISOString(),
    },
  };
}

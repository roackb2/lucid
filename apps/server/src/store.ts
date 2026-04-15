import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  createFileHeartbeatTaskStore,
  heartbeatRunViewToLucidMessages,
  heartbeatTaskStatusToLucidStatus,
  heartbeatTaskViewToLucidMessages,
  listHeartbeatRunViews,
  listHeartbeatTaskViews,
  runDueHeartbeatTasks,
  type HeartbeatTask,
  type HeartbeatTaskStore,
} from '@roackb2/heddle';
import { db } from './db.js';
import { LUCID_REPO_ROOT } from './config.js';
import { lucidAgents } from './schema.js';
import { lucidAgentRecordSchema } from './types.js';
import type {
  AgentListResponse,
  AgentMessagesResponse,
  AgentSummary,
  CreateAgentInput,
  LucidAgentRecord,
} from './types.js';

export type LucidStoreOptions = {
  rootDir?: string;
};

export function createLucidStore(options: LucidStoreOptions = {}) {
  const rootDir = options.rootDir ?? `${LUCID_REPO_ROOT}/local/ts-rewrite`;
  const heartbeatStore = createFileHeartbeatTaskStore({
    dir: `${rootDir}/heartbeat`,
  });

  return {
    rootDir,

    async createAgent(input: CreateAgentInput) {
      const id = `agent_${randomUUID()}`;
      const now = new Date().toISOString();
      const record: LucidAgentRecord = {
        id,
        role: input.role,
        task: input.task,
        heartbeatTaskId: id,
        createdAt: now,
        updatedAt: now,
      };

      const heartbeatTask: HeartbeatTask = {
        id,
        name: input.role,
        task: input.task,
        enabled: true,
        intervalMs: 30 * 60_000,
        nextRunAt: new Date(Date.now() - 1_000).toISOString(),
        updatedAt: now,
      };

      await db.insert(lucidAgents).values(record);
      await heartbeatStore.saveTask(heartbeatTask);

      return {
        agent_id: id,
        message: `Created Lucid agent ${id} backed by a Heddle heartbeat task.`,
      };
    },

    async listAgents(): Promise<AgentListResponse> {
      const records = await db.select().from(lucidAgents);
      const taskViews = await listHeartbeatTaskViews(heartbeatStore);
      const byTaskId = new Map(taskViews.map((task) => [task.taskId, task]));

      return {
        agents: records.map((record) => {
          const agent = lucidAgentRecordSchema.parse(record);
          return summarizeAgent(agent, byTaskId.get(agent.heartbeatTaskId));
        }),
      };
    },

    async getAgent(id: string): Promise<AgentSummary | undefined> {
      const [record] = await db.select().from(lucidAgents).where(eq(lucidAgents.id, id)).limit(1);
      if (!record) {
        return undefined;
      }

      const heartbeat = (await listHeartbeatTaskViews(heartbeatStore)).find((entry) => entry.taskId === record.heartbeatTaskId);
      return summarizeAgent(lucidAgentRecordSchema.parse(record), heartbeat);
    },

    async getAgentMessages(id: string): Promise<AgentMessagesResponse | undefined> {
      const [record] = await db.select().from(lucidAgents).where(eq(lucidAgents.id, id)).limit(1);
      if (!record) {
        return undefined;
      }

      const [taskView] = (await listHeartbeatTaskViews(heartbeatStore)).filter((entry) => entry.taskId === record.heartbeatTaskId);
      const runViews = await listHeartbeatRunViews(heartbeatStore, {
        taskId: record.heartbeatTaskId,
        limit: 10,
      });

      return {
        agent_id: record.id,
        messages: [
          ...(taskView ? heartbeatTaskViewToLucidMessages(taskView, { taskIdToAgentId: () => record.id }) : []),
          ...runViews.flatMap((run) => heartbeatRunViewToLucidMessages(run, { taskIdToAgentId: () => record.id })),
        ],
      };
    },

    async runAgentOnce(id: string): Promise<AgentMessagesResponse | undefined> {
      const [record] = await db.select().from(lucidAgents).where(eq(lucidAgents.id, id)).limit(1);
      if (!record) {
        return undefined;
      }

      const tasks = await heartbeatStore.listTasks();
      const task = tasks.find((entry) => entry.id === record.heartbeatTaskId);
      if (!task) {
        throw new Error(`Heartbeat task not found for agent ${id}`);
      }

      await heartbeatStore.saveTask({
        ...task,
        enabled: true,
        nextRunAt: new Date(Date.now() - 1_000).toISOString(),
        updatedAt: new Date().toISOString(),
      });

      await runDueHeartbeatTasks({
        store: createSingleTaskStore(heartbeatStore, record.heartbeatTaskId),
        heartbeat: {
          workspaceRoot: process.env.LUCID_AGENT_WORKSPACE_ROOT ?? LUCID_REPO_ROOT,
          maxSteps: 40,
        },
      });

      const runViews = await listHeartbeatRunViews(heartbeatStore, {
        taskId: record.heartbeatTaskId,
        limit: 10,
      });

      const [nextTaskView] = (await listHeartbeatTaskViews(heartbeatStore)).filter(
        (entry) => entry.taskId === record.heartbeatTaskId,
      );

      return {
        agent_id: record.id,
        messages: [
          ...(nextTaskView ? heartbeatTaskViewToLucidMessages(nextTaskView, { taskIdToAgentId: () => record.id }) : []),
          ...runViews.flatMap((run) => heartbeatRunViewToLucidMessages(run, { taskIdToAgentId: () => record.id })),
        ],
      };
    },
  };
}

function createSingleTaskStore(store: HeartbeatTaskStore, taskId: string): HeartbeatTaskStore {
  return {
    ...store,
    async listTasks() {
      return (await store.listTasks()).filter((task) => task.id === taskId);
    },
  };
}

function summarizeAgent(
  record: LucidAgentRecord,
  heartbeat?: Awaited<ReturnType<typeof listHeartbeatTaskViews>>[number],
): AgentSummary {
  return {
    agent_id: record.id,
    role: record.role,
    task: record.task,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    heartbeat: {
      task_id: record.heartbeatTaskId,
      enabled: heartbeat?.enabled ?? true,
      status: heartbeat ? heartbeatTaskStatusToLucidStatus(heartbeat.status) : 'asleep',
      next_run_at: heartbeat?.nextRunAt,
      last_run_at: heartbeat?.lastRunAt,
      last_run_id: heartbeat?.lastRunId,
      progress: heartbeat?.progress,
      summary: heartbeat?.summary,
      resumable: heartbeat?.resumable ?? true,
      error: heartbeat?.error,
    },
  };
}

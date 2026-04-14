import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  createFileHeartbeatTaskStore,
  heartbeatRunViewToLucidMessages,
  heartbeatTaskStatusToLucidStatus,
  heartbeatTaskViewToLucidMessages,
  listHeartbeatRunViews,
  listHeartbeatTaskViews,
  type HeartbeatTask,
} from '@roackb2/heddle';
import { db } from './db.js';
import { lucidAgents } from './schema.js';
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
  const rootDir = options.rootDir ?? `${process.cwd()}/local/ts-rewrite`;
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
        agents: records.map((record) => summarizeAgent(record, byTaskId.get(record.heartbeatTaskId))),
      };
    },

    async getAgent(id: string): Promise<AgentSummary | undefined> {
      const [record] = await db.select().from(lucidAgents).where(eq(lucidAgents.id, id)).limit(1);
      if (!record) {
        return undefined;
      }

      const heartbeat = (await listHeartbeatTaskViews(heartbeatStore)).find((entry) => entry.taskId === record.heartbeatTaskId);
      return summarizeAgent(record, heartbeat);
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

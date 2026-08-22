import { OpaqueIdSchema } from '@heddleagent/execution-host-client/contracts';
import { z } from 'zod';
import type { HostedHeartbeatCoordinatorApiCredentials } from './coordinator-credentials.js';

const TaskListSchema = z.object({
  tasks: z.array(z.object({
    id: OpaqueIdSchema,
    workspaceId: OpaqueIdSchema.optional(),
  }).passthrough()),
}).strict();

export type HostedHeartbeatCoordinatorTaskInput = {
  workspaceId?: string;
  name?: string;
  task: string;
  enabled?: boolean;
  continuationMode?: 'operator' | 'agent';
  intervalMs?: number;
  defer?: boolean;
  model?: string;
  maxSteps?: number;
};

type Fetch = typeof globalThis.fetch;

/** Authenticated client for Lucid-owned desired task state only. */
export class HostedHeartbeatCoordinatorClient {
  constructor(
    private readonly baseUrl: URL,
    private readonly credentials: HostedHeartbeatCoordinatorApiCredentials,
    private readonly fetch: Fetch = globalThis.fetch,
  ) {}

  async listTasks(signal?: AbortSignal): Promise<Array<{
    id: string;
    workspaceId?: string;
  }>> {
    const response = await this.#request('/v1/heartbeat/tasks', {
      method: 'GET',
      signal,
    });
    return TaskListSchema.parse(await response.json()).tasks;
  }

  async upsertTask(
    taskId: string,
    task: HostedHeartbeatCoordinatorTaskInput,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.#request(this.#taskPath(taskId), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(task),
      signal,
    });
  }

  async deleteTask(taskId: string, signal?: AbortSignal): Promise<void> {
    await this.#request(this.#taskPath(taskId), {
      method: 'DELETE',
      signal,
    });
  }

  async pause(signal?: AbortSignal): Promise<void> {
    await this.#request('/v1/control/pause', { method: 'POST', signal });
  }

  async resume(signal?: AbortSignal): Promise<void> {
    await this.#request('/v1/control/resume', { method: 'POST', signal });
  }

  #taskPath(taskId: string): string {
    return `/v1/heartbeat/tasks/${encodeURIComponent(OpaqueIdSchema.parse(taskId))}`;
  }

  async #request(path: string, init: RequestInit): Promise<Response> {
    const response = await this.fetch(new URL(path, this.baseUrl), {
      ...init,
      headers: {
        ...init.headers,
        authorization: this.credentials.authorizationHeader(),
      },
    });
    if (!response.ok) {
      throw new Error(
        `Heddle Coordinator ${init.method ?? 'GET'} ${path} failed with status ${response.status}.`,
      );
    }
    return response;
  }
}

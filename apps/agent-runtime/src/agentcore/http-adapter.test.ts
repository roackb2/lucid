import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EventEmitter } from 'node:events';
import type { Request, Response as ExpressResponse } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestTurnExecutor } from '../runtime-session/__tests__/test-turn-executor.test-support.js';
import {
  AGENTCORE_RUNTIME_SESSION_HEADER,
  LOCAL_RUNTIME_TOKEN_HEADER,
  MODEL_API_KEY_HEADER,
} from './types.js';
import {
  createAgentCoreHttpApp,
  takeSensitiveHeader,
  writeAgentCoreSseEvent,
} from './http-adapter.js';
import { RuntimeSessionService } from '../runtime-session/service.js';

const LOCAL_TOKEN = 'local-token-'.padEnd(32, 'x');
const SESSION_ID = 'runtime-session-'.padEnd(33, 's');
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => close(server)));
});

describe('AgentCore HTTP adapter', () => {
  it('reports stable AgentCore health', async () => {
    const { url } = await startTestServer();
    const first = await fetch(`${url}/ping`).then((response) => response.json());
    const second = await fetch(`${url}/ping`).then((response) => response.json());
    expect(first).toEqual(second);
    expect(first).toMatchObject({ status: 'Healthy' });
  });

  it('rejects unauthenticated or malformed invocations before streaming', async () => {
    const { url } = await startTestServer();
    const missingAuth = await fetch(`${url}/invocations`, requestInit({
      [LOCAL_RUNTIME_TOKEN_HEADER]: undefined,
    }));
    expect(missingAuth.status).toBe(401);
    await expect(missingAuth.json()).resolves.toMatchObject({
      error: { code: 'unauthorized' },
    });

    const malformed = await fetch(`${url}/invocations`, requestInit({}, { prompt: '' }));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      error: { code: 'invalid_request' },
    });
  });

  it('streams accepted, activity, and exactly one truthful terminal event', async () => {
    const { url, executor, runtime } = await startTestServer();
    const response = await fetch(`${url}/invocations`, requestInit());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(runtime.readStatus().state).toBe('executing');

    executor.latest().activity();
    executor.latest().finish();
    const body = await response.text();
    const events = body
      .split('\n')
      .filter((line) => line.startsWith('event: '))
      .map((line) => line.slice('event: '.length));
    expect(events).toEqual(['accepted', 'activity', 'result']);
    expect(events.filter((event) => ['result', 'cancelled', 'error'].includes(event)))
      .toHaveLength(1);
    expect(runtime.readStatus().state).toBe('idle');
  });

  it('rejects concurrent invocation and cross-scope reuse', async () => {
    const { url, executor } = await startTestServer();
    const firstResponse = await fetch(`${url}/invocations`, requestInit());
    const busy = await fetch(`${url}/invocations`, requestInit({}, {
      invocationId: 'invocation-002',
    }));
    expect(busy.status).toBe(409);
    await expect(busy.json()).resolves.toMatchObject({ error: { code: 'runtime_busy' } });

    executor.latest().finish();
    await firstResponse.text();

    const crossScope = await fetch(`${url}/invocations`, requestInit({}, {
      invocationId: 'invocation-003',
      scope: { tenantId: 'company-b' },
    }));
    expect(crossScope.status).toBe(409);
    await expect(crossScope.json()).resolves.toMatchObject({ error: { code: 'scope_mismatch' } });
  });

  it('cancels the active Heddle run when the invocation stream disconnects', async () => {
    const { url, executor } = await startTestServer();
    const caller = new AbortController();
    const response = await fetch(`${url}/invocations`, {
      ...requestInit(),
      signal: caller.signal,
    });
    expect(response.status).toBe(200);
    caller.abort();
    await vi.waitFor(() => expect(executor.latest().cancelCalls).toBe(1));
  });

  it('redacts sensitive values from normalized and raw Node header views', () => {
    const request = {
      headers: { [MODEL_API_KEY_HEADER]: 'model-secret' },
      rawHeaders: ['X-Lucid-Model-Api-Key', 'model-secret', 'Accept', '*/*'],
      header: (name: string) => name.toLowerCase() === MODEL_API_KEY_HEADER
        ? 'model-secret'
        : undefined,
    } as unknown as Request;

    expect(takeSensitiveHeader(request, MODEL_API_KEY_HEADER)).toBe('model-secret');
    expect(request.headers[MODEL_API_KEY_HEADER]).toBeUndefined();
    expect(request.rawHeaders).toEqual([
      'X-Lucid-Model-Api-Key',
      '[redacted]',
      'Accept',
      '*/*',
    ]);
  });

  it('waits for SSE transport drain before producing more activity', async () => {
    const response = Object.assign(new EventEmitter(), {
      destroyed: false,
      write: vi.fn(() => false),
    }) as unknown as ExpressResponse;
    let settled = false;
    const write = writeAgentCoreSseEvent(response, {
      schemaVersion: 1,
      invocationId: 'invocation-001',
      runId: 'run-001',
      sequence: 1,
      timestamp: '2026-08-09T00:00:00.000Z',
      kind: 'activity',
      activity: { type: 'test' },
    }).then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    response.emit('drain');
    await write;
    expect(settled).toBe(true);
    expect(response.write).toHaveBeenCalledTimes(1);
  });
});

async function startTestServer() {
  const executor = new TestTurnExecutor();
  const runtime = new RuntimeSessionService({
    config: { maxInvocationMs: 15 * 60_000 },
    executor,
  });
  const app = createAgentCoreHttpApp({
    config: {
      mode: 'local',
      localTokenSha256: createHash('sha256').update(LOCAL_TOKEN).digest('hex'),
      keepAliveMs: 1_000,
    },
    runtime,
  });
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { executor, runtime, url: `http://127.0.0.1:${address.port}` };
}

function requestInit(
  headerOverrides: Record<string, string | undefined> = {},
  bodyOverrides: Record<string, unknown> = {},
): RequestInit {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    [AGENTCORE_RUNTIME_SESSION_HEADER]: SESSION_ID,
    [LOCAL_RUNTIME_TOKEN_HEADER]: LOCAL_TOKEN,
    [MODEL_API_KEY_HEADER]: 'model-key-for-test',
  };
  Object.entries(headerOverrides).forEach(([name, value]) => {
    if (value === undefined) {
      delete headers[name];
      return;
    }
    headers[name] = value;
  });
  const scope = {
    adopterId: 'heddle-customer',
    tenantId: 'company-a',
    userId: 'user-a',
    conversationId: 'conversation-a',
    ...((bodyOverrides.scope as Record<string, unknown> | undefined) ?? {}),
  };
  return {
    method: 'POST',
    headers,
    body: JSON.stringify({
      schemaVersion: 1,
      kind: 'conversation-turn',
      invocationId: 'invocation-001',
      prompt: 'Inspect the workspace.',
      ...bodyOverrides,
      scope,
    }),
  };
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

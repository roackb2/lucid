import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  AGENTCORE_RUNTIME_SESSION_HEADER,
  EXECUTION_ASSERTION_HEADER,
  EXECUTION_HOST_LOCAL_TOKEN_HEADER,
  MCP_CAPABILITY_HEADER,
  MODEL_API_KEY_HEADER,
  type ExecutionHostStreamEvent,
} from '@roackb2/heddle-adopter/contracts';
import {
  DirectExecutionHostCredentials,
  generateExecutionAuthorityKeyFile,
} from '@roackb2/heddle-adopter/node';
import { afterEach, describe, expect, it } from 'vitest';
import { createLucidAuthenticator } from '../auth/authenticator.js';
import {
  HOSTED_CONVERSATION_TURNS_PATH,
  HOSTED_EXECUTION_JWKS_PATH,
  HOSTED_EXECUTION_MCP_PATH,
} from '../hosted-execution/http-router.js';
import { workspaceSnapshot } from '../hosted-execution/mcp/test-support.js';
import { READ_WORKSPACE_SNAPSHOT_TOOL } from '../hosted-execution/mcp/types.js';
import {
  createTestConversationHistory,
} from '../hosted-execution/conversation/history.test-support.js';
import { createLucidLogger } from '../logger.js';
import { createHostedExecutionComposition } from './hosted-execution.js';

const LOCAL_TOKEN = 'local-execution-host-token-value';
const MODEL_API_KEY = 'model-api-key-value';
const servers = new Set<ReturnType<typeof createServer>>();
const temporaryRoots = new Set<string>();

afterEach(async () => {
  await Promise.all([...servers].map(closeServer));
  await Promise.all([...temporaryRoots].map((root) => (
    rm(root, { recursive: true, force: true })
  )));
  servers.clear();
  temporaryRoots.clear();
});

describe('hosted execution composition', () => {
  it('runs a conversation through direct HTTP and a scoped Lucid MCP tool', async () => {
    let handleLucidRequest: (
      request: IncomingMessage,
      response: ServerResponse,
    ) => void = (_request, response) => {
      response.writeHead(503).end();
    };
    const lucidServer = createServer((request, response) => {
      handleLucidRequest(request, response);
    });
    const lucidOrigin = await listen(lucidServer);
    const observed = {
      localToken: '',
      modelApiKey: '',
      executionAssertion: '',
      mcpCapability: '',
      runtimeSessionId: '',
      workspaceId: '',
    };
    const executionHostServer = createServer((request, response) => {
      void handleFakeExecutionHost(
        request,
        response,
        new URL(HOSTED_EXECUTION_MCP_PATH, lucidOrigin),
        observed,
      );
    });
    const executionHostOrigin = await listen(executionHostServer);
    const credentials = new DirectExecutionHostCredentials({
      localToken: LOCAL_TOKEN,
      modelApiKey: MODEL_API_KEY,
    });
    const composition = await createHostedExecutionComposition({
      config: {
        publicBaseUrl: lucidOrigin,
        signingJwkPath: await writePrivateJwk(),
        adopterId: 'lucid-local',
        tenantId: 'lucid-local',
        productSessionId: 'local-discovery-workspace',
        keyId: 'lucid-local-key',
        executionAudience: 'urn:execution-host:test',
        mcpAudience: 'urn:lucid:mcp:test',
        mcpServerId: 'lucid_product',
        maxTurnMs: 60_000,
        transport: {
          mode: 'direct',
          baseUrl: executionHostOrigin,
          credentials,
        },
        modelCredentials: credentials,
      },
      authenticator: createLucidAuthenticator({ mode: 'development' }),
      discoveryWorkspace: {
        snapshot: async () => workspaceSnapshot(),
      },
      conversationHistory: createTestConversationHistory().history,
      logger: createLucidLogger('silent'),
    });
    handleLucidRequest = (request, response) => {
      if (!composition.http.handle(request, response)) {
        response.writeHead(404).end();
      }
    };

    const jwksResponse = await fetch(new URL(
      HOSTED_EXECUTION_JWKS_PATH,
      lucidOrigin,
    ));
    const jwks = await jwksResponse.json() as { keys: Record<string, unknown>[] };
    const response = await fetch(new URL(
      HOSTED_CONVERSATION_TURNS_PATH,
      lucidOrigin,
    ), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Summarize my Lucid workspace.' }),
    });
    const events = parseSseEvents(await response.text());

    expect(jwksResponse.status).toBe(200);
    expect(jwks.keys).toEqual([
      expect.objectContaining({ kty: 'EC', crv: 'P-256' }),
    ]);
    expect(JSON.stringify(jwks)).not.toContain('"d"');
    expect(response.status).toBe(200);
    expect(events.map(({ kind }) => kind)).toEqual([
      'accepted',
      'activity',
      'result',
    ]);
    expect(events[1]).toMatchObject({
      activity: {
        tool: READ_WORKSPACE_SNAPSHOT_TOOL,
        workspaceId: 'local-discovery-workspace',
      },
    });
    expect(events[2]).toMatchObject({
      result: { outcome: 'done' },
    });
    expect(observed).toMatchObject({
      localToken: LOCAL_TOKEN,
      modelApiKey: MODEL_API_KEY,
      workspaceId: 'local-discovery-workspace',
    });
    expect(observed.executionAssertion.split('.')).toHaveLength(3);
    expect(observed.mcpCapability.split('.')).toHaveLength(3);
    expect(observed.mcpCapability).not.toBe(observed.executionAssertion);
    expect(observed.runtimeSessionId.length).toBeGreaterThanOrEqual(33);

    await composition.close();
  });

  it('does not manufacture success when the host stream ends without a terminal', async () => {
    let handleLucidRequest: (
      request: IncomingMessage,
      response: ServerResponse,
    ) => void = (_request, response) => {
      response.writeHead(503).end();
    };
    const lucidServer = createServer((request, response) => {
      handleLucidRequest(request, response);
    });
    const lucidOrigin = await listen(lucidServer);
    const executionHostServer = createServer((request, response) => {
      void respondWithInterruptedStream(request, response);
    });
    const executionHostOrigin = await listen(executionHostServer);
    const credentials = new DirectExecutionHostCredentials({
      localToken: LOCAL_TOKEN,
      modelApiKey: MODEL_API_KEY,
    });
    const composition = await createHostedExecutionComposition({
      config: {
        publicBaseUrl: lucidOrigin,
        signingJwkPath: await writePrivateJwk(),
        adopterId: 'lucid-local',
        tenantId: 'lucid-local',
        productSessionId: 'local-discovery-workspace',
        keyId: 'lucid-local-key',
        executionAudience: 'urn:execution-host:test',
        mcpAudience: 'urn:lucid:mcp:test',
        mcpServerId: 'lucid_product',
        maxTurnMs: 60_000,
        transport: {
          mode: 'direct',
          baseUrl: executionHostOrigin,
          credentials,
        },
        modelCredentials: credentials,
      },
      authenticator: createLucidAuthenticator({ mode: 'development' }),
      discoveryWorkspace: { snapshot: async () => workspaceSnapshot() },
      conversationHistory: createTestConversationHistory().history,
      logger: createLucidLogger('silent'),
    });
    handleLucidRequest = (request, response) => {
      if (!composition.http.handle(request, response)) {
        response.writeHead(404).end();
      }
    };

    const response = await fetch(new URL(
      HOSTED_CONVERSATION_TURNS_PATH,
      lucidOrigin,
    ), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'Interrupt this turn.' }),
    });
    const events = parseSseEvents(await response.text());

    expect(response.status).toBe(200);
    expect(events.map(({ kind }) => kind)).toEqual(['accepted']);
    expect(events.some(({ kind }) => (
      kind === 'result' || kind === 'error' || kind === 'cancelled'
    ))).toBe(false);

    await composition.close();
  });
});

async function handleFakeExecutionHost(
  request: IncomingMessage,
  response: ServerResponse,
  mcpEndpoint: URL,
  observed: {
    localToken: string;
    modelApiKey: string;
    executionAssertion: string;
    mcpCapability: string;
    runtimeSessionId: string;
    workspaceId: string;
  },
): Promise<void> {
  const body = await readJsonRequest(request) as {
    invocationId: string;
  };
  observed.localToken = readHeader(request, EXECUTION_HOST_LOCAL_TOKEN_HEADER);
  observed.modelApiKey = readHeader(request, MODEL_API_KEY_HEADER);
  observed.executionAssertion = readHeader(request, EXECUTION_ASSERTION_HEADER);
  observed.mcpCapability = readHeader(request, MCP_CAPABILITY_HEADER);
  observed.runtimeSessionId = readHeader(
    request,
    AGENTCORE_RUNTIME_SESSION_HEADER,
  );

  if (observed.localToken !== LOCAL_TOKEN) {
    response.writeHead(401).end();
    return;
  }

  const client = new Client({ name: 'fake-execution-host', version: '1.0.0' });
  try {
    await client.connect(new StreamableHTTPClientTransport(mcpEndpoint, {
      requestInit: {
        headers: {
          authorization: `Bearer ${observed.mcpCapability}`,
        },
      },
    }));
    const tools = await client.listTools();
    expect(tools.tools.map(({ name }) => name)).toEqual([
      READ_WORKSPACE_SNAPSHOT_TOOL,
    ]);
    const toolResult = await client.callTool({
      name: READ_WORKSPACE_SNAPSHOT_TOOL,
      arguments: {},
    });
    const text = toolResult.content.find(({ type }) => type === 'text');
    if (!text || text.type !== 'text') {
      throw new Error('Lucid MCP returned no text projection.');
    }
    const snapshot = JSON.parse(text.text) as { workspace: { id: string } };
    observed.workspaceId = snapshot.workspace.id;

    const runId = 'fake-host-run';
    const timestamp = new Date().toISOString();
    const events: ExecutionHostStreamEvent[] = [
      {
        schemaVersion: 1,
        invocationId: body.invocationId,
        runId,
        timestamp,
        sequence: 0,
        kind: 'accepted',
      },
      {
        schemaVersion: 1,
        invocationId: body.invocationId,
        runId,
        timestamp,
        sequence: 1,
        kind: 'activity',
        activity: {
          tool: READ_WORKSPACE_SNAPSHOT_TOOL,
          workspaceId: snapshot.workspace.id,
        },
      },
      {
        schemaVersion: 1,
        invocationId: body.invocationId,
        runId,
        timestamp,
        sequence: 2,
        kind: 'result',
        result: {
          outcome: 'done',
          summary: 'Read the scoped Lucid workspace through MCP.',
        },
      },
    ];
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    events.forEach((event) => response.write(toSseFrame(event)));
    response.end();
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function respondWithInterruptedStream(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readJsonRequest(request) as { invocationId: string };
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(toSseFrame({
    schemaVersion: 1,
    invocationId: body.invocationId,
    runId: 'interrupted-run',
    timestamp: new Date().toISOString(),
    sequence: 0,
    kind: 'accepted',
  }));
}

function toSseFrame(event: ExecutionHostStreamEvent): string {
  return `event: ${event.kind}\nid: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`;
}

function parseSseEvents(value: string): ExecutionHostStreamEvent[] {
  return value
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as ExecutionHostStreamEvent);
}

async function readJsonRequest(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function readHeader(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

async function listen(
  server: ReturnType<typeof createServer>,
): Promise<URL> {
  servers.add(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${address.port}/`);
}

async function closeServer(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  server.closeAllConnections();
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function writePrivateJwk(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lucid-hosted-composition-'));
  temporaryRoots.add(root);
  const path = join(root, 'private.jwk.json');
  await generateExecutionAuthorityKeyFile(path);
  return path;
}

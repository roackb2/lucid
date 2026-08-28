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
  MODEL_CREDENTIAL_HEADER,
  type ExecutionHostModelCredential,
  type ExecutionHostStreamEvent,
} from '@heddleagent/execution-host-client/contracts';
import {
  DirectExecutionHostCredentials,
  generateExecutionAuthorityKeyFile,
} from '@heddleagent/execution-host-client/node';
import type {
  HostedConversationTurnLifecycleStore,
} from '@heddleagent/execution-host-client/conversation';
import {
  HOSTED_HEARTBEAT_EXECUTION_PATHS,
  type HostedHeartbeatExecutionPreparation,
  type HostedHeartbeatExecutionSettlement,
} from '@heddleagent/execution-host-client/coordinator';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLucidAuthenticator } from '../auth/authenticator.js';
import {
  HOSTED_EXECUTION_MCP_PATH,
} from '../hosted-execution/http-router.js';
import {
  DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH,
  DEFAULT_ADOPTER_JWKS_PATH,
} from '@heddleagent/execution-host-client/adopter';
import { workspaceSnapshot } from '../hosted-execution/mcp/test-support.js';
import {
  POST_SHARED_MESSAGE_TOOL,
  READ_AVAILABLE_MESSAGES_TOOL,
  READ_WORKSPACE_SNAPSHOT_TOOL,
} from '../hosted-execution/mcp/types.js';
import { createLucidLogger } from '../logger.js';
import { createHostedExecutionComposition } from './hosted-execution.js';

const LOCAL_TOKEN = 'local-execution-host-token-value';
const MODEL_API_KEY = 'model-api-key-value';
const HEARTBEAT_EXECUTION_TOKEN = 'heartbeat-execution-token-'.padEnd(32, 'x');
const COORDINATOR_API_TOKEN = 'coordinator-api-token-value-value';
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
      modelCredential: undefined as ExecutionHostModelCredential | undefined,
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
    });
    const modelCredentials = apiKeyModelCredentials();
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
        modelCredentials,
        heartbeatExecutionToken: HEARTBEAT_EXECUTION_TOKEN,
        heartbeatCoordinator: {
          baseUrl: new URL('http://127.0.0.1:18082'),
          apiToken: COORDINATOR_API_TOKEN,
        },
      },
      authenticator: createLucidAuthenticator({ mode: 'development' }),
      discoveryWorkspace: {
        snapshot: async () => workspaceSnapshot(),
      },
      agentWork: unusedAgentWork(),
      conversationLifecycle: memoryConversationLifecycle(),
      logger: createLucidLogger('silent'),
    });
    handleLucidRequest = (request, response) => {
      if (!composition.http.handle(request, response)) {
        response.writeHead(404).end();
      }
    };

    const jwksResponse = await fetch(new URL(
      DEFAULT_ADOPTER_JWKS_PATH,
      lucidOrigin,
    ));
    const jwks = await jwksResponse.json() as { keys: Record<string, unknown>[] };
    const response = await fetch(new URL(
      DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH,
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
      modelCredential: {
        type: 'api-key',
        apiKey: MODEL_API_KEY,
      },
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
        modelCredentials: apiKeyModelCredentials(),
        heartbeatExecutionToken: HEARTBEAT_EXECUTION_TOKEN,
        heartbeatCoordinator: {
          baseUrl: new URL('http://127.0.0.1:18082'),
          apiToken: COORDINATOR_API_TOKEN,
        },
      },
      authenticator: createLucidAuthenticator({ mode: 'development' }),
      discoveryWorkspace: { snapshot: async () => workspaceSnapshot() },
      agentWork: unusedAgentWork(),
      conversationLifecycle: memoryConversationLifecycle(),
      logger: createLucidLogger('silent'),
    });
    handleLucidRequest = (request, response) => {
      if (!composition.http.handle(request, response)) {
        response.writeHead(404).end();
      }
    };

    const response = await fetch(new URL(
      DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH,
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

  it('binds one Coordinator execution to Lucid work tools and settlement', async () => {
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
    const executionHostServer = createServer((_request, response) => {
      response.writeHead(503).end();
    });
    const executionHostOrigin = await listen(executionHostServer);
    const claimWork = vi.fn(async (input: { executionId: string }) => ({
      kind: 'claimed' as const,
      work: {
        agent: { id: 'agent-1' },
        user: { id: 'user-1' },
        workId: 'work-1',
        executionId: input.executionId,
        workNumber: 1,
        visibleEvents: [],
        horizonSequence: 1,
        workingContext: { principalInputs: [], findings: [] },
      },
    }));
    const completeWork = vi.fn(async () => ({ kind: 'accepted' as const }));
    const executeTool = vi.fn(async (input: { toolName: string }) => ({
      ok: true,
      output: { toolName: input.toolName },
    }));
    const agentWork = {
      claimWork,
      completeWork,
      failWork: vi.fn(async () => undefined),
      interruptWork: vi.fn(async () => undefined),
      executeTool,
    };
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
          credentials: new DirectExecutionHostCredentials({
            localToken: LOCAL_TOKEN,
          }),
        },
        modelCredentials: apiKeyModelCredentials(),
        heartbeatExecutionToken: HEARTBEAT_EXECUTION_TOKEN,
        heartbeatCoordinator: {
          baseUrl: new URL('http://127.0.0.1:18082'),
          apiToken: COORDINATOR_API_TOKEN,
        },
      },
      authenticator: createLucidAuthenticator({ mode: 'development' }),
      discoveryWorkspace: { snapshot: async () => workspaceSnapshot() },
      agentWork,
      conversationLifecycle: memoryConversationLifecycle(),
      logger: createLucidLogger('silent'),
    });
    handleLucidRequest = (request, response) => {
      if (!composition.http.handle(request, response)) {
        response.writeHead(404).end();
      }
    };

    const taskId = 'lucid-representative-agent-1';
    const executionId = 'execution-1';
    const preparationResponse = await postHeartbeatExecution(
      lucidOrigin,
      HOSTED_HEARTBEAT_EXECUTION_PATHS.prepare,
      {
        schemaVersion: 1,
        taskId,
        executionId,
      },
    );
    const preparation = await preparationResponse.json() as
      HostedHeartbeatExecutionPreparation;

    expect(preparationResponse.status).toBe(200);
    expect(preparation).toMatchObject({
      kind: 'execute',
      delegation: {
        taskId,
        executionId,
        scope: {
          tenantId: 'lucid-local',
          subjectId: 'user-1',
          productSessionId: 'local-discovery-workspace',
        },
        authority: {
          metadata: {
            invocationId: executionId,
            workflow: 'heartbeat-task',
            mcp: {
              allowedTools: [
                READ_AVAILABLE_MESSAGES_TOOL,
                POST_SHARED_MESSAGE_TOOL,
              ],
            },
          },
        },
      },
    });
    expect(claimWork).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      executionId,
    }));
    if (preparation.kind !== 'execute') {
      throw new Error('Expected Lucid to prepare one heartbeat execution.');
    }

    const mcpClient = new Client({
      name: 'coordinator-execution-test',
      version: '1.0.0',
    });
    await mcpClient.connect(new StreamableHTTPClientTransport(
      new URL(HOSTED_EXECUTION_MCP_PATH, lucidOrigin),
      {
        requestInit: {
          headers: {
            authorization:
              `Bearer ${preparation.delegation.authority.mcpCapability}`,
          },
        },
      },
    ));
    try {
      expect((await mcpClient.listTools()).tools.map(({ name }) => name))
        .toEqual([
          READ_AVAILABLE_MESSAGES_TOOL,
          POST_SHARED_MESSAGE_TOOL,
        ]);
      await mcpClient.callTool({
        name: READ_AVAILABLE_MESSAGES_TOOL,
        arguments: {},
      });
      await mcpClient.callTool({
        name: POST_SHARED_MESSAGE_TOOL,
        arguments: {
          reply_to_event_id: 1,
          content: 'Who has a concrete example?',
          source_event_ids: [1],
        },
      });
      await expect(mcpClient.callTool({
        name: READ_AVAILABLE_MESSAGES_TOOL,
        arguments: { executionId: 'model-selected-execution' },
      })).resolves.toMatchObject({ isError: true });
    } finally {
      await mcpClient.close();
    }
    expect(executeTool).toHaveBeenNthCalledWith(1, expect.objectContaining({
      userId: 'user-1',
      executionId,
      toolName: READ_AVAILABLE_MESSAGES_TOOL,
    }));
    expect(executeTool).toHaveBeenNthCalledWith(2, expect.objectContaining({
      userId: 'user-1',
      executionId,
      toolName: POST_SHARED_MESSAGE_TOOL,
    }));

    const settlementResponse = await postHeartbeatExecution(
      lucidOrigin,
      HOSTED_HEARTBEAT_EXECUTION_PATHS.settle,
      {
        schemaVersion: 1,
        kind: 'completed',
        taskId,
        executionId,
        result: {
          decision: 'complete',
          summary: 'Published the required request.',
          runId: 'run-1',
          outcome: 'done',
        },
      },
    );
    const settlement = await settlementResponse.json() as
      HostedHeartbeatExecutionSettlement;

    expect(settlementResponse.status).toBe(200);
    expect(settlement).toEqual({
      schemaVersion: 1,
      taskId,
      executionId,
      disposition: { kind: 'accepted' },
    });
    expect(completeWork).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      executionId,
      result: expect.objectContaining({
        decision: 'complete',
        outcome: 'done',
      }),
    }));

    await composition.close();
  });
});

async function postHeartbeatExecution(
  origin: URL,
  path: string,
  body: unknown,
): Promise<Response> {
  return await fetch(new URL(path, origin), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${HEARTBEAT_EXECUTION_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function memoryConversationLifecycle(): HostedConversationTurnLifecycleStore {
  return {
    createTurn: async () => undefined,
    recordAccepted: async () => undefined,
    settleTurn: async () => undefined,
    interruptExpiredTurns: async () => undefined,
  };
}

function unusedAgentWork() {
  return {
    claimWork: async () => {
      throw new Error('Agent work is disabled in this fixture.');
    },
    completeWork: async () => ({ kind: 'accepted' as const }),
    failWork: async () => undefined,
    interruptWork: async () => undefined,
    executeTool: async () => {
      throw new Error('Agent work is disabled in this fixture.');
    },
  };
}

async function handleFakeExecutionHost(
  request: IncomingMessage,
  response: ServerResponse,
  mcpEndpoint: URL,
  observed: {
    localToken: string;
    modelCredential: ExecutionHostModelCredential | undefined;
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
  observed.modelCredential = JSON.parse(
    readHeader(request, MODEL_CREDENTIAL_HEADER),
  ) as ExecutionHostModelCredential;
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

function apiKeyModelCredentials() {
  return {
    resolveModelCredential: async () => ({
      type: 'api-key' as const,
      apiKey: MODEL_API_KEY,
    }),
  };
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

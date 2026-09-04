import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpCapabilityVerifier } from '@heddleagent/execution-host-client/mcp';
import {
  NodeStreamableHttpMcpService,
} from '@heddleagent/execution-host-client/mcp/node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLucidProductToolset } from './product-tools.js';
import {
  MCP_TEST_NOW,
  McpCapabilitySignerFixture,
  workspaceSnapshot,
} from './test-support.js';
import {
  LUCID_HEARTBEAT_MCP_TOOLS,
  PUBLISH_TEXT_POST_TOOL,
  READ_WORKING_CONTEXT_TOOL,
  READ_WORKSPACE_SNAPSHOT_TOOL,
  type LucidProductMcpToolName,
  type ScopedAgentWorkToolExecutor,
  type ScopedInformationNetworkPublisher,
  type ScopedWorkspaceProjectionReader,
} from './types.js';
import {
  UserWorkspaceProjectionReader,
} from './workspace-projection-reader.js';

let signer: McpCapabilitySignerFixture;
let httpServer: HttpServer | undefined;
let mcpService: ProductMcpService | undefined;
let client: Client | undefined;
let lastRequest: IncomingMessage | undefined;

beforeEach(async () => {
  signer = await McpCapabilitySignerFixture.create();
});

afterEach(async () => {
  await client?.close().catch(() => undefined);
  await mcpService?.close();
  httpServer?.closeAllConnections();
  if (httpServer?.listening) {
    await new Promise<void>((resolve) => httpServer?.close(() => resolve()));
  }
  client = undefined;
  mcpService = undefined;
  httpServer = undefined;
  lastRequest = undefined;
});

describe('Lucid product tools over the generic MCP HTTP edge', () => {
  it('exposes the read-only workspace tool and derives all scope from claims', async () => {
    const observedScopes: unknown[] = [];
    const snapshot = workspaceSnapshot();
    const reader = {
      readWorkspaceProjection: vi.fn(async (input) => {
        observedScopes.push(input.scope);
        return snapshot;
      }),
    };
    const assertion = await signer.sign();
    const endpoint = await startService(createProductMcpService(
      signer.verifier(),
      reader,
      { now: () => MCP_TEST_NOW },
    ));
    client = await connectClient(endpoint, assertion);

    const tools = await client.listTools();
    expect(tools.tools.map(({ name }) => name)).toEqual([
      READ_WORKSPACE_SNAPSHOT_TOOL,
    ]);
    expect(tools.tools[0]?.inputSchema).toEqual({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      properties: {},
      additionalProperties: false,
    });

    const result = await client.callTool({
      name: READ_WORKSPACE_SNAPSHOT_TOOL,
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    const serializedResult = JSON.stringify(result);
    expect(serializedResult).toContain('local-discovery-workspace');
    expect(serializedResult).toContain('userChecksEnabled');
    expect(serializedResult).toContain('operatorDispatchEnabled');
    expect(serializedResult).not.toContain('backgroundChecksEnabled');
    expect(serializedResult).not.toContain('dispatchEnabled');
    expect(lastRequest?.headers.authorization).toBe('[REDACTED]');
    expect(rawHeader(lastRequest, 'authorization')).toBe('[REDACTED]');
    expect(observedScopes).toEqual([{
      adopterId: 'lucid-adopter',
      tenantId: 'tenant-a',
      subjectId: 'subject-a',
      productSessionId: 'product-session-a',
      runtimeSessionId: `runtime-session:${'a'.repeat(40)}`,
      invocationId: 'invocation-001',
      workflow: 'conversation-turn',
    }]);

    const modelSelectedScope = await client.callTool({
      name: READ_WORKSPACE_SNAPSHOT_TOOL,
      arguments: { tenantId: 'tenant-b' },
    });
    expect(modelSelectedScope).toMatchObject({ isError: true });
    expect(reader.readWorkspaceProjection).toHaveBeenCalledOnce();
  });

  it('rejects unknown signed tools before MCP discovery', async () => {
    const assertion = await signer.sign({ allowedTools: ['delete_workspace'] });
    const endpoint = await startService(createProductMcpService(
      signer.verifier(),
      {
        readWorkspaceProjection: vi.fn(async () => workspaceSnapshot()),
      },
      { now: () => MCP_TEST_NOW },
    ));

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${assertion}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    });

    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).not.toContain(assertion);
    expect(body).not.toContain('delete_workspace');
  });

  it('exposes the complete claim-scoped heartbeat tool surface', async () => {
    const agentWork = {
      executeAgentWorkTool: vi.fn(async () => ({
        ok: true,
        output: {
          principalInputs: [],
          findings: [],
          workingNote: { content: 'Keep one durable current direction.' },
        },
      })),
    } satisfies ScopedAgentWorkToolExecutor;
    const assertion = await signer.sign({
      workflow: 'heartbeat-task',
      allowedTools: LUCID_HEARTBEAT_MCP_TOOLS,
    });
    const endpoint = await startService(createProductMcpService(
      signer.verifier(),
      { readWorkspaceProjection: vi.fn(async () => workspaceSnapshot()) },
      { agentWork, now: () => MCP_TEST_NOW },
    ));
    client = await connectClient(endpoint, assertion);

    expect((await client.listTools()).tools.map(({ name }) => name))
      .toEqual(LUCID_HEARTBEAT_MCP_TOOLS);
    const result = await client.callTool({
      name: READ_WORKING_CONTEXT_TOOL,
      arguments: {},
    });

    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain(
      'Keep one durable current direction.',
    );
    expect(agentWork.executeAgentWorkTool).toHaveBeenCalledWith({
      scope: expect.objectContaining({
        subjectId: 'subject-a',
        invocationId: 'invocation-001',
        workflow: 'heartbeat-task',
      }),
      toolName: READ_WORKING_CONTEXT_TOOL,
      arguments: {},
      signal: expect.any(AbortSignal),
    });
  });

  it('publishes through trusted heartbeat scope without identity arguments', async () => {
    const informationNetworkPublisher = {
      publishTextPost: vi.fn(async () => ({
        outcome: 'published' as const,
        postId: 'post-1',
        publishedAt: '2026-09-04T00:00:00.000Z',
      })),
    } satisfies ScopedInformationNetworkPublisher;
    const assertion = await signer.sign({
      workflow: 'heartbeat-task',
      allowedTools: [PUBLISH_TEXT_POST_TOOL],
    });
    const endpoint = await startService(createProductMcpService(
      signer.verifier(),
      { readWorkspaceProjection: vi.fn(async () => workspaceSnapshot()) },
      { informationNetworkPublisher, now: () => MCP_TEST_NOW },
    ));
    client = await connectClient(endpoint, assertion);

    expect((await client.listTools()).tools.map(({ name }) => name))
      .toEqual([PUBLISH_TEXT_POST_TOOL]);
    const result = await client.callTool({
      name: PUBLISH_TEXT_POST_TOOL,
      arguments: {
        title: 'A useful update',
        body: 'A source-backed explanation.',
        topics: ['Agent systems'],
        sources: [{
          title: 'Original report',
          sourceName: 'Example News',
          url: 'https://example.com/report',
        }],
      },
    });

    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain('post-1');
    expect(informationNetworkPublisher.publishTextPost).toHaveBeenCalledWith({
      scope: expect.objectContaining({
        subjectId: 'subject-a',
        invocationId: 'invocation-001',
        workflow: 'heartbeat-task',
      }),
      draft: {
        title: 'A useful update',
        body: 'A source-backed explanation.',
        topics: ['Agent systems'],
        sources: [{
          title: 'Original report',
          sourceName: 'Example News',
          url: 'https://example.com/report',
        }],
      },
      signal: expect.any(AbortSignal),
    });

    await expect(client.callTool({
      name: PUBLISH_TEXT_POST_TOOL,
      arguments: {
        userId: 'model-selected-user',
        title: 'A forged publication',
        body: 'The schema must reject model-selected identity.',
        topics: ['Security'],
        sources: [{
          title: 'Original report',
          sourceName: 'Example News',
          url: 'https://example.com/report',
        }],
      },
    })).resolves.toMatchObject({ isError: true });
    expect(informationNetworkPublisher.publishTextPost).toHaveBeenCalledOnce();
  });

  it('denies a cross-scope projection without leaking product data', async () => {
    const source = {
      snapshot: vi.fn(async (_userId: string) => workspaceSnapshot()),
    };
    const reader = new UserWorkspaceProjectionReader({
      tenantId: 'tenant-a',
      productSessionId: 'product-session-a',
    }, source);
    const assertion = await signer.sign({ tenantId: 'tenant-b' });
    const endpoint = await startService(createProductMcpService(
      signer.verifier(),
      reader,
      { now: () => MCP_TEST_NOW },
    ));
    client = await connectClient(endpoint, assertion);

    const result = await client.callTool({
      name: READ_WORKSPACE_SNAPSHOT_TOOL,
      arguments: {},
    });

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).not.toContain('local-discovery-workspace');
    expect(source.snapshot).not.toHaveBeenCalled();
  });

  it('returns a safe tool error when the projection fails', async () => {
    const assertion = await signer.sign();
    const endpoint = await startService(createProductMcpService(
      signer.verifier(),
      {
        readWorkspaceProjection: vi.fn(async () => {
          throw new Error('postgres://admin:database-password@private-host');
        }),
      },
      { now: () => MCP_TEST_NOW },
    ));
    client = await connectClient(endpoint, assertion);

    const result = await client.callTool({
      name: READ_WORKSPACE_SNAPSHOT_TOOL,
      arguments: {},
    });

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain(
      'Lucid workspace projection is unavailable.',
    );
    expect(JSON.stringify(result)).not.toContain('database-password');
  });

  it('rechecks capability expiry before reading product data', async () => {
    let currentTime = MCP_TEST_NOW;
    const reader = {
      readWorkspaceProjection: vi.fn(async () => workspaceSnapshot()),
    };
    const assertion = await signer.sign();
    const endpoint = await startService(createProductMcpService(
      signer.verifier(() => currentTime),
      reader,
      { now: () => currentTime },
    ));
    client = await connectClient(endpoint, assertion);
    currentTime = new Date(MCP_TEST_NOW.getTime() + 61_000);

    const result = await client.callTool({
      name: READ_WORKSPACE_SNAPSHOT_TOOL,
      arguments: {},
    });

    expect(result).toMatchObject({ isError: true });
    expect(JSON.stringify(result)).toContain('Product tool authority expired.');
    expect(reader.readWorkspaceProjection).not.toHaveBeenCalled();
  });

  it('propagates service shutdown cancellation to an in-flight projection', async () => {
    let projectionCancelled = false;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const assertion = await signer.sign();
    const endpoint = await startService(createProductMcpService(
      signer.verifier(),
      {
        readWorkspaceProjection: vi.fn(async ({ signal }) => {
          markStarted();
          await new Promise<void>((resolve) => {
            if (signal.aborted) {
              projectionCancelled = true;
              resolve();
              return;
            }
            signal.addEventListener('abort', () => {
              projectionCancelled = true;
              resolve();
            }, { once: true });
          });
          signal.throwIfAborted();
          return workspaceSnapshot();
        }),
      },
      { now: () => MCP_TEST_NOW },
    ));
    client = await connectClient(endpoint, assertion);
    const call = client.callTool({
      name: READ_WORKSPACE_SNAPSHOT_TOOL,
      arguments: {},
    });
    await started;
    const closing = mcpService?.close();

    await vi.waitFor(() => expect(projectionCancelled).toBe(true));
    await client.close();
    client = undefined;
    await call.catch(() => undefined);
    await closing;
  });

  it('bounds request size before creating MCP resources', async () => {
    const assertion = await signer.sign();
    const endpoint = await startService(createProductMcpService(
      signer.verifier(),
      { readWorkspaceProjection: vi.fn(async () => workspaceSnapshot()) },
      { maxBodyBytes: 32, now: () => MCP_TEST_NOW },
    ));

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${assertion}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    });

    expect(response.status).toBe(413);
    expect(await response.text()).not.toContain(assertion);
  });

  it('accepts case-insensitive standard authorization and JSON media types', async () => {
    const assertion = await signer.sign();
    const endpoint = await startService(createProductMcpService(
      signer.verifier(),
      { readWorkspaceProjection: vi.fn(async () => workspaceSnapshot()) },
      { now: () => MCP_TEST_NOW },
    ));

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        authorization: `bEaReR ${assertion}`,
        'content-type': 'Application/JSON; Charset=UTF-8',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain(READ_WORKSPACE_SNAPSHOT_TOOL);
  });
});

type ProductMcpService = NodeStreamableHttpMcpService<LucidProductMcpToolName>;

function createProductMcpService(
  capabilityVerifier: McpCapabilityVerifier<LucidProductMcpToolName>,
  workspaceReader: ScopedWorkspaceProjectionReader,
  options: {
    agentWork?: ScopedAgentWorkToolExecutor;
    informationNetworkPublisher?: ScopedInformationNetworkPublisher;
    maxBodyBytes?: number;
    now?: () => Date;
  } = {},
): ProductMcpService {
  return new NodeStreamableHttpMcpService({
    capabilityVerifier,
    toolset: createLucidProductToolset(
      workspaceReader,
      options.agentWork ?? {
        executeAgentWorkTool: async () => {
          throw new Error('Agent work is unavailable in this fixture.');
        },
      },
      options.informationNetworkPublisher ?? {
        publishTextPost: async () => {
          throw new Error('Information Network publishing is unavailable in this fixture.');
        },
      },
      { now: options.now },
    ),
    ...(options.maxBodyBytes
      ? { maxBodyBytes: options.maxBodyBytes }
      : {}),
  });
}

async function startService(service: ProductMcpService): Promise<URL> {
  mcpService = service;
  httpServer = createServer((request, response) => {
    lastRequest = request;
    void service.handle(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    httpServer?.once('error', reject);
    httpServer?.listen(0, '127.0.0.1', () => {
      httpServer?.removeListener('error', reject);
      resolve();
    });
  });
  const address = httpServer.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${address.port}/mcp`);
}

function rawHeader(
  request: IncomingMessage | undefined,
  name: string,
): string | undefined {
  if (!request) {
    return undefined;
  }
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === name.toLowerCase()) {
      return request.rawHeaders[index + 1];
    }
  }
  return undefined;
}

async function connectClient(endpoint: URL, assertion: string): Promise<Client> {
  const connectedClient = new Client({
    name: 'lucid-mcp-test-client',
    version: '1.0.0',
  });
  await connectedClient.connect(new StreamableHTTPClientTransport(endpoint, {
    requestInit: {
      headers: { authorization: `Bearer ${assertion}` },
    },
  }));
  return connectedClient;
}

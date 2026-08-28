import {
  createServer,
  type Server as HttpServer,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  HostedConversationTurnService,
} from '@heddleagent/execution-host-client/conversation';
import {
  NodeStreamableHttpMcpService,
} from '@heddleagent/execution-host-client/mcp/node';
import {
  LocalExecutionHostContractFixture,
} from '@heddleagent/execution-host-client/testing';
import { describe, expect, it, vi } from 'vitest';
import { createLucidProductToolset } from '../mcp/product-tools.js';
import {
  MCP_TEST_NOW,
  McpCapabilitySignerFixture,
  workspaceSnapshot,
} from '../mcp/test-support.js';
import {
  READ_WORKSPACE_SNAPSHOT_TOOL,
  type LucidProductMcpToolName,
} from '../mcp/types.js';
import {
  UserWorkspaceProjectionReader,
} from '../mcp/workspace-projection-reader.js';

describe('Lucid hosted conversation control-plane round trip', () => {
  it('mints authority, invokes the public contract, calls real MCP, and projects a terminal', async () => {
    const signer = await McpCapabilitySignerFixture.create();
    const authority = signer.authority;
    const issue = vi.spyOn(authority, 'issue');
    const source = {
      snapshot: vi.fn(async (_userId: string) => workspaceSnapshot()),
    };
    const mcpService = new NodeStreamableHttpMcpService<LucidProductMcpToolName>({
      capabilityVerifier: signer.verifier(),
      toolset: createLucidProductToolset(
        new UserWorkspaceProjectionReader({
          tenantId: 'tenant-a',
          productSessionId: 'product-session-a',
        }, source),
        { now: () => MCP_TEST_NOW },
      ),
    });
    const { server: mcpHttpServer, endpoint: mcpEndpoint } = await startMcp(
      mcpService,
    );
    let safeInvocationMetadata: string | undefined;
    let toolResult: unknown;
    const hostFixture = await LocalExecutionHostContractFixture.start({
      now: () => MCP_TEST_NOW,
      createRunId: () => 'run-001',
      execute: async (invocation) => {
        safeInvocationMetadata = JSON.stringify(invocation);
        const capability = invocation.mcpCapability();
        if (!capability) {
          throw new Error('Expected a Lucid product MCP capability.');
        }
        const client = new Client({
          name: 'lucid-hosted-conversation-test',
          version: '1.0.0',
        });
        try {
          await client.connect(new StreamableHTTPClientTransport(mcpEndpoint, {
            requestInit: {
              headers: { authorization: `Bearer ${capability}` },
              signal: invocation.signal,
            },
          }));
          toolResult = await client.callTool({
            name: READ_WORKSPACE_SNAPSHOT_TOOL,
            arguments: {},
          });
          await invocation.publishActivity({
            type: 'lucid_workspace_snapshot_read',
            workspaceId: 'local-discovery-workspace',
          });
          return {
            kind: 'result',
            result: {
              outcome: 'done',
              summary: 'Lucid workspace snapshot read through MCP.',
            },
          };
        } finally {
          await client.close().catch(() => undefined);
        }
      },
    });
    const modelApiKey = 'model-key-local-round-trip';
    const modelCredentials = {
      resolveModelCredential: vi.fn(async () => ({
        type: 'api-key' as const,
        apiKey: modelApiKey,
      })),
    };
    const service = new HostedConversationTurnService({
      authority,
      executionHost: hostFixture.createExecutionHost(),
      modelCredentials,
      mcp: { allowedTools: [READ_WORKSPACE_SNAPSHOT_TOOL] },
    });

    try {
      const events = [];
      for await (const event of service.streamTurn({
        scope: {
          tenantId: 'tenant-a',
          subjectId: 'subject-a',
          productSessionId: 'product-session-a',
        },
        runtimeSessionId: `runtime-session:${'a'.repeat(40)}`,
        invocationId: 'invocation-001',
        prompt: 'Read my Lucid workspace and summarize its current state.',
      })) {
        events.push(event);
      }

      const issued = await issue.mock.results[0]!.value;
      const executionAssertion = issued.executionAssertion();
      const mcpCapability = issued.mcpCapability();
      expect(events.map(({ kind }) => kind)).toEqual([
        'accepted',
        'activity',
        'result',
      ]);
      expect(events[1]).toMatchObject({
        kind: 'activity',
        activity: {
          type: 'lucid_workspace_snapshot_read',
          workspaceId: 'local-discovery-workspace',
        },
      });
      expect(events[2]).toMatchObject({
        kind: 'result',
        result: {
          outcome: 'done',
          summary: 'Lucid workspace snapshot read through MCP.',
        },
      });
      expect(JSON.stringify(toolResult)).toContain(
        'local-discovery-workspace',
      );
      expect(source.snapshot).toHaveBeenCalledOnce();
      expect(modelCredentials.resolveModelCredential).toHaveBeenCalledOnce();
      expect(safeInvocationMetadata).toBe(JSON.stringify({
        schemaVersion: 1,
        kind: 'conversation-turn',
        invocationId: 'invocation-001',
        runtimeSessionId: `runtime-session:${'a'.repeat(40)}`,
      }));
      const observableOutput = JSON.stringify({
        events,
        safeInvocationMetadata,
        toolResult,
      });
      expect(observableOutput).not.toContain(executionAssertion);
      expect(observableOutput).not.toContain(mcpCapability);
      expect(observableOutput).not.toContain(modelApiKey);
    } finally {
      await hostFixture.close();
      await mcpService.close();
      mcpHttpServer.closeAllConnections();
      if (mcpHttpServer.listening) {
        await new Promise<void>((resolve) => {
          mcpHttpServer.close(() => resolve());
        });
      }
    }
  });
});

async function startMcp(
  service: NodeStreamableHttpMcpService<LucidProductMcpToolName>,
): Promise<{ server: HttpServer; endpoint: URL }> {
  const server = createServer((request, response) => {
    void service.handle(request, response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    endpoint: new URL(`http://127.0.0.1:${address.port}/mcp`),
  };
}

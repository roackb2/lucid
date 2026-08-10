import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  StreamableHTTPServerTransport,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  assertMcpCapabilityActive,
  McpCapabilityUnavailableError,
  McpCapabilityVerificationError,
  type McpCapabilityVerifier,
  type VerifiedMcpCapability,
} from '@roackb2/heddle-adopter/mcp';
import { z } from 'zod';
import {
  READ_WORKSPACE_SNAPSHOT_TOOL,
  type LucidProductMcpToolName,
  type ScopedWorkspaceProjectionReader,
} from './types.js';

const DEFAULT_MAX_BODY_BYTES = 64 * 1_024;
const MAX_CAPABILITY_CHARACTERS = 4_096;

type McpRequestResources = {
  abortController: AbortController;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  closing?: Promise<void>;
};

class McpRequestBodyError extends Error {
  constructor(readonly statusCode: 400 | 413 | 415) {
    super('Invalid MCP request body.');
  }
}

/**
 * Stateless Streamable HTTP edge for model-invokable Lucid product tools.
 * Every request re-verifies its bearer and owns isolated SDK resources.
 */
export class LucidProductMcpService {
  private readonly activeRequests = new Set<McpRequestResources>();
  private readonly now: () => Date;
  private readonly maxBodyBytes: number;

  constructor(
    private readonly capabilityVerifier:
      McpCapabilityVerifier<LucidProductMcpToolName>,
    private readonly workspaceReader: ScopedWorkspaceProjectionReader,
    options: {
      maxBodyBytes?: number;
      now?: () => Date;
    } = {},
  ) {
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    this.now = options.now ?? (() => new Date());
  }

  async handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Vary', 'Authorization');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'POST') {
      request.resume();
      writeJsonRpcError(response, 405, 'Method not allowed.');
      return;
    }

    const assertion = takeBearer(request);
    if (!assertion) {
      request.resume();
      writeJsonRpcError(response, 401, 'Authentication is required.', {
        'WWW-Authenticate': 'Bearer',
      });
      return;
    }

    let capability: VerifiedMcpCapability<LucidProductMcpToolName>;
    try {
      capability = await this.capabilityVerifier.verify(assertion);
    } catch (error) {
      request.resume();
      if (error instanceof McpCapabilityUnavailableError) {
        writeJsonRpcError(response, 503, 'Authentication is temporarily unavailable.', {
          'Retry-After': '1',
        });
        return;
      }
      writeJsonRpcError(response, 401, 'Authentication failed.', {
        'WWW-Authenticate': 'Bearer error="invalid_token"',
      });
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(request, this.maxBodyBytes);
    } catch (error) {
      const statusCode = error instanceof McpRequestBodyError
        ? error.statusCode
        : 400;
      writeJsonRpcError(response, statusCode, 'Invalid MCP request.');
      return;
    }

    const abortController = new AbortController();
    const server = this.createServer(capability, abortController.signal);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    const resources = { abortController, server, transport };
    this.activeRequests.add(resources);
    const cleanup = () => void this.closeRequest(resources);
    request.once('aborted', cleanup);
    response.once('close', cleanup);

    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent && !response.destroyed) {
        writeJsonRpcError(response, 500, 'MCP request failed.');
      }
    } finally {
      if (response.writableEnded || response.destroyed) {
        await this.closeRequest(resources);
      }
    }
  }

  /** Closes in-flight SDK transports during process shutdown. */
  async close(): Promise<void> {
    await Promise.all([...this.activeRequests].map((resources) => (
      this.closeRequest(resources)
    )));
  }

  private createServer(
    capability: VerifiedMcpCapability<LucidProductMcpToolName>,
    requestSignal: AbortSignal,
  ): McpServer {
    const server = new McpServer({
      name: 'lucid-product',
      version: '1.0.0',
    });
    const allowedTools = new Set(capability.allowedTools);
    if (allowedTools.has(READ_WORKSPACE_SNAPSHOT_TOOL)) {
      server.registerTool(
        READ_WORKSPACE_SNAPSHOT_TOOL,
        {
          description:
            'Read the participant-scoped Lucid workspace, current assignment, working direction, findings, and background-check status.',
          inputSchema: z.object({}).strict(),
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        async (_input, extra) => this.readWorkspace(
          capability,
          AbortSignal.any([requestSignal, extra.signal]),
        ),
      );
    }
    return server;
  }

  private async readWorkspace(
    capability: VerifiedMcpCapability<LucidProductMcpToolName>,
    signal: AbortSignal,
  ) {
    try {
      signal.throwIfAborted();
      assertMcpCapabilityActive(capability, this.now());
      const snapshot = await this.workspaceReader.readWorkspaceProjection({
        scope: capability.scope,
        signal,
      });
      signal.throwIfAborted();
      assertMcpCapabilityActive(capability, this.now());
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(snapshot),
        }],
      };
    } catch (error) {
      const message = signal.aborted
        ? 'Lucid workspace reading was cancelled.'
        : error instanceof McpCapabilityVerificationError
          ? 'Lucid MCP authority expired.'
          : 'Lucid workspace projection is unavailable.';
      return {
        isError: true,
        content: [{ type: 'text' as const, text: message }],
      };
    }
  }

  private async closeRequest(resources: McpRequestResources): Promise<void> {
    resources.abortController.abort(
      new Error('The owning MCP HTTP request closed.'),
    );
    resources.closing ??= Promise.all([
      resources.transport.close().catch(() => undefined),
      resources.server.close().catch(() => undefined),
    ]).then(() => {
      this.activeRequests.delete(resources);
    });
    await resources.closing;
  }
}

function takeBearer(request: IncomingMessage): string | undefined {
  const value = request.headers.authorization;
  delete request.headers.authorization;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === 'authorization') {
      request.rawHeaders[index + 1] = '[REDACTED]';
    }
  }
  return readBearer(value);
}

function readBearer(value: string | undefined): string | undefined {
  const match = /^Bearer ([^\s]+)$/i.exec(value?.trim() ?? '');
  if (!match) {
    return undefined;
  }
  const assertion = match[1]!;
  return assertion.length > 0 && assertion.length <= MAX_CAPABILITY_CHARACTERS
    && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(assertion)
    ? assertion
    : undefined;
}

async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes: number,
): Promise<unknown> {
  const contentType = request.headers['content-type']
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== 'application/json') {
    throw new McpRequestBodyError(415);
  }
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    request.resume();
    throw new McpRequestBodyError(413);
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > maxBodyBytes) {
      request.resume();
      throw new McpRequestBodyError(413);
    }
    chunks.push(buffer);
  }
  if (!request.complete) {
    throw new McpRequestBodyError(400);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new McpRequestBodyError(400);
  }
}

function writeJsonRpcError(
  response: ServerResponse,
  statusCode: number,
  message: string,
  headers: Record<string, string> = {},
): void {
  if (response.headersSent || response.destroyed) {
    return;
  }
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
    ...headers,
  });
  response.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32_000, message },
    id: null,
  }));
}

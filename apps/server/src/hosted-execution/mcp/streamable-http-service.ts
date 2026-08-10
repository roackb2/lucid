import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  StreamableHTTPServerTransport,
} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  McpCapabilityUnavailableError,
  type McpCapabilityVerifier,
  type VerifiedMcpCapability,
} from '@roackb2/heddle-adopter/mcp';

const DEFAULT_MAX_BODY_BYTES = 64 * 1_024;
const MAX_CAPABILITY_CHARACTERS = 4_096;

type McpRequestResources = {
  abortController: AbortController;
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  closing?: Promise<void>;
};

export type McpToolRegistrationContext<TTool extends string> = {
  server: McpServer;
  capability: VerifiedMcpCapability<TTool>;
  requestSignal: AbortSignal;
};

/** Product-owned tool registration plugged into the generic MCP HTTP edge. */
export interface McpToolset<TTool extends string> {
  readonly serverInfo: Readonly<{ name: string; version: string }>;
  registerAllowedTools(context: McpToolRegistrationContext<TTool>): void;
}

class McpRequestBodyError extends Error {
  constructor(readonly statusCode: 400 | 413 | 415) {
    super('Invalid MCP request body.');
  }
}

/**
 * Generic stateless Streamable HTTP MCP edge.
 *
 * This service owns protocol concerns only. The injected toolset owns every
 * model-visible tool name, schema, description, and product operation.
 */
export class StreamableHttpMcpService<TTool extends string> {
  private readonly activeRequests = new Set<McpRequestResources>();
  private readonly maxBodyBytes: number;

  constructor(
    private readonly capabilityVerifier: McpCapabilityVerifier<TTool>,
    private readonly toolset: McpToolset<TTool>,
    options: { maxBodyBytes?: number } = {},
  ) {
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  }

  /** Handles one authenticated, stateless MCP HTTP request. */
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

    let capability: VerifiedMcpCapability<TTool>;
    try {
      capability = await this.capabilityVerifier.verify(assertion);
    } catch (error) {
      request.resume();
      if (error instanceof McpCapabilityUnavailableError) {
        writeJsonRpcError(
          response,
          503,
          'Authentication is temporarily unavailable.',
          { 'Retry-After': '1' },
        );
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
    const server = new McpServer(this.toolset.serverInfo);
    this.toolset.registerAllowedTools({
      server,
      capability,
      requestSignal: abortController.signal,
    });
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

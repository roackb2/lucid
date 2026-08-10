import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ExecutionAuthority } from '@roackb2/heddle-adopter/authority';
import {
  ExecutionHostInvocationCancelledError,
} from '@roackb2/heddle-adopter/http-sse';
import { z } from 'zod';
import type { LucidAuthenticator } from '../auth/authenticator.js';
import type { LucidLogger } from '../logger.js';
import {
  HostedConversationAuthorizationError,
} from './conversation/admission-service.js';
import type {
  HostedConversationRequestService,
} from './conversation/types.js';
import type { StreamableHttpMcpService } from './mcp/streamable-http-service.js';
import type { LucidProductMcpToolName } from './mcp/types.js';

export const HOSTED_EXECUTION_JWKS_PATH = '/.well-known/jwks.json';
export const HOSTED_EXECUTION_MCP_PATH = '/hosted-execution/mcp';
export const HOSTED_CONVERSATION_TURNS_PATH =
  '/hosted-execution/conversation-turns';

const MAX_CONVERSATION_BODY_BYTES = 64 * 1_024;
const ConversationRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
}).strict();

class HostedConversationRequestError extends Error {
  constructor(readonly statusCode: 400 | 413 | 415) {
    super('Invalid hosted conversation request.');
  }
}

type ActiveConversationRequest = {
  abortController: AbortController;
  request: IncomingMessage;
  response: ServerResponse;
  pending: Promise<void>;
};

/** Raw HTTP routing for the language-neutral Execution Host integration. */
export class HostedExecutionHttpRouter {
  private readonly activeConversations = new Set<ActiveConversationRequest>();

  constructor(
    private readonly authenticator: LucidAuthenticator,
    private readonly authority: ExecutionAuthority,
    private readonly mcp: StreamableHttpMcpService<LucidProductMcpToolName>,
    private readonly conversations: HostedConversationRequestService,
    private readonly logger: LucidLogger,
  ) {}

  /** Handles a hosted-execution route or returns false for the tRPC adapter. */
  handle(request: IncomingMessage, response: ServerResponse): boolean {
    const pathname = readPathname(request.url);
    if (pathname === HOSTED_EXECUTION_JWKS_PATH) {
      this.handleJwks(request, response);
      return true;
    }
    if (pathname === HOSTED_EXECUTION_MCP_PATH) {
      void this.mcp.handle(request, response).catch((error) => {
        this.handleUnexpectedError('mcp', error, response);
      });
      return true;
    }
    if (pathname === HOSTED_CONVERSATION_TURNS_PATH) {
      this.startConversation(request, response);
      return true;
    }
    return false;
  }

  async close(): Promise<void> {
    const conversations = [...this.activeConversations];
    conversations.forEach(({ abortController, request, response }) => {
      abortController.abort(new Error('Lucid hosted execution is stopping.'));
      request.destroy();
      response.destroy();
    });
    await Promise.all(conversations.map(({ pending }) => pending));
    await this.mcp.close();
  }

  private startConversation(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    const abortController = new AbortController();
    const abort = () => abortController.abort(
      new Error('The owning Lucid conversation request closed.'),
    );
    request.once('aborted', abort);
    response.once('close', abort);
    const active = {
      abortController,
      request,
      response,
      pending: Promise.resolve(),
    };
    active.pending = this.handleConversation(
      request,
      response,
      abortController.signal,
    ).catch((error) => {
      this.handleUnexpectedError('conversation', error, response);
    }).finally(() => {
      request.removeListener('aborted', abort);
      response.removeListener('close', abort);
      this.activeConversations.delete(active);
    });
    this.activeConversations.add(active);
  }

  private handleJwks(
    request: IncomingMessage,
    response: ServerResponse,
  ): void {
    request.resume();
    if (request.method !== 'GET') {
      writeJsonError(response, 405, 'Method not allowed.');
      return;
    }
    response.writeHead(200, {
      'Cache-Control': 'public, max-age=60',
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify(this.authority.publicJwks()));
  }

  private async handleConversation(
    request: IncomingMessage,
    response: ServerResponse,
    signal: AbortSignal,
  ): Promise<void> {
    if (request.method !== 'POST') {
      request.resume();
      writeJsonError(response, 405, 'Method not allowed.');
      return;
    }

    const authorization = takeAuthorization(request);
    const principal = await this.authenticator.authenticate({
      authorization,
      remoteAddress: request.socket.remoteAddress,
    });
    if (!principal) {
      request.resume();
      writeJsonError(response, 401, 'Lucid authentication is required.', {
        'WWW-Authenticate': 'Bearer',
      });
      return;
    }

    let body: z.infer<typeof ConversationRequestSchema>;
    try {
      body = ConversationRequestSchema.parse(
        await readJsonBody(request, MAX_CONVERSATION_BODY_BYTES),
      );
    } catch (error) {
      const statusCode = error instanceof HostedConversationRequestError
        ? error.statusCode
        : 400;
      writeJsonError(response, statusCode, 'Invalid conversation request.');
      return;
    }

    let streamed = false;

    try {
      for await (const event of this.conversations.streamTurn({
        principal,
        prompt: body.prompt,
        signal,
      })) {
        if (!streamed) {
          response.writeHead(200, {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/event-stream; charset=utf-8',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
            'X-Content-Type-Options': 'nosniff',
          });
          streamed = true;
        }
        await writeSseEvent(response, event, signal);
      }
      if (!streamed) {
        writeJsonError(response, 502, 'Execution Host returned no events.');
        return;
      }
      response.end();
    } catch (error) {
      if (
        error instanceof HostedConversationAuthorizationError
        && !response.headersSent
      ) {
        writeJsonError(response, 403, error.message);
        return;
      }
      if (
        error instanceof ExecutionHostInvocationCancelledError
        || signal.aborted
      ) {
        if (!response.headersSent && !response.destroyed) {
          writeJsonError(response, 499, 'Hosted conversation was cancelled.');
        }
        return;
      }
      this.logger.warn({
        errorType: error instanceof Error ? error.name : 'unknown',
      }, 'lucid.hosted_conversation.interrupted');
      if (!response.headersSent) {
        writeJsonError(response, 502, 'Execution Host conversation failed.');
        return;
      }
      // A post-acceptance failure deliberately ends without a terminal event.
      // Strict consumers must classify that stream as interrupted, never done.
      response.end();
    }
  }

  private handleUnexpectedError(
    route: 'mcp' | 'conversation',
    error: unknown,
    response: ServerResponse,
  ): void {
    this.logger.error({
      route,
      errorType: error instanceof Error ? error.name : 'unknown',
    }, 'lucid.hosted_execution.http_failed');
    if (!response.headersSent && !response.destroyed) {
      writeJsonError(response, 500, 'Hosted execution request failed.');
    } else if (!response.destroyed && !response.writableEnded) {
      response.end();
    }
  }
}

function readPathname(rawUrl: string | undefined): string | undefined {
  try {
    return new URL(rawUrl ?? '/', 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}

function takeAuthorization(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  delete request.headers.authorization;
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === 'authorization') {
      request.rawHeaders[index + 1] = '[REDACTED]';
    }
  }
  return authorization;
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
    throw new HostedConversationRequestError(415);
  }
  const declaredLength = Number(request.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    request.resume();
    throw new HostedConversationRequestError(413);
  }

  const chunks: Buffer[] = [];
  let receivedBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    receivedBytes += buffer.byteLength;
    if (receivedBytes > maxBodyBytes) {
      request.resume();
      throw new HostedConversationRequestError(413);
    }
    chunks.push(buffer);
  }
  if (!request.complete) {
    throw new HostedConversationRequestError(400);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new HostedConversationRequestError(400);
  }
}

async function writeSseEvent(
  response: ServerResponse,
  event: {
    kind: string;
    sequence: number;
  },
  signal: AbortSignal,
): Promise<void> {
  const frame = `event: ${event.kind}\nid: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`;
  if (!response.write(frame)) {
    await once(response, 'drain', { signal });
  }
}

function writeJsonError(
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
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify({ error: { message } }));
}

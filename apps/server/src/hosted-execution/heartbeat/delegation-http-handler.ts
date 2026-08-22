import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import type { LucidLogger } from '../../logger.js';
import { HostedHeartbeatDelegationCredentials } from './coordinator-credentials.js';
import {
  HOSTED_HEARTBEAT_DELEGATIONS_PATH,
  HostedHeartbeatDelegationRejectedError,
  HostedHeartbeatDelegationRequestSchema,
  type HostedHeartbeatDelegationService,
} from './delegation-service.js';

const MAX_BODY_BYTES = 16 * 1_024;

/** Narrow authenticated Node HTTP edge for one-run coordinator delegation. */
export class HostedHeartbeatDelegationHttpHandler {
  constructor(
    private readonly service: HostedHeartbeatDelegationService,
    private readonly credentials: HostedHeartbeatDelegationCredentials,
    private readonly logger: LucidLogger,
  ) {}

  handle(request: IncomingMessage, response: ServerResponse): boolean {
    if (readPathname(request.url) !== HOSTED_HEARTBEAT_DELEGATIONS_PATH) {
      return false;
    }
    void this.#handle(request, response);
    return true;
  }

  async #handle(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      writeJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    if (!this.credentials.authenticates(request.headers.authorization)) {
      writeJson(response, 401, { error: 'Unauthorized.' });
      return;
    }

    const controller = new AbortController();
    request.once('aborted', () => controller.abort());
    try {
      const input = HostedHeartbeatDelegationRequestSchema.parse(
        JSON.parse(await readBody(request)),
      );
      const delegation = await this.service.issue(input, controller.signal);
      writeJson(response, 200, delegation);
    } catch (error) {
      if (error instanceof HostedHeartbeatDelegationRejectedError) {
        writeJson(response, 403, { error: error.message });
        return;
      }
      if (error instanceof SyntaxError || error instanceof ZodError) {
        writeJson(response, 400, {
          error: 'Invalid heartbeat delegation request.',
        });
        return;
      }
      if (controller.signal.aborted) {
        return;
      }
      this.logger.error({
        errorType: error instanceof Error ? error.name : 'unknown',
      }, 'lucid.hosted_heartbeat.delegation_failed');
      writeJson(response, 500, { error: 'Heartbeat delegation failed.' });
    }
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  const declaredLength = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new SyntaxError('Request body is too large.');
  }
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_BODY_BYTES) {
      throw new SyntaxError('Request body is too large.');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function writeJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

function readPathname(rawUrl: string | undefined): string | undefined {
  try {
    return new URL(rawUrl ?? '/', 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}

import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  NodeStreamableHttpMcpService,
} from '@heddleagent/execution-host-client/mcp/node';
import {
  DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH,
  DEFAULT_ADOPTER_JWKS_PATH,
  type NodeExecutionAdopterHttpHandler,
} from '@heddleagent/execution-host-client/node';
import type { LucidLogger } from '../logger.js';
import type {
  HostedHeartbeatDelegationHttpHandler,
} from './heartbeat/delegation-http-handler.js';
import type { LucidProductMcpToolName } from './mcp/types.js';

export const HOSTED_EXECUTION_JWKS_PATH = DEFAULT_ADOPTER_JWKS_PATH;
export const HOSTED_EXECUTION_MCP_PATH = '/hosted-execution/mcp';
export const HOSTED_CONVERSATION_TURNS_PATH =
  DEFAULT_ADOPTER_CONVERSATION_TURNS_PATH;

/**
 * Mounts generic adopter HTTP services at Lucid-owned paths.
 *
 * Protocol parsing, credentials, SSE, MCP lifecycle, and shutdown live in the
 * public package. This router owns only coexistence with Lucid's tRPC server.
 */
export class HostedExecutionHttpRouter {
  constructor(
    private readonly adopterHttp: NodeExecutionAdopterHttpHandler,
    private readonly mcp: NodeStreamableHttpMcpService<LucidProductMcpToolName>,
    private readonly logger: LucidLogger,
    private readonly heartbeatDelegations?: HostedHeartbeatDelegationHttpHandler,
  ) {}

  /** Handles a hosted-execution route or returns false for the tRPC adapter. */
  handle(request: IncomingMessage, response: ServerResponse): boolean {
    if (this.heartbeatDelegations?.handle(request, response)) {
      return true;
    }
    if (readPathname(request.url) === HOSTED_EXECUTION_MCP_PATH) {
      void this.mcp.handle(request, response).catch((error) => {
        this.logger.error({
          route: 'mcp',
          errorType: error instanceof Error ? error.name : 'unknown',
        }, 'lucid.hosted_execution.http_failed');
        if (!response.headersSent && !response.destroyed) {
          response.writeHead(500, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          });
          response.end(JSON.stringify({
            error: { message: 'Hosted execution request failed.' },
          }));
        } else if (!response.destroyed && !response.writableEnded) {
          response.end();
        }
      });
      return true;
    }
    return this.adopterHttp.handle(request, response);
  }

  async close(): Promise<void> {
    await Promise.all([
      this.adopterHttp.close(),
      this.mcp.close(),
    ]);
  }
}

function readPathname(rawUrl: string | undefined): string | undefined {
  try {
    return new URL(rawUrl ?? '/', 'http://localhost').pathname;
  } catch {
    return undefined;
  }
}

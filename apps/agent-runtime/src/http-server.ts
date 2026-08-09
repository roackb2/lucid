import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { z, ZodError } from 'zod';
import type { RuntimeConfig } from './config.js';
import {
  AGENTCORE_RUNTIME_SESSION_HEADER,
  LOCAL_RUNTIME_TOKEN_HEADER,
  MODEL_API_KEY_HEADER,
  RuntimeInvocationSchema,
  RuntimeSessionIdSchema,
  type RuntimeApiError,
  type RuntimeStreamEvent,
} from './contracts.js';
import {
  RuntimeAuthenticationError,
  authenticateRuntimeRequest,
} from './request-auth.js';
import {
  AgentRuntimeService,
  RuntimeBusyError,
  RuntimeDeadlineError,
  RuntimeDuplicateInvocationError,
} from './runtime-service.js';
import { RuntimeScopeMismatchError } from './scope-binding.js';

const ModelApiKeySchema = z.string().trim().min(8).max(4_096);

export type RuntimeHttpLogger = {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
  error(context: Record<string, unknown>, message: string): void;
};

const SILENT_LOGGER: RuntimeHttpLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function createRuntimeHttpApp(input: {
  config: Pick<RuntimeConfig, 'mode' | 'localTokenSha256' | 'keepAliveMs'>;
  runtime: AgentRuntimeService;
  logger?: RuntimeHttpLogger;
}): Express {
  const app = express();
  const logger = input.logger ?? SILENT_LOGGER;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb', strict: true }));

  app.get('/ping', (_request, response) => {
    response.status(200).json(input.runtime.health().read());
  });

  app.post('/invocations', async (request, response) => {
    const callerController = new AbortController();
    let terminalWritten = false;
    const abortCaller = () => {
      if (!terminalWritten) {
        callerController.abort(new Error('Invocation client disconnected.'));
      }
    };
    request.once('aborted', abortCaller);
    response.once('close', abortCaller);

    try {
      const localToken = takeSensitiveHeader(request, LOCAL_RUNTIME_TOKEN_HEADER);
      authenticateRuntimeRequest({
        config: input.config,
        providedToken: localToken,
      });

      const runtimeSessionId = RuntimeSessionIdSchema.parse(
        request.header(AGENTCORE_RUNTIME_SESSION_HEADER),
      );
      const modelApiKey = ModelApiKeySchema.parse(
        takeSensitiveHeader(request, MODEL_API_KEY_HEADER),
      );
      const invocation = RuntimeInvocationSchema.parse(request.body);

      const run = await input.runtime.start({
        runtimeSessionId,
        invocation,
        modelApiKey,
        callerSignal: callerController.signal,
      });

      if (response.destroyed || callerController.signal.aborted) {
        run.cancel();
        return;
      }

      response.status(200);
      response.set({
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'Content-Type': 'text/event-stream; charset=utf-8',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();

      const accepted: RuntimeStreamEvent = {
        schemaVersion: 1,
        invocationId: invocation.invocationId,
        runId: run.runId,
        sequence: 0,
        timestamp: run.acceptedAt,
        kind: 'accepted',
      };
      await writeRuntimeSseEvent(response, accepted);

      const keepAlive = setInterval(() => {
        if (!response.destroyed && !response.writableNeedDrain) {
          response.write(': keep-alive\n\n');
        }
      }, input.config.keepAliveMs);
      keepAlive.unref();

      try {
        for await (const event of run.events()) {
          const projected = {
            schemaVersion: 1 as const,
            invocationId: invocation.invocationId,
            ...event,
          } satisfies RuntimeStreamEvent;
          await writeRuntimeSseEvent(response, projected);
          if (event.kind !== 'activity') {
            terminalWritten = true;
          }
        }
      } finally {
        clearInterval(keepAlive);
      }

      if (!response.destroyed) {
        response.end();
      }
      logger.info(
        {
          invocationId: invocation.invocationId,
          runId: run.runId,
          scopeKey: input.runtime.boundScope()?.scopeKey.slice(0, 12),
        },
        'Runtime invocation settled',
      );
    } catch (error) {
      if (response.headersSent) {
        const log = error instanceof RuntimeStreamDisconnectedError
          ? logger.info.bind(logger)
          : logger.error.bind(logger);
        log({ error: errorName(error) }, 'Runtime stream ended after acceptance');
        response.destroy();
        return;
      }
      const apiError = toApiError(error);
      if (apiError.status >= 500) {
        logger.error({ error: errorName(error) }, 'Runtime invocation failed');
      } else {
        logger.warn({ code: apiError.body.error.code }, 'Runtime invocation rejected');
      }
      response.status(apiError.status).json(apiError.body);
    } finally {
      request.removeListener('aborted', abortCaller);
      response.removeListener('close', abortCaller);
    }
  });

  app.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction,
    ) => {
      const apiError = toApiError(error);
      logger.warn({ code: apiError.body.error.code }, 'Runtime request rejected');
      response.status(apiError.status).json(apiError.body);
    },
  );

  return app;
}

class RuntimeStreamDisconnectedError extends Error {
  readonly name = 'RuntimeStreamDisconnectedError';
}

/** Applies Node stream backpressure so a slow SSE reader cannot grow memory unboundedly. */
export function writeRuntimeSseEvent(
  response: Response,
  event: RuntimeStreamEvent,
): Promise<void> {
  if (response.destroyed) {
    return Promise.reject(new RuntimeStreamDisconnectedError('Runtime SSE consumer disconnected.'));
  }

  const frame = [
    `id: ${event.sequence}`,
    `event: ${event.kind}`,
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n');
  if (response.write(frame)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      response.removeListener('drain', handleDrain);
      response.removeListener('close', handleClose);
      response.removeListener('error', handleError);
    };
    const handleDrain = () => {
      cleanup();
      resolve();
    };
    const handleClose = () => {
      cleanup();
      reject(new RuntimeStreamDisconnectedError('Runtime SSE consumer disconnected.'));
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };

    response.once('drain', handleDrain);
    response.once('close', handleClose);
    response.once('error', handleError);
  });
}

/** Removes a credential from both Node's normalized and original header views. */
export function takeSensitiveHeader(request: Request, name: string): string | undefined {
  const normalizedName = name.toLowerCase();
  const value = request.header(name);
  delete request.headers[normalizedName];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === normalizedName) {
      request.rawHeaders[index + 1] = '[redacted]';
    }
  }
  return value;
}

function toApiError(error: unknown): { status: number; body: RuntimeApiError } {
  if (error instanceof RuntimeAuthenticationError) {
    return apiError(401, 'unauthorized', 'Runtime request authentication failed.');
  }
  if (error instanceof RuntimeScopeMismatchError) {
    return apiError(409, 'scope_mismatch', error.message);
  }
  if (error instanceof RuntimeBusyError) {
    return apiError(409, 'runtime_busy', error.message);
  }
  if (error instanceof RuntimeDuplicateInvocationError) {
    return apiError(409, 'duplicate_invocation', error.message);
  }
  if (error instanceof RuntimeDeadlineError) {
    return apiError(400, 'invalid_deadline', error.message);
  }
  if (error instanceof ZodError || isJsonParseError(error)) {
    return apiError(400, 'invalid_request', 'Runtime request validation failed.');
  }
  return apiError(500, 'internal_error', 'The runtime invocation failed.');
}

function apiError(status: number, code: string, message: string) {
  return {
    status,
    body: {
      error: { code, message },
    },
  };
}

function isJsonParseError(error: unknown): boolean {
  return error instanceof SyntaxError && 'status' in error;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

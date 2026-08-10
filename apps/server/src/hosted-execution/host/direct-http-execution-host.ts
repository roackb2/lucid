import { createParser, type EventSourceMessage } from 'eventsource-parser';
import { z } from 'zod';
import {
  ExecutionHostInvocationCancelledError,
  ExecutionHostProtocolError,
  ExecutionHostRejectedError,
  ExecutionHostStreamInterruptedError,
} from './errors.js';
import {
  ExecutionHostConversationTurnSchema,
  ExecutionHostStreamEventSchema,
  type ExecutionHost,
  type ExecutionHostConversationTurn,
  type ExecutionHostStreamEvent,
} from './types.js';

const RUNTIME_SESSION_HEADER =
  'x-amzn-bedrock-agentcore-runtime-session-id';
const LOCAL_TOKEN_HEADER = 'x-heddle-execution-host-local-token';
const MODEL_API_KEY_HEADER = 'x-heddle-execution-host-model-api-key';
const EXECUTION_ASSERTION_HEADER = 'x-heddle-execution-host-assertion';
const MCP_CAPABILITY_HEADER = 'x-heddle-execution-host-mcp-capability';
const MAX_SSE_BUFFER_CHARACTERS = 1_048_576;
const MAX_ERROR_BODY_CHARACTERS = 16_384;

const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().trim().min(1).max(128).regex(/^[a-z0-9_]+$/),
    message: z.string(),
  }).strict(),
}).strict();

export type DirectHttpExecutionHostConfig = {
  baseUrl: URL;
  localToken: string;
  fetch?: typeof fetch;
};

/**
 * Calls the Execution Host's direct HTTP development ingress.
 *
 * This adapter deliberately owns no AWS SDK or SigV4 behavior. A future
 * AgentCore adapter implements the same port while the consuming service stays
 * provider-neutral.
 */
export class DirectHttpExecutionHost implements ExecutionHost {
  readonly #endpoint: URL;
  readonly #fetch: typeof fetch;
  readonly #localToken: string;

  constructor(config: DirectHttpExecutionHostConfig) {
    assertSafeBaseUrl(config.baseUrl);
    if (!config.localToken.trim()) {
      throw new Error('Direct Execution Host local token is required.');
    }
    this.#endpoint = new URL('/invocations', config.baseUrl);
    this.#fetch = config.fetch ?? globalThis.fetch;
    this.#localToken = config.localToken;
  }

  async *streamConversationTurn(
    rawInput: ExecutionHostConversationTurn,
  ): AsyncIterable<ExecutionHostStreamEvent> {
    const input = ExecutionHostConversationTurnSchema.parse(rawInput);
    if (input.signal?.aborted) {
      throw new ExecutionHostInvocationCancelledError();
    }

    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: input.signal,
        headers: createSensitiveHeaders(input, this.#localToken),
        body: JSON.stringify({
          schemaVersion: 1,
          kind: 'conversation-turn',
          invocationId: input.invocationId,
          prompt: input.prompt,
          ...(input.deadlineAt ? { deadlineAt: input.deadlineAt } : {}),
        }),
      });
    } catch (error) {
      throw toTransportError(error, input.signal);
    }

    if (!response.ok) {
      throw new ExecutionHostRejectedError(
        response.status,
        await readSafeErrorCode(response),
      );
    }
    if (!isEventStream(response.headers.get('content-type'))) {
      throw new ExecutionHostProtocolError(
        'Execution Host did not return an SSE stream.',
      );
    }
    if (!response.body) {
      throw new ExecutionHostProtocolError(
        'Execution Host returned an empty SSE response body.',
      );
    }

    const decoder = new TextDecoder();
    const pending: EventSourceMessage[] = [];
    let parserError: Error | undefined;
    const parser = createParser({
      maxBufferSize: MAX_SSE_BUFFER_CHARACTERS,
      onEvent: (event) => pending.push(event),
      onError: (error) => {
        parserError = error;
      },
    });
    const state: StreamValidationState = {
      invocationId: input.invocationId,
      nextSequence: 0,
      terminal: false,
    };
    let terminalEvent: ExecutionHostStreamEvent | undefined;

    try {
      for await (const chunk of response.body) {
        input.signal?.throwIfAborted();
        parser.feed(decoder.decode(chunk, { stream: true }));
        if (parserError) {
          throw new ExecutionHostProtocolError();
        }
        while (pending.length > 0) {
          const event = validateEvent(pending.shift()!, state);
          if (isTerminalEvent(event)) {
            terminalEvent = event;
          } else {
            yield event;
          }
        }
      }
      parser.feed(decoder.decode());
      parser.reset({ consume: true });
      if (parserError || pending.length > 0) {
        while (!parserError && pending.length > 0) {
          const event = validateEvent(pending.shift()!, state);
          if (isTerminalEvent(event)) {
            terminalEvent = event;
          } else {
            yield event;
          }
        }
        if (parserError) {
          throw new ExecutionHostProtocolError();
        }
      }
    } catch (error) {
      if (
        error instanceof ExecutionHostProtocolError
        || error instanceof ExecutionHostInvocationCancelledError
      ) {
        throw error;
      }
      throw toTransportError(error, input.signal);
    }

    if (!state.accepted) {
      throw new ExecutionHostProtocolError(
        'Execution Host stream omitted the accepted event.',
      );
    }
    if (!state.terminal) {
      throw new ExecutionHostStreamInterruptedError();
    }
    // Hold the terminal until clean EOF. This prevents a caller from
    // projecting success before a trailing malformed or post-terminal frame is
    // discovered.
    yield terminalEvent!;
  }
}

type StreamValidationState = {
  invocationId: string;
  runId?: string;
  nextSequence: number;
  accepted?: true;
  terminal: boolean;
};

function validateEvent(
  frame: EventSourceMessage,
  state: StreamValidationState,
): ExecutionHostStreamEvent {
  let decoded: unknown;
  try {
    decoded = JSON.parse(frame.data);
  } catch {
    throw new ExecutionHostProtocolError();
  }
  const parsed = ExecutionHostStreamEventSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ExecutionHostProtocolError();
  }
  const event = parsed.data;
  const correctFrameMetadata = frame.event === event.kind
    && frame.id === String(event.sequence);
  const correctEnvelope = event.invocationId === state.invocationId
    && event.sequence === state.nextSequence;
  if (!correctFrameMetadata || !correctEnvelope || state.terminal) {
    throw new ExecutionHostProtocolError();
  }

  if (!state.accepted) {
    if (event.kind !== 'accepted') {
      throw new ExecutionHostProtocolError();
    }
    state.accepted = true;
    state.runId = event.runId;
  } else if (event.kind === 'accepted' || event.runId !== state.runId) {
    throw new ExecutionHostProtocolError();
  }

  state.nextSequence += 1;
  state.terminal = event.kind !== 'accepted' && event.kind !== 'activity';
  return event;
}

function createSensitiveHeaders(
  input: z.infer<typeof ExecutionHostConversationTurnSchema>,
  localToken: string,
): Headers {
  const headers = new Headers({
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
    [RUNTIME_SESSION_HEADER]: input.runtimeSessionId,
    [LOCAL_TOKEN_HEADER]: localToken,
    [MODEL_API_KEY_HEADER]: input.modelApiKey,
    [EXECUTION_ASSERTION_HEADER]: input.executionAssertion,
  });
  if (input.mcpCapability) {
    headers.set(MCP_CAPABILITY_HEADER, input.mcpCapability);
  }
  return headers;
}

function isEventStream(contentType: string | null): boolean {
  return contentType?.split(';', 1)[0]?.trim().toLowerCase()
    === 'text/event-stream';
}

function isTerminalEvent(event: ExecutionHostStreamEvent): boolean {
  return event.kind === 'result'
    || event.kind === 'cancelled'
    || event.kind === 'error';
}

async function readSafeErrorCode(response: Response): Promise<string> {
  try {
    const declaredLength = Number(response.headers.get('content-length'));
    if (
      Number.isFinite(declaredLength)
      && declaredLength > MAX_ERROR_BODY_CHARACTERS
    ) {
      await response.body?.cancel();
      return 'unknown';
    }
    const body = await response.text();
    if (body.length > MAX_ERROR_BODY_CHARACTERS) {
      return 'unknown';
    }
    const parsed = ApiErrorSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data.error.code : 'unknown';
  } catch {
    return 'unknown';
  }
}

function toTransportError(
  error: unknown,
  signal?: AbortSignal,
): Error {
  if (signal?.aborted || isAbortError(error)) {
    return new ExecutionHostInvocationCancelledError();
  }
  return new ExecutionHostStreamInterruptedError();
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function assertSafeBaseUrl(url: URL): void {
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  const safeProtocol = url.protocol === 'https:'
    || (url.protocol === 'http:' && loopback);
  if (
    !safeProtocol
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error(
      'Direct Execution Host URL must use HTTPS or loopback HTTP and contain no credentials, query, or fragment.',
    );
  }
}

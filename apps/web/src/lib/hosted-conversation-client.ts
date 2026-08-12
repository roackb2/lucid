import {
  ExecutionHostStreamEventSchema,
  type ExecutionHostStreamEvent,
} from '@roackb2/heddle-adopter/contracts';
import {
  createParser,
  type EventSourceMessage,
} from 'eventsource-parser';

const DEFAULT_ENDPOINT = '/hosted-execution/conversation-turns';
const MAX_ERROR_BODY_BYTES = 16_384;
const MAX_PENDING_FRAMES = 1_024;
const MAX_SSE_BUFFER_CHARACTERS = 1_048_576;

export class HostedConversationClientError extends Error {
  readonly name = 'HostedConversationClientError';
}

export type HostedConversationRequest = {
  prompt: string;
  accessToken: string;
  signal?: AbortSignal;
  endpoint?: string;
  fetch?: typeof fetch;
};

/**
 * Consumes Lucid's adopter-side endpoint through the canonical Heddle stream
 * contract. Product authentication stays in Lucid; stream shape and ordering
 * come from `@roackb2/heddle-adopter`.
 */
export async function* streamHostedConversation(
  input: HostedConversationRequest,
): AsyncIterable<ExecutionHostStreamEvent> {
  const prompt = input.prompt.trim();
  const accessToken = input.accessToken.trim();
  if (!prompt || !accessToken) {
    throw new HostedConversationClientError(
      'A prompt and participant access token are required.',
    );
  }
  input.signal?.throwIfAborted();

  const response = await (input.fetch ?? globalThis.fetch)(
    input.endpoint ?? DEFAULT_ENDPOINT,
    {
      method: 'POST',
      redirect: 'error',
      signal: input.signal,
      headers: {
        Accept: 'text/event-stream',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt }),
    },
  ).catch((error: unknown) => {
    if (input.signal?.aborted) {
      throw input.signal.reason ?? new DOMException(
        'The hosted conversation was cancelled.',
        'AbortError',
      );
    }
    throw new HostedConversationClientError(
      'Lucid could not reach the hosted agent.',
      { cause: error },
    );
  });

  if (!response.ok) {
    throw new HostedConversationClientError(
      await readPublicError(response),
    );
  }
  if (!isEventStream(response.headers.get('content-type')) || !response.body) {
    await response.body?.cancel();
    throw new HostedConversationClientError(
      'Lucid received an invalid hosted-agent response.',
    );
  }

  const pending: EventSourceMessage[] = [];
  let parserFailed = false;
  const parser = createParser({
    maxBufferSize: MAX_SSE_BUFFER_CHARACTERS,
    onEvent: (event) => {
      if (pending.length >= MAX_PENDING_FRAMES) {
        parserFailed = true;
        return;
      }
      pending.push(event);
    },
    onError: () => {
      parserFailed = true;
    },
  });
  const state: StreamState = { nextSequence: 0, terminal: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let terminal: ExecutionHostStreamEvent | undefined;

  try {
    while (true) {
      input.signal?.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      parser.feed(decoder.decode(value, { stream: true }));
      if (parserFailed) {
        throw protocolError();
      }
      for (const event of drainFrames(pending, state)) {
        if (isTerminal(event)) {
          terminal = event;
        } else {
          yield event;
        }
      }
    }
    parser.feed(decoder.decode());
    parser.reset({ consume: true });
    if (parserFailed) {
      throw protocolError();
    }
    for (const event of drainFrames(pending, state)) {
      if (isTerminal(event)) {
        terminal = event;
      } else {
        yield event;
      }
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (!state.accepted || !state.terminal || !terminal) {
    throw new HostedConversationClientError(
      'The hosted agent stopped before returning a final answer.',
    );
  }
  yield terminal;
}

type StreamState = {
  invocationId?: string;
  runId?: string;
  nextSequence: number;
  accepted?: true;
  terminal: boolean;
};

function drainFrames(
  pending: EventSourceMessage[],
  state: StreamState,
): ExecutionHostStreamEvent[] {
  const events: ExecutionHostStreamEvent[] = [];
  while (pending.length > 0) {
    const frame = pending.shift();
    if (frame) {
      events.push(parseFrame(frame, state));
    }
  }
  return events;
}

function parseFrame(
  frame: EventSourceMessage,
  state: StreamState,
): ExecutionHostStreamEvent {
  let body: unknown;
  try {
    body = JSON.parse(frame.data) as unknown;
  } catch {
    throw protocolError();
  }
  const parsed = ExecutionHostStreamEventSchema.safeParse(body);
  if (!parsed.success) {
    throw protocolError();
  }
  const event = parsed.data;
  const envelopeMatches = frame.id === String(event.sequence)
    && frame.event === event.kind
    && event.sequence === state.nextSequence;
  if (!envelopeMatches || state.terminal) {
    throw protocolError();
  }
  if (!state.accepted) {
    if (event.kind !== 'accepted') {
      throw protocolError();
    }
    state.accepted = true;
    state.invocationId = event.invocationId;
    state.runId = event.runId;
  } else if (
    event.kind === 'accepted'
    || event.invocationId !== state.invocationId
    || event.runId !== state.runId
  ) {
    throw protocolError();
  }
  state.nextSequence += 1;
  state.terminal = isTerminal(event);
  return event;
}

function isTerminal(event: ExecutionHostStreamEvent): boolean {
  return event.kind === 'result'
    || event.kind === 'cancelled'
    || event.kind === 'error';
}

function protocolError(): HostedConversationClientError {
  return new HostedConversationClientError(
    'Lucid received an invalid hosted-agent event stream.',
  );
}

function isEventStream(value: string | null): boolean {
  return value?.split(';', 1)[0]?.trim().toLowerCase()
    === 'text/event-stream';
}

async function readPublicError(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return fallbackError(response.status);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > MAX_ERROR_BODY_BYTES) {
        await reader.cancel();
        return fallbackError(response.status);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (
      value && typeof value === 'object'
      && 'error' in value
      && value.error && typeof value.error === 'object'
      && 'message' in value.error
      && typeof value.error.message === 'string'
    ) {
      return value.error.message;
    }
  } catch {
    // Only the server's bounded public message is eligible for presentation.
  }
  return fallbackError(response.status);
}

function fallbackError(status: number): string {
  return status === 401
    ? 'Your participant access token was not accepted.'
    : 'Lucid could not start the hosted conversation.';
}

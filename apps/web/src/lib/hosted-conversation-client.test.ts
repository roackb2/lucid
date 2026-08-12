import type { ExecutionHostStreamEvent } from '@roackb2/heddle-adopter/contracts';
import { describe, expect, it } from 'vitest';
import {
  HostedConversationClientError,
  streamHostedConversation,
} from './hosted-conversation-client';

const NOW = '2026-08-12T00:00:00.000Z';

describe('hosted conversation browser client', () => {
  it('authenticates and validates one ordered terminal stream', async () => {
    const events = [
      event(0, { kind: 'accepted' }),
      event(1, { kind: 'activity', activity: { type: 'tool.calling' } }),
      event(2, {
        kind: 'result',
        result: { outcome: 'done', summary: 'Workspace summary.' },
      }),
    ] satisfies ExecutionHostStreamEvent[];
    let observedInit: RequestInit | undefined;
    let requestCount = 0;
    const request: typeof fetch = async (_input, init) => {
      requestCount += 1;
      observedInit = init;
      return sseResponse(events);
    };

    expect(await collect(streamHostedConversation({
      accessToken: 'participant-token-value',
      prompt: '  summarize my workspace  ',
      fetch: request,
    }))).toEqual(events);
    expect(requestCount).toBe(1);
    expect(new Headers(observedInit?.headers).get('authorization'))
      .toBe('Bearer participant-token-value');
    expect(observedInit?.body).toBe(JSON.stringify({
      prompt: 'summarize my workspace',
    }));
  });

  it('rejects a stream that ends without a terminal', async () => {
    const request = async () => sseResponse([
      event(0, { kind: 'accepted' }),
    ]);
    await expect(collect(streamHostedConversation({
      accessToken: 'participant-token-value',
      prompt: 'summarize',
      fetch: request as typeof fetch,
    }))).rejects.toThrow('stopped before returning a final answer');
  });

  it('rejects non-contiguous events', async () => {
    const request = async () => sseResponse([
      event(0, { kind: 'accepted' }),
      event(2, {
        kind: 'result',
        result: { outcome: 'done', summary: 'Invalid sequence.' },
      }),
    ]);
    await expect(collect(streamHostedConversation({
      accessToken: 'participant-token-value',
      prompt: 'summarize',
      fetch: request as typeof fetch,
    }))).rejects.toBeInstanceOf(HostedConversationClientError);
  });

  it('projects the server public rejection without exposing raw transport data', async () => {
    const request = async () => new Response(JSON.stringify({
      error: { message: 'Hosted execution is currently unavailable.' },
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(collect(streamHostedConversation({
      accessToken: 'participant-token-value',
      prompt: 'summarize',
      fetch: request as typeof fetch,
    }))).rejects.toThrow('Hosted execution is currently unavailable.');
  });

  it('surfaces cancellation as an AbortError even without a custom reason', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(collect(streamHostedConversation({
      accessToken: 'participant-token-value',
      prompt: 'summarize',
      signal: controller.signal,
    }))).rejects.toMatchObject({ name: 'AbortError' });
  });
});

type EventBody =
  | { kind: 'accepted' }
  | { kind: 'activity'; activity: unknown }
  | { kind: 'result'; result: { outcome: 'done'; summary: string } };

function event(sequence: number, body: EventBody): ExecutionHostStreamEvent {
  return {
    schemaVersion: 1,
    invocationId: 'invocation-1',
    runId: 'run-1',
    sequence,
    timestamp: NOW,
    ...body,
  } as ExecutionHostStreamEvent;
}

function sseResponse(events: ExecutionHostStreamEvent[]): Response {
  return new Response(events.map((item) => [
    `event: ${item.kind}`,
    `id: ${item.sequence}`,
    `data: ${JSON.stringify(item)}`,
    '',
    '',
  ].join('\n')).join(''), {
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

async function collect(
  stream: AsyncIterable<ExecutionHostStreamEvent>,
): Promise<ExecutionHostStreamEvent[]> {
  const events: ExecutionHostStreamEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

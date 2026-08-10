import { describe, expect, it } from 'vitest';
import { DirectHttpExecutionHost } from './direct-http-execution-host.js';
import {
  ExecutionHostInvocationCancelledError,
  ExecutionHostProtocolError,
  ExecutionHostRejectedError,
  ExecutionHostStreamInterruptedError,
} from './errors.js';
import type {
  ExecutionHostConversationTurn,
  ExecutionHostStreamEvent,
} from './types.js';

const INVOCATION_ID = 'invocation-001';
const RUN_ID = 'run-001';
const TIMESTAMP = '2026-08-10T05:00:00.000Z';

describe('direct HTTP Execution Host adapter', () => {
  it('sends sensitive authority only in headers and validates a complete stream', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const host = createHost(
      sseResponse([
        accepted(),
        activity(1),
        result(2),
      ]),
      requests,
    );

    const events = await collect(host.streamConversationTurn(input()));

    expect(events).toEqual([accepted(), activity(1), result(2)]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('http://127.0.0.1:8080/invocations');
    const requestInit = requests[0]!.init!;
    const headers = new Headers(requestInit.headers);
    expect(headers.get('x-amzn-bedrock-agentcore-runtime-session-id'))
      .toBe(runtimeSessionId());
    expect(headers.get('x-heddle-execution-host-local-token'))
      .toBe('local-runtime-token');
    expect(headers.get('x-heddle-execution-host-model-api-key'))
      .toBe('model-api-key');
    expect(headers.get('x-heddle-execution-host-assertion'))
      .toBe('execution-assertion'.padEnd(32, 'x'));
    expect(headers.get('x-heddle-execution-host-mcp-capability'))
      .toBe('mcp-capability'.padEnd(32, 'x'));
    expect(JSON.parse(String(requestInit.body))).toEqual({
      schemaVersion: 1,
      kind: 'conversation-turn',
      invocationId: INVOCATION_ID,
      prompt: 'Summarize the current Lucid workspace.',
    });
    expect(String(requestInit.body)).not.toContain('assertion');
    expect(String(requestInit.body)).not.toContain('model-api-key');
  });

  it('withholds a terminal result when a later frame violates the protocol', async () => {
    const host = createHost(sseResponse([
      accepted(),
      result(1),
      activity(2),
    ]));
    const observed: ExecutionHostStreamEvent[] = [];

    await expect(async () => {
      for await (const event of host.streamConversationTurn(input())) {
        observed.push(event);
      }
    }).rejects.toBeInstanceOf(ExecutionHostProtocolError);
    expect(observed).toEqual([accepted()]);
  });

  it('treats clean EOF without a terminal as interrupted and never success', async () => {
    const host = createHost(sseResponse([accepted(), activity(1)]));

    await expect(collect(host.streamConversationTurn(input())))
      .rejects.toBeInstanceOf(ExecutionHostStreamInterruptedError);
  });

  it('rejects mismatched stream identity', async () => {
    const host = createHost(sseResponse([
      accepted(),
      { ...result(1), invocationId: 'another-invocation' },
    ]));

    await expect(collect(host.streamConversationTurn(input())))
      .rejects.toBeInstanceOf(ExecutionHostProtocolError);
  });

  it('projects only a bounded remote rejection code', async () => {
    const host = createHost(new Response(JSON.stringify({
      error: {
        code: 'invalid_execution_identity',
        message: 'sensitive upstream detail',
      },
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }));

    await expect(collect(host.streamConversationTurn(input())))
      .rejects.toEqual(new ExecutionHostRejectedError(
        401,
        'invalid_execution_identity',
      ));
  });

  it('does not project oversized or control-text rejection details', async () => {
    const oversized = createHost(new Response('x'.repeat(16_385), {
      status: 502,
      headers: { 'content-length': '16385' },
    }));
    await expect(collect(oversized.streamConversationTurn(input())))
      .rejects.toEqual(new ExecutionHostRejectedError(502, 'unknown'));

    const unsafeCode = createHost(new Response(JSON.stringify({
      error: { code: 'unsafe\ncode', message: 'detail' },
    }), { status: 401 }));
    await expect(collect(unsafeCode.streamConversationTurn(input())))
      .rejects.toEqual(new ExecutionHostRejectedError(401, 'unknown'));
  });

  it('normalizes an already-cancelled request without calling the host', async () => {
    let called = false;
    const host = new DirectHttpExecutionHost({
      baseUrl: new URL('http://127.0.0.1:8080'),
      localToken: 'local-runtime-token',
      fetch: (async () => {
        called = true;
        return sseResponse([accepted(), result(1)]);
      }) as typeof fetch,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(collect(host.streamConversationTurn(input({
      signal: controller.signal,
    }))))
      .rejects.toBeInstanceOf(ExecutionHostInvocationCancelledError);
    expect(called).toBe(false);
  });

  it('rejects credential-bearing or non-loopback plaintext base URLs', () => {
    expect(() => new DirectHttpExecutionHost({
      baseUrl: new URL('https://user:secret@example.test'),
      localToken: 'local-runtime-token',
    })).toThrow(/contain no credentials/);
    expect(() => new DirectHttpExecutionHost({
      baseUrl: new URL('http://example.test'),
      localToken: 'local-runtime-token',
    })).toThrow(/HTTPS or loopback HTTP/);
    expect(() => new DirectHttpExecutionHost({
      baseUrl: new URL('http://[::1]:8080'),
      localToken: 'local-runtime-token',
    })).not.toThrow();
  });

  it('keeps the copied local credential out of serialization and caller mutation', async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const config = {
      baseUrl: new URL('http://127.0.0.1:8080'),
      localToken: 'original-local-runtime-token',
      fetch: (async (url: URL | RequestInfo, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return sseResponse([accepted(), result(1)]);
      }) as typeof fetch,
    };
    const host = new DirectHttpExecutionHost(config);
    config.localToken = 'caller-mutated-token';

    await collect(host.streamConversationTurn(input()));

    const headers = new Headers(requests[0]!.init!.headers);
    expect(headers.get('x-heddle-execution-host-local-token'))
      .toBe('original-local-runtime-token');
    expect(JSON.stringify(host)).toBe('{}');
    expect(JSON.stringify(host)).not.toContain('original-local-runtime-token');
  });
});

function createHost(
  response: Response,
  requests: Array<{ url: string; init?: RequestInit }> = [],
): DirectHttpExecutionHost {
  return new DirectHttpExecutionHost({
    baseUrl: new URL('http://127.0.0.1:8080'),
    localToken: 'local-runtime-token',
    fetch: (async (url, init) => {
      requests.push({ url: String(url), init });
      return response;
    }) as typeof fetch,
  });
}

function input(
  overrides: Partial<ExecutionHostConversationTurn> = {},
): ExecutionHostConversationTurn {
  return {
    invocationId: INVOCATION_ID,
    runtimeSessionId: runtimeSessionId(),
    prompt: 'Summarize the current Lucid workspace.',
    executionAssertion: 'execution-assertion'.padEnd(32, 'x'),
    mcpCapability: 'mcp-capability'.padEnd(32, 'x'),
    modelApiKey: 'model-api-key',
    ...overrides,
  };
}

function runtimeSessionId(): string {
  return 'runtime-session-'.padEnd(33, 's');
}

function accepted(): ExecutionHostStreamEvent {
  return envelope({ sequence: 0, kind: 'accepted' });
}

function activity(sequence: number): ExecutionHostStreamEvent {
  return envelope({
    sequence,
    kind: 'activity',
    activity: { type: 'assistant_text_delta', text: 'working' },
  });
}

function result(sequence: number): ExecutionHostStreamEvent {
  return envelope({
    sequence,
    kind: 'result',
    result: { outcome: 'done', summary: 'complete' },
  });
}

function envelope<T extends object>(event: T): T & {
  schemaVersion: 1;
  invocationId: string;
  runId: string;
  timestamp: string;
} {
  return {
    schemaVersion: 1,
    invocationId: INVOCATION_ID,
    runId: RUN_ID,
    timestamp: TIMESTAMP,
    ...event,
  };
}

function sseResponse(events: ExecutionHostStreamEvent[]): Response {
  return new Response(events.map((event) => [
    `id: ${event.sequence}`,
    `event: ${event.kind}`,
    `data: ${JSON.stringify(event)}`,
    '',
    '',
  ].join('\n')).join(''), {
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
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

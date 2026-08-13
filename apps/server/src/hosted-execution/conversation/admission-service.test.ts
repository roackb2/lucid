import type { ExecutionHostStreamEvent } from '@roackb2/heddle-adopter/contracts';
import type {
  HostedConversationTurnInput,
  HostedConversationTurnRunner,
} from '@roackb2/heddle-adopter/conversation';
import { describe, expect, it, vi } from 'vitest';
import { LOCAL_USER_ID } from '../../lucid/local-user.js';
import {
  HostedConversationAdmissionService,
  HostedConversationAuthorizationError,
} from './admission-service.js';
import {
  createTestConversationHistory,
} from './history.test-support.js';
import type {
  HostedConversationHistoryService,
} from './history-service.js';

const NOW = new Date('2026-08-10T12:00:00.000Z');

describe('HostedConversationAdmissionService', () => {
  it('derives immutable turn authority from the admitted Lucid user', async () => {
    const observed: HostedConversationTurnInput[] = [];
    const service = createService(observed);

    const events = await collect(service.streamTurn({
      principal: {
        subject: 'replaceable-auth-provider-label',
        userId: LOCAL_USER_ID,
        roles: ['user'],
      },
      prompt: 'Summarize my workspace.',
      signal: new AbortController().signal,
    }));

    expect(events.map(({ kind }) => kind)).toEqual(['accepted']);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({
      scope: {
        tenantId: 'tenant-a',
        subjectId: LOCAL_USER_ID,
        productSessionId: 'workspace-a',
      },
      invocationId: 'invocation-001',
      prompt: 'Summarize my workspace.',
      deadlineAt: '2026-08-10T12:01:00.000Z',
    });
    expect(observed[0]?.runtimeSessionId).toMatch(
      /^lucid-runtime-session-[a-f0-9]{64}$/,
    );
  });

  it('rejects a principal outside the local user boundary', async () => {
    const observed: HostedConversationTurnInput[] = [];
    const service = createService(observed);

    await expect(collect(service.streamTurn({
      principal: {
        subject: 'operator-only',
        userId: LOCAL_USER_ID,
        roles: ['operator'],
      },
      prompt: 'Do not run.',
      signal: new AbortController().signal,
    }))).rejects.toBeInstanceOf(HostedConversationAuthorizationError);
    expect(observed).toEqual([]);
  });

  it('fails before allocating an invocation after caller cancellation', async () => {
    const observed: HostedConversationTurnInput[] = [];
    const createInvocationId = vi.fn(() => 'invocation-001');
    const service = createService(observed, createInvocationId);
    const abortController = new AbortController();
    abortController.abort(new Error('request closed'));

    await expect(collect(service.streamTurn({
      principal: {
        subject: 'user',
        userId: LOCAL_USER_ID,
        roles: ['user'],
      },
      prompt: 'Do not run.',
      signal: abortController.signal,
    }))).rejects.toThrow('request closed');
    expect(createInvocationId).not.toHaveBeenCalled();
    expect(observed).toEqual([]);
  });

  it('persists each lifecycle transition before yielding it to the browser', async () => {
    const { history, store } = createTestConversationHistory({ now: () => NOW });
    const turns: HostedConversationTurnRunner = {
      async *streamTurn(input) {
        yield acceptedEvent(input.invocationId);
        yield {
          schemaVersion: 1,
          invocationId: input.invocationId,
          runId: 'run-001',
          sequence: 1,
          timestamp: NOW.toISOString(),
          kind: 'result',
          result: {
            outcome: 'done',
            summary: '## Durable answer',
          },
        };
      },
    };
    const iterator = createAdmissionService(turns, history)
      .streamTurn(userRequest())[Symbol.asyncIterator]();

    const accepted = await iterator.next();
    expect(accepted.value?.kind).toBe('accepted');
    expect(store.operations).toEqual([
      'create:invocation-001',
      'accepted:invocation-001',
    ]);

    const result = await iterator.next();
    expect(result.value?.kind).toBe('result');
    expect(store.operations.at(-1)).toBe(
      'settled:invocation-001:completed',
    );
    expect(store.turns.get('invocation-001')).toMatchObject({
      userId: LOCAL_USER_ID,
      status: 'completed',
      answerMarkdown: '## Durable answer',
    });
  });

  it('does not emit a terminal event when its durable settlement fails', async () => {
    const { history } = createTestConversationHistory({ now: () => NOW });
    vi.spyOn(history, 'recordTerminal').mockRejectedValueOnce(
      new Error('durable settlement unavailable'),
    );
    const turns: HostedConversationTurnRunner = {
      async *streamTurn(input) {
        yield acceptedEvent(input.invocationId);
        yield resultEvent(input.invocationId, 'Durable answer');
      },
    };
    const iterator = createAdmissionService(turns, history)
      .streamTurn(userRequest())[Symbol.asyncIterator]();

    expect((await iterator.next()).value?.kind).toBe('accepted');
    await expect(iterator.next()).rejects.toThrow(
      'durable settlement unavailable',
    );
  });

  it('emits the same bounded summary that it persists', async () => {
    const { history, store } = createTestConversationHistory({ now: () => NOW });
    const turns: HostedConversationTurnRunner = {
      async *streamTurn(input) {
        yield acceptedEvent(input.invocationId);
        yield resultEvent(input.invocationId, 'a'.repeat(100_001));
      },
    };

    const events = await collect(
      createAdmissionService(turns, history).streamTurn(userRequest()),
    );
    const result = events.find((event) => event.kind === 'result');
    const durableAnswer = store.turns.get('invocation-001')?.answerMarkdown;

    expect(durableAnswer).toHaveLength(100_000);
    expect(result?.kind === 'result' ? result.result.summary : undefined)
      .toBe(durableAnswer);
  });

  it('marks a clean stream without terminal output as interrupted', async () => {
    const { history, store } = createTestConversationHistory({ now: () => NOW });
    const turns: HostedConversationTurnRunner = {
      async *streamTurn(input) {
        yield acceptedEvent(input.invocationId);
      },
    };

    await collect(createAdmissionService(turns, history).streamTurn(userRequest()));

    expect(store.turns.get('invocation-001')).toMatchObject({
      status: 'interrupted',
      errorCode: 'stream_ended_without_terminal',
    });
  });

  it('records dependency failure without persisting the thrown message', async () => {
    const { history, store } = createTestConversationHistory({ now: () => NOW });
    const turns: HostedConversationTurnRunner = {
      async *streamTurn() {
        throw new Error('secret-shaped upstream failure detail');
      },
    };

    await expect(collect(
      createAdmissionService(turns, history).streamTurn(userRequest()),
    )).rejects.toThrow('secret-shaped upstream failure detail');

    expect(store.turns.get('invocation-001')).toMatchObject({
      status: 'failed',
      errorCode: 'execution_failed',
    });
    expect(JSON.stringify(store.turns.get('invocation-001')))
      .not.toContain('secret-shaped');
  });

  it('settles a disconnected caller as interrupted without claiming user cancellation', async () => {
    const { history, store } = createTestConversationHistory({ now: () => NOW });
    const turns: HostedConversationTurnRunner = {
      async *streamTurn(input) {
        yield acceptedEvent(input.invocationId);
        await new Promise(() => undefined);
      },
    };
    const abortController = new AbortController();
    const iterator = createAdmissionService(turns, history)
      .streamTurn(userRequest(abortController.signal))[Symbol.asyncIterator]();

    await iterator.next();
    abortController.abort();
    await iterator.return?.();

    expect(store.turns.get('invocation-001')).toMatchObject({
      status: 'interrupted',
      errorCode: 'stream_ended_without_terminal',
    });
  });
});

function createService(
  observed: HostedConversationTurnInput[],
  createInvocationId = () => 'invocation-001',
): HostedConversationAdmissionService {
  const turns: HostedConversationTurnRunner = {
    async *streamTurn(input) {
      observed.push(input);
      yield {
        schemaVersion: 1,
        invocationId: input.invocationId,
        runId: 'run-001',
        sequence: 0,
        timestamp: NOW.toISOString(),
        kind: 'accepted',
      };
    },
  };
  return new HostedConversationAdmissionService(
    turns,
    createTestConversationHistory({ now: () => NOW }).history,
    {
      tenantId: 'tenant-a',
      productSessionId: 'workspace-a',
      maxTurnMs: 60_000,
    },
    {
      now: () => NOW,
      createInvocationId,
    },
  );
}

function createAdmissionService(
  turns: HostedConversationTurnRunner,
  history: HostedConversationHistoryService,
): HostedConversationAdmissionService {
  return new HostedConversationAdmissionService(
    turns,
    history,
    {
      tenantId: 'tenant-a',
      productSessionId: 'workspace-a',
      maxTurnMs: 60_000,
    },
    {
      now: () => NOW,
      createInvocationId: () => 'invocation-001',
    },
  );
}

function userRequest(
  signal = new AbortController().signal,
) {
  return {
    principal: {
      subject: 'provider-subject',
      userId: LOCAL_USER_ID,
      roles: ['user'] as const,
    },
    prompt: 'Summarize my workspace.',
    signal,
  };
}

function acceptedEvent(
  invocationId: string,
): ExecutionHostStreamEvent {
  return {
    schemaVersion: 1,
    invocationId,
    runId: 'run-001',
    sequence: 0,
    timestamp: NOW.toISOString(),
    kind: 'accepted',
  };
}

function resultEvent(
  invocationId: string,
  summary: string,
): Extract<ExecutionHostStreamEvent, { kind: 'result' }> {
  return {
    schemaVersion: 1,
    invocationId,
    runId: 'run-001',
    sequence: 1,
    timestamp: NOW.toISOString(),
    kind: 'result',
    result: {
      outcome: 'done',
      summary,
    },
  };
}

async function collect(
  events: AsyncIterable<ExecutionHostStreamEvent>,
): Promise<ExecutionHostStreamEvent[]> {
  const collected: ExecutionHostStreamEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

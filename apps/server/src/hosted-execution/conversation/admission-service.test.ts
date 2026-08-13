import type { ExecutionHostStreamEvent } from '@roackb2/heddle-adopter/contracts';
import { describe, expect, it, vi } from 'vitest';
import { LOCAL_USER_ID } from '../../lucid/local-user.js';
import {
  HostedConversationAdmissionService,
  HostedConversationAuthorizationError,
} from './admission-service.js';
import type {
  HostedConversationTurnInput,
  HostedConversationTurnRunner,
} from './types.js';

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
  return new HostedConversationAdmissionService(turns, {
    tenantId: 'tenant-a',
    productSessionId: 'workspace-a',
    maxTurnMs: 60_000,
  }, {
    now: () => NOW,
    createInvocationId,
  });
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

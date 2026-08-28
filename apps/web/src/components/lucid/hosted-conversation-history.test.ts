import { describe, expect, it } from 'vitest';
import {
  describeHostedConversationStatus,
  orderHostedConversationTurns,
} from './hosted-conversation-history';
import { presentHostedConversationResult } from './hosted-conversation';
import {
  presentHostedConversationAvailability,
  resolveHostedConversationAccessToken,
} from './hosted-conversation-access';
import {
  hasOpenHostedConversationTurns,
} from '@/hooks/use-hosted-conversation-history';

describe('hosted conversation history presentation', () => {
  it.each([
    ['requested', 'Starting'],
    ['running', 'Working'],
    ['completed', 'Complete'],
    ['max_steps', 'Step limit'],
    ['failed', 'Could not complete'],
    ['cancelled', 'Cancelled'],
    ['interrupted', 'Interrupted'],
  ] as const)('presents %s truthfully', (status, label) => {
    expect(describeHostedConversationStatus(status)).toBe(label);
  });

  it.each([
    ['done', 'completed', 'The agent completed without a written summary.'],
    ['max_steps', 'max_steps', 'The agent stopped at the step limit without a written summary.'],
    ['error', 'failed', 'The agent could not complete this question.'],
    ['interrupted', 'interrupted', 'This conversation ended before Lucid received a terminal answer.'],
  ] as const)(
    'does not present empty %s output as successful',
    (outcome, status, answerMarkdown) => {
      expect(presentHostedConversationResult({ outcome })).toEqual({
        status,
        answerMarkdown,
      });
    },
  );

  it('polls only while durable history contains an open turn', () => {
    expect(hasOpenHostedConversationTurns([{ status: 'requested' }])).toBe(true);
    expect(hasOpenHostedConversationTurns([{ status: 'running' }])).toBe(true);
    expect(hasOpenHostedConversationTurns([
      { status: 'completed' },
      { status: 'interrupted' },
    ])).toBe(false);
  });

  it('renders server history as one oldest-first conversation', () => {
    const newer = {
      invocationId: 'newer',
      prompt: 'Second turn',
      status: 'completed',
      summary: 'Second answer',
      failureCode: null,
      requestedAt: '2026-08-28T12:02:00.000Z',
      settledAt: '2026-08-28T12:03:00.000Z',
    } as const;
    const older = {
      ...newer,
      invocationId: 'older',
      prompt: 'First turn',
      requestedAt: '2026-08-28T12:00:00.000Z',
      settledAt: '2026-08-28T12:01:00.000Z',
    } as const;

    expect(orderHostedConversationTurns([newer, older])).toEqual([
      older,
      newer,
    ]);
  });

  it('presents disabled hosted execution instead of a false sign-in error', () => {
    expect(presentHostedConversationAvailability({
      hasBearerAccessToken: false,
      isPending: false,
      status: {
        enabled: false,
        transport: null,
        authorization: 'development-loopback',
      },
    })).toMatchObject({
      canStartTurn: false,
      runtimeLabel: 'Not connected',
      state: 'unavailable',
    });
  });

  it('requires bearer identity only for bearer-authorized Chat', () => {
    const status = {
      enabled: true,
      transport: 'agentcore',
      authorization: 'bearer',
    } as const;

    expect(presentHostedConversationAvailability({
      hasBearerAccessToken: false,
      isPending: false,
      status,
    })).toMatchObject({
      canStartTurn: false,
      state: 'sign-in-required',
    });
    expect(presentHostedConversationAvailability({
      hasBearerAccessToken: true,
      isPending: false,
      status,
    })).toEqual({
      canStartTurn: true,
      runtimeLabel: 'AgentCore',
      state: 'ready',
    });
  });

  it('adapts verified loopback development identity without a browser secret', () => {
    const status = {
      enabled: true,
      transport: 'direct',
      authorization: 'development-loopback',
    } as const;

    expect(presentHostedConversationAvailability({
      hasBearerAccessToken: false,
      isPending: false,
      status,
    })).toEqual({
      canStartTurn: true,
      runtimeLabel: 'Execution Host',
      state: 'ready',
    });
    expect(resolveHostedConversationAccessToken(status, undefined))
      .toBeTruthy();
  });
});

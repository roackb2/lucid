import { describe, expect, it } from 'vitest';
import {
  describeHostedConversationStatus,
  orderHostedConversationTurns,
} from './hosted-conversation-history';
import { presentHostedConversationResult } from './hosted-conversation';
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
});

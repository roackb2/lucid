import { describe, expect, it } from 'vitest';
import {
  describeHostedConversationStatus,
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
});

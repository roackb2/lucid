import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { HostedConversationAnswer } from './hosted-conversation-answer';
import { HostedConversationHistory } from './hosted-conversation-history';
import type { HostedConversationTurn } from '@/lib/trpc';

const TURN: HostedConversationTurn = {
  invocationId: 'invocation-001',
  prompt: 'Summarize my workspace.',
  status: 'completed',
  runId: 'run-001',
  answerMarkdown: '## Durable answer',
  errorCode: null,
  deadlineAt: '2026-08-13T12:01:00.000Z',
  createdAt: '2026-08-13T12:00:00.000Z',
  acceptedAt: '2026-08-13T12:00:01.000Z',
  settledAt: '2026-08-13T12:00:02.000Z',
  updatedAt: '2026-08-13T12:00:02.000Z',
};

describe('hosted conversation durable rendering', () => {
  it('keeps cached turns visible after a background refresh error', () => {
    const markup = renderHistory({
      error: new Error('refresh failed'),
      turns: [TURN],
    });

    expect(markup).toContain('Summarize my workspace.');
    expect(markup).toContain('Durable answer');
    expect(markup).toContain('could not refresh');
    expect(markup).not.toContain('could not load');
  });

  it('renders distinct loading, blocking-error, and empty states', () => {
    expect(renderHistory({ isPending: true })).toContain(
      'Loading recent conversations',
    );
    expect(renderHistory({ error: new Error('load failed') })).toContain(
      'could not load',
    );
    expect(renderHistory()).toContain(
      'Conversation results will remain available',
    );
  });

  it('blocks raw HTML and images and hardens external links', () => {
    const markup = renderToStaticMarkup(
      <HostedConversationAnswer
        markdown={'<script>unsafe()</script>\n![private](https://example.com/private.png)\n[Source](https://example.com)'}
        status="completed"
      />,
    );

    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('<img');
    expect(markup).toContain('rel="noreferrer noopener"');
    expect(markup).toContain('target="_blank"');
  });
});

function renderHistory(input: {
  error?: Error;
  isPending?: boolean;
  turns?: HostedConversationTurn[];
} = {}): string {
  return renderToStaticMarkup(
    <HostedConversationHistory
      error={input.error}
      isPending={input.isPending ?? false}
      onRetry={vi.fn()}
      turns={input.turns ?? []}
    />,
  );
}

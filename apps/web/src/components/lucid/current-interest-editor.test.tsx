import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DiscoverySnapshot } from '@/lib/trpc';
import { CurrentInterestEditor } from './current-interest-editor';

const CURRENT_INTEREST = {
  sequence: 9,
  id: 'event-9',
  workspaceId: 'workspace-001',
  wakeNumber: 2,
  kind: 'interest_saved',
  targetAgentId: 'agent-001',
  targetUserId: 'user-001',
  title: 'You update what Lucid should look for',
  content: 'Find practical examples of useful collaboration between agents.',
  metadata: {},
  createdAt: '2026-08-28T09:30:00.000Z',
} satisfies NonNullable<DiscoverySnapshot['interest']>;

describe('current Interest editor', () => {
  it('offers one clear action when no Interest exists', () => {
    const markup = renderEditor(
      <CurrentInterestEditor
        isSaving={false}
        onSave={vi.fn()}
      />,
    );

    expect(markup).toContain('Set what Lucid should look for');
    expect(markup).toContain('Set current interest');
    expect(markup).toContain('does not create a second');
    expect(markup).toContain('<textarea');
  });

  it('renders the saved Interest before editing', () => {
    const markup = renderEditor(
      <CurrentInterestEditor
        interest={CURRENT_INTEREST}
        isSaving={false}
        onSave={vi.fn()}
      />,
    );

    expect(markup).toContain('What Lucid is looking for');
    expect(markup).toContain(CURRENT_INTEREST.content);
    expect(markup).toContain('Edit current interest');
    expect(markup).toContain('One current Interest');
    expect(markup).toContain('Continue to Agent');
    expect(markup).toContain('href="/agent"');
    expect(markup).not.toContain('<textarea');
  });
});

function renderEditor(editor: ReactNode): string {
  return renderToStaticMarkup(
    <MemoryRouter>{editor}</MemoryRouter>,
  );
}

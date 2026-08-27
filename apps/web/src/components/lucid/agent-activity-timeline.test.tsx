import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import type { DiscoverySnapshot } from '@/lib/trpc';
import { AgentActivityTimeline } from './agent-activity-timeline';

type AgentActivity = DiscoverySnapshot['agentActivity'];

const ACTIVITY: AgentActivity = [
  {
    id: 'activity-quiet',
    kind: 'no-new-finding',
    title: 'No new Finding',
    summary: 'Reviewed 2 new items, but nothing added a concrete result.',
    createdAt: '2026-08-28T09:06:00.000Z',
    startedAt: '2026-08-28T09:05:00.000Z',
    completedAt: '2026-08-28T09:06:00.000Z',
    inputCount: 2,
    findingCount: 0,
  },
  {
    id: 'activity-finding',
    kind: 'finding-returned',
    title: 'Returned 1 new Finding',
    summary: 'Saved a concrete result with its evidence.',
    createdAt: '2026-08-28T08:42:00.000Z',
    completedAt: '2026-08-28T08:42:00.000Z',
    inputCount: 1,
    findingCount: 1,
  },
];

describe('Agent Activity timeline', () => {
  it('renders product outcomes and useful counts without execution vocabulary', () => {
    const markup = renderTimeline(ACTIVITY);

    expect(markup).toContain('Recent background outcomes');
    expect(markup).toContain('No new Finding');
    expect(markup).toContain('Returned 1 new Finding');
    expect(markup).toContain('2 new items');
    expect(markup).toContain('1 Finding');
    expect(markup).not.toMatch(/wake|trace|taskId|event-/i);
  });

  it('offers one honest next action when no activity exists', () => {
    const markup = renderTimeline([], false);

    expect(markup).toContain('No Agent activity yet');
    expect(markup).toContain('does not invent sample runs');
    expect(markup).toContain('Set the current Interest');
    expect(markup.match(/href=/g)).toHaveLength(1);
  });
});

function renderTimeline(activity: AgentActivity, hasInterest = true): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AgentActivityTimeline activity={activity} hasInterest={hasInterest} />
    </MemoryRouter>,
  );
}

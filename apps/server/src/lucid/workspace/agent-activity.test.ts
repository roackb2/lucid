import { describe, expect, it } from 'vitest';
import type {
  AgentView,
  BackgroundChecksView,
  DiscoveryEvent,
  DiscoveryEventKind,
} from '../discovery-types.js';
import {
  includeCurrentAgentTaskActivity,
  projectPersistedAgentActivity,
} from './agent-activity.js';

describe('Agent Activity projection', () => {
  it('collapses each wake into one recent product-readable outcome', () => {
    const activity = projectPersistedAgentActivity([
      event(1, 1, 'agent_wake_started', {
        visibleEventSequences: [10],
      }),
      event(2, 1, 'finding_reported'),
      event(3, 1, 'agent_wake_completed'),
      event(4, 2, 'agent_wake_started', {
        visibleEventSequences: [20, 21],
      }),
      event(5, 2, 'agent_wake_no_action'),
      event(6, 2, 'agent_wake_completed'),
    ]);

    expect(activity).toMatchObject([
      {
        kind: 'no-new-finding',
        title: 'No new Finding',
        inputCount: 2,
        findingCount: 0,
      },
      {
        kind: 'finding-returned',
        title: 'Returned 1 new Finding',
        inputCount: 1,
        findingCount: 1,
      },
    ]);
    expect(JSON.stringify(activity)).not.toContain('Internal event');
  });

  it('shows a current task failure instead of a stale working item', () => {
    const [working] = projectPersistedAgentActivity([
      event(1, 1, 'agent_wake_started', {
        visibleEventSequences: [10],
      }),
    ]);
    if (!working) {
      throw new Error('Expected a working Activity item.');
    }

    const activity = includeCurrentAgentTaskActivity(
      [working],
      backgroundChecks('failed'),
      { ...AGENT, status: 'error' },
    );

    expect(activity[0]).toMatchObject({
      kind: 'needs-attention',
      title: 'Background work needs attention',
    });
    expect(activity).toHaveLength(1);
  });

  it('marks an interrupted wake as recovered after durable completion', () => {
    const activity = projectPersistedAgentActivity([
      event(1, 1, 'agent_wake_started'),
      event(2, 1, 'error'),
      event(3, 1, 'agent_wake_completed'),
    ]);

    expect(activity[0]).toMatchObject({
      kind: 'recovered',
      title: 'Recovered and finished a check',
      completedAt: '2026-08-28T09:03:00.000Z',
    });
  });
});

const AGENT: AgentView = {
  id: 'user-agent',
  workspaceId: 'workspace-001',
  userId: 'local-user',
  sortOrder: 0,
  name: 'Lucid',
  role: 'representative',
  color: '#176b5b',
  purpose: 'Find concrete additions for the current Interest.',
  status: 'idle',
  runCount: 3,
  lastRunAt: '2026-08-28T09:01:00.000Z',
  createdAt: '2026-08-28T08:00:00.000Z',
  updatedAt: '2026-08-28T09:01:00.000Z',
  user: {
    id: 'local-user',
    workspaceId: 'workspace-001',
    kind: 'human',
    status: 'active',
    displayName: 'You',
    contextConsentAt: '2026-08-28T08:00:00.000Z',
    createdAt: '2026-08-28T08:00:00.000Z',
    updatedAt: '2026-08-28T08:00:00.000Z',
  },
  unreadCount: 1,
  isCurrentUserAgent: true,
};

function backgroundChecks(
  status: BackgroundChecksView['tasks'][number]['status'],
): BackgroundChecksView {
  return {
    enabled: true,
    dispatchEnabled: true,
    running: status === 'running',
    intervalMs: 60_000,
    lastRunAt: '2026-08-28T09:01:00.000Z',
    tasks: [{
      taskId: 'lucid-agent-user-agent',
      agentId: AGENT.id,
      enabled: true,
      status,
      progress: 'Internal task progress.',
      intervalMs: 60_000,
      lastRunAt: '2026-08-28T09:01:00.000Z',
    }],
  };
}

function event(
  sequence: number,
  wakeNumber: number,
  kind: DiscoveryEventKind,
  metadata: Record<string, unknown> = {},
): DiscoveryEvent {
  return {
    sequence,
    id: `event-${sequence}`,
    workspaceId: 'workspace-001',
    wakeNumber,
    kind,
    actorAgentId: AGENT.id,
    title: 'Internal event title',
    content: 'Internal event content with #123.',
    metadata,
    createdAt: `2026-08-28T09:0${sequence}:00.000Z`,
  };
}

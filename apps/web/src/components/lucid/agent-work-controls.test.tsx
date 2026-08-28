import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { DiscoverySnapshot } from '@/lib/trpc';
import { AgentWorkControls } from './agent-work-controls';

const CREATED_AT = '2026-08-28T08:00:00.000Z';
const USER = {
  id: 'user-001',
  workspaceId: 'workspace-001',
  kind: 'human',
  status: 'active',
  displayName: 'Fienna',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
} satisfies DiscoverySnapshot['user'];

const INTEREST = {
  sequence: 9,
  id: 'event-9',
  workspaceId: 'workspace-001',
  wakeNumber: 2,
  kind: 'interest_saved',
  targetAgentId: 'agent-001',
  targetUserId: USER.id,
  title: 'You update what Lucid should look for',
  content: 'Find practical examples of useful collaboration between agents.',
  metadata: {},
  createdAt: CREATED_AT,
} satisfies NonNullable<DiscoverySnapshot['interest']>;

const BASE_TASK = {
  taskId: 'task-001',
  agentId: 'agent-001',
  enabled: true,
  status: 'waiting',
  progress: 'Waiting for the next scheduled run.',
  intervalMs: 300_000,
  nextRunAt: '2026-08-28T10:00:00.000Z',
  lastRunAt: '2026-08-28T09:00:00.000Z',
} satisfies DiscoverySnapshot['backgroundChecks']['tasks'][number];

const BASE_SNAPSHOT = {
  workspace: {
    id: 'workspace-001',
    versionId: 'version-001',
    currentWake: 2,
    backgroundChecksEnabled: true,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  user: USER,
  agent: {
    id: 'agent-001',
    workspaceId: 'workspace-001',
    userId: USER.id,
    sortOrder: 0,
    name: 'Lucid',
    role: 'discovery agent',
    color: '#176b5b',
    purpose: 'Find useful knowledge in the background.',
    status: 'idle',
    runCount: 3,
    lastRunAt: '2026-08-28T09:00:00.000Z',
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    user: USER,
    unreadCount: 0,
    isCurrentUserAgent: true,
  },
  interest: INTEREST,
  findings: [],
  agentActivity: [],
  backgroundChecks: {
    enabled: true,
    dispatchEnabled: true,
    running: false,
    intervalMs: 300_000,
    nextRunAt: '2026-08-28T10:00:00.000Z',
    lastRunAt: '2026-08-28T09:00:00.000Z',
    tasks: [BASE_TASK],
  },
  runtime: {
    model: 'codex',
    heddleVersion: '6.6.1',
  },
} satisfies DiscoverySnapshot;

describe('Agent work controls', () => {
  it('offers Check now on the same scheduled Agent task', () => {
    const markup = renderControls(BASE_SNAPSHOT);

    expect(markup).toContain('Listening in the background');
    expect(markup).toContain('Check now');
    expect(markup).toContain('Pause background work');
    expect(markup).toContain('same Agent task used by the schedule');
    expect(markup).toContain('Background cadence');
    expect(markup).not.toContain('fresh request thread');
  });

  it('makes setting an Interest the one clear action when none exists', () => {
    const markup = renderControls({
      ...BASE_SNAPSHOT,
      interest: undefined,
    });

    expect(markup).toContain('Waiting for a current Interest');
    expect(markup).toContain('Set current Interest');
    expect(markup).toContain('href="/interests"');
    expect(markup.match(/href=/g)).toHaveLength(1);
    expect(markup).not.toContain('Pause background work');
  });

  it('asks the user to resume before starting an immediate check', () => {
    const markup = renderControls({
      ...BASE_SNAPSHOT,
      backgroundChecks: {
        ...BASE_SNAPSHOT.backgroundChecks,
        enabled: false,
        nextRunAt: undefined,
      },
    });

    expect(markup).toContain('Background work is paused');
    expect(markup).toContain('Resume background work');
    expect(markup).not.toContain('>Check now<');
  });

  it('retries failed durable work instead of queuing another check', () => {
    const markup = renderControls({
      ...BASE_SNAPSHOT,
      agent: {
        ...BASE_SNAPSHOT.agent,
        status: 'error',
      },
      backgroundChecks: {
        ...BASE_SNAPSHOT.backgroundChecks,
        tasks: [{
          ...BASE_TASK,
          status: 'failed',
          error: 'The Agent did not publish a request.',
        }],
      },
    });

    expect(markup).toContain('Current work needs attention');
    expect(markup).toContain('The Agent did not publish a request.');
    expect(markup).toContain('Retry current work');
    expect(markup).not.toContain('>Check now<');
  });

  it('shows truthful disabled state while the Agent is already working', () => {
    const markup = renderControls({
      ...BASE_SNAPSHOT,
      agent: {
        ...BASE_SNAPSHOT.agent,
        status: 'running',
      },
      backgroundChecks: {
        ...BASE_SNAPSHOT.backgroundChecks,
        running: true,
        tasks: [{
          ...BASE_TASK,
          status: 'running',
        }],
      },
    });

    expect(markup).toContain('Agent is checking now');
    expect(markup).toContain('Checking now…');
    expect(markup).toContain('Pause background work');
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it('keeps Check now discoverable while operator dispatch is paused', () => {
    const markup = renderControls({
      ...BASE_SNAPSHOT,
      workspace: {
        ...BASE_SNAPSHOT.workspace,
        backgroundChecksEnabled: false,
      },
      backgroundChecks: {
        ...BASE_SNAPSHOT.backgroundChecks,
        dispatchEnabled: false,
      },
    });

    expect(markup).toContain('Background dispatch is paused');
    expect(markup).toContain('Only the service operator can resume dispatch');
    expect(markup).toContain('>Check now<');
    expect(markup).toContain('disabled=""');
  });
});

function renderControls(snapshot: DiscoverySnapshot): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <AgentWorkControls
        isRetrying={false}
        isRunningNow={false}
        isUpdatingBackground={false}
        onRetry={vi.fn().mockResolvedValue(undefined)}
        onRunNow={vi.fn().mockResolvedValue(undefined)}
        onSetBackgroundChecksEnabled={vi.fn().mockResolvedValue(undefined)}
        snapshot={snapshot}
      />
    </MemoryRouter>,
  );
}

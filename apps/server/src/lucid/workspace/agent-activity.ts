/** Product projection for one Agent's bounded operational history. */
import type {
  AgentActivityItemView,
  AgentActivityKind,
  AgentView,
  BackgroundChecksView,
  DiscoveryEvent,
  DiscoveryEventKind,
} from '../discovery-types.js';

export const AGENT_ACTIVITY_LIMIT = 8;

export const AGENT_ACTIVITY_EVENT_KINDS: DiscoveryEventKind[] = [
  'agent_wake_started',
  'agent_wake_no_action',
  'agent_wake_completed',
  'agent_note_updated',
  'shared_message',
  'direct_message',
  'finding_reported',
  'error',
];

type WakeEvents = {
  events: DiscoveryEvent[];
};

/**
 * Collapses durable Lucid events into one user-facing item per wake. This is
 * intentionally not an execution log: transport IDs, summaries, and raw trace
 * state never cross the product boundary.
 */
export function projectPersistedAgentActivity(
  events: DiscoveryEvent[],
  limit = AGENT_ACTIVITY_LIMIT,
): AgentActivityItemView[] {
  const wakes = new Map<number, WakeEvents>();
  events.forEach((event) => {
    const wake = wakes.get(event.wakeNumber) ?? { events: [] };
    wake.events.push(event);
    wakes.set(event.wakeNumber, wake);
  });

  return [...wakes.values()]
    .map(({ events: wakeEvents }) => wakeEvents
      .sort((left, right) => left.sequence - right.sequence))
    .sort((left, right) => (
      (right.at(-1)?.sequence ?? 0) - (left.at(-1)?.sequence ?? 0)
    ))
    .flatMap((wakeEvents) => {
      const item = projectWake(wakeEvents);
      return item ? [item] : [];
    })
    .slice(0, limit);
}

/** Adds only a current running or attention state not yet settled as an event. */
export function includeCurrentAgentTaskActivity(
  history: AgentActivityItemView[],
  backgroundChecks: BackgroundChecksView,
  agent: AgentView,
): AgentActivityItemView[] {
  const task = backgroundChecks.tasks.find(({ agentId }) => agentId === agent.id);
  const needsAttention = agent.status === 'error'
    || task?.status === 'failed'
    || task?.status === 'blocked';
  const working = agent.status === 'running'
    || task?.status === 'running'
    || backgroundChecks.running;

  if (!needsAttention && !working) {
    return history;
  }
  if (working && history[0]?.kind === 'working') {
    return history;
  }
  if (needsAttention && history[0]?.kind === 'needs-attention') {
    return history;
  }

  const createdAt = task?.lastRunAt ?? agent.lastRunAt ?? agent.updatedAt;
  const current: AgentActivityItemView = needsAttention
    ? {
        id: `current-attention-${agent.id}-${createdAt}`,
        kind: 'needs-attention',
        title: 'Background work needs attention',
        summary: task?.status === 'blocked'
          ? 'Background work is blocked until the task is resumed.'
          : 'The check stopped before completion. Its unread work is preserved for a retry.',
        createdAt,
        inputCount: 0,
        findingCount: 0,
      }
    : {
        id: `current-working-${agent.id}-${createdAt}`,
        kind: 'working',
        title: 'Checking for something new',
        summary: 'Working through the current Interest in the background.',
        createdAt,
        startedAt: createdAt,
        inputCount: 0,
        findingCount: 0,
      };
  const settledHistory = history[0]?.kind === 'working'
    ? history.slice(1)
    : history;
  return [current, ...settledHistory].slice(0, AGENT_ACTIVITY_LIMIT);
}

function projectWake(
  events: DiscoveryEvent[],
): AgentActivityItemView | undefined {
  const latest = events.at(-1);
  if (!latest) {
    return undefined;
  }
  const newestFirst = [...events].reverse();
  const started = events.find(({ kind }) => kind === 'agent_wake_started');
  const completed = newestFirst.find(({ kind }) => kind === 'agent_wake_completed');
  const error = newestFirst.find(({ kind }) => kind === 'error');
  const noAction = newestFirst.find(({ kind }) => kind === 'agent_wake_no_action');
  const findings = events.filter(({ kind }) => kind === 'finding_reported');
  const messages = events.filter(({ kind }) => (
    kind === 'shared_message' || kind === 'direct_message'
  ));
  const request = messages.find(({ metadata }) => metadata.messageRole === 'request');
  const contribution = messages.find(({ metadata }) => (
    metadata.messageRole === 'response'
    || metadata.messageRole === 'contribution'
  ));
  const workingNote = newestFirst.find(({ kind }) => kind === 'agent_note_updated');
  const inputCount = metadataSequenceCount(
    started?.metadata.visibleEventSequences,
  );
  const presentation = resolvePresentation({
    completed: Boolean(completed),
    contribution: Boolean(contribution),
    error: Boolean(error),
    findingCount: findings.length,
    inputCount,
    noAction: Boolean(noAction),
    request: Boolean(request),
    workingNote: Boolean(workingNote),
  });

  return {
    id: latest.id,
    ...presentation,
    createdAt: completed?.createdAt ?? latest.createdAt,
    startedAt: started?.createdAt,
    completedAt: completed?.createdAt,
    inputCount,
    findingCount: findings.length,
  };
}

function resolvePresentation(input: {
  completed: boolean;
  contribution: boolean;
  error: boolean;
  findingCount: number;
  inputCount: number;
  noAction: boolean;
  request: boolean;
  workingNote: boolean;
}): Pick<AgentActivityItemView, 'kind' | 'title' | 'summary'> {
  if (input.error && !input.completed) {
    return presentation(
      'needs-attention',
      'Background work needs attention',
      'The check stopped before completion. Its unread work is preserved for a retry.',
    );
  }
  if (!input.completed) {
    return presentation(
      'working',
      'Checking for something new',
      input.inputCount
        ? `Reviewing ${counted(input.inputCount, 'new item')}.`
        : 'Working through the current Interest in the background.',
    );
  }
  if (input.error) {
    return presentation(
      'recovered',
      'Recovered and finished a check',
      'A prior interruption was retried without losing the unread work.',
    );
  }
  if (input.findingCount) {
    return presentation(
      'finding-returned',
      `Returned ${counted(input.findingCount, 'new Finding')}`,
      input.inputCount
        ? `Reviewed ${counted(input.inputCount, 'new item')} and saved a concrete result with its evidence.`
        : 'Saved a concrete result with its evidence.',
    );
  }
  if (input.noAction) {
    return presentation(
      'no-new-finding',
      'No new Finding',
      input.inputCount
        ? `Reviewed ${counted(input.inputCount, 'new item')}, but nothing added a concrete result beyond the existing Findings.`
        : 'Completed the check without adding a new Finding.',
    );
  }
  if (input.request) {
    return presentation(
      'network-request',
      'Asked the network',
      'Shared a privacy-minimized request and will review replies in later background work.',
    );
  }
  if (input.contribution) {
    return presentation(
      'network-contribution',
      'Helped another Agent',
      'Shared a privacy-minimized response with the agent network.',
    );
  }
  if (input.workingNote) {
    return presentation(
      'understanding-updated',
      'Updated its working understanding',
      'Refined how it will pursue the current Interest in future background work.',
    );
  }
  return presentation(
    'completed',
    'Background check completed',
    input.inputCount
      ? `Reviewed ${counted(input.inputCount, 'new item')} without a separate user-facing return.`
      : 'Finished the scheduled work without a separate user-facing return.',
  );
}

function presentation(
  kind: AgentActivityKind,
  title: string,
  summary: string,
): Pick<AgentActivityItemView, 'kind' | 'title' | 'summary'> {
  return { kind, title, summary };
}

function metadataSequenceCount(value: unknown): number {
  return Array.isArray(value)
    ? value.filter((item) => Number.isInteger(item) && Number(item) > 0).length
    : 0;
}

function counted(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

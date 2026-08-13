export type HostedConversationProgressItem = {
  id: string;
  text: string;
  kind: 'commentary' | 'reasoning' | 'tool';
  done: boolean;
};

export type HostedConversationActivityPresentation = {
  status: string;
  progress?: HostedConversationProgressItem;
};

type ActivityRecord = Record<string, unknown>;

const MAX_PROGRESS_TEXT_CHARACTERS = 1_200;
const MAX_PROGRESS_ITEMS = 12;

/**
 * Projects Heddle's open activity envelope into bounded, user-facing progress.
 * Raw tool arguments and results never enter the browser's activity trail.
 */
export function presentHostedConversationActivity(
  activity: unknown,
): HostedConversationActivityPresentation {
  if (!isRecord(activity) || typeof activity.type !== 'string') {
    return { status: 'Agent is working' };
  }

  const presenter = ACTIVITY_PRESENTERS[activity.type];
  return presenter?.(activity) ?? { status: 'Agent is working' };
}

export function mergeHostedConversationProgress(
  current: readonly HostedConversationProgressItem[],
  next: HostedConversationProgressItem,
): HostedConversationProgressItem[] {
  const existingIndex = current.findIndex((item) => item.id === next.id);
  if (existingIndex < 0) {
    return [...current, next].slice(-MAX_PROGRESS_ITEMS);
  }
  return current.map((item, index) => index === existingIndex ? next : item);
}

type ActivityPresenter = (
  activity: ActivityRecord,
) => HostedConversationActivityPresentation;

const ACTIVITY_PRESENTERS: Record<string, ActivityPresenter> = {
  'assistant.commentary': (activity) => presentNarration(
    activity,
    'commentary',
    'Agent is sharing progress',
    readString(activity.messageId) ?? `step-${readStep(activity)}`,
  ),
  'reasoning.summary': (activity) => presentNarration(
    activity,
    'reasoning',
    'Agent is evaluating what it found',
    `step-${readStep(activity)}`,
  ),
  'assistant.stream': () => ({ status: 'Composing the answer' }),
  'tool.calling': (activity) => presentToolActivity(activity, false),
  'tool.completed': (activity) => presentToolActivity(activity, true),
  'loop.finished': () => ({ status: 'Finishing the turn' }),
};

function presentNarration(
  activity: ActivityRecord,
  kind: 'commentary' | 'reasoning',
  status: string,
  identity: string,
): HostedConversationActivityPresentation {
  const text = readString(activity.text)?.trim();
  if (!text) {
    return { status };
  }
  return {
    status,
    progress: {
      id: `${kind}:${identity}`,
      text: text.slice(0, MAX_PROGRESS_TEXT_CHARACTERS),
      kind,
      done: activity.done === true,
    },
  };
}

function presentToolActivity(
  activity: ActivityRecord,
  done: boolean,
): HostedConversationActivityPresentation {
  const tool = readString(activity.tool) ?? 'unknown';
  const text = describeToolActivity(tool, done);
  return {
    status: text,
    progress: {
      id: `tool:${readString(activity.toolCallId) ?? `${tool}-${readStep(activity)}`}`,
      text,
      kind: 'tool',
      done,
    },
  };
}

function describeToolActivity(tool: string, done: boolean): string {
  const phase = done ? 'Finished' : 'Working';
  if (tool === 'web_search') {
    return done ? 'Finished searching the web' : 'Searching the web';
  }
  if (tool.endsWith('__read_workspace_snapshot')) {
    return done
      ? 'Finished reading your Lucid workspace'
      : 'Reading your Lucid workspace';
  }
  if (tool.includes('shell')) {
    return done ? 'Finished analyzing the results' : 'Analyzing the results';
  }
  if (
    tool.includes('file')
    || tool.includes('artifact')
    || tool.includes('workspace')
  ) {
    return done ? 'Finished inspecting workspace files' : 'Inspecting workspace files';
  }
  return `${phase} with an agent tool`;
}

function readStep(activity: ActivityRecord): string {
  return typeof activity.step === 'number' && Number.isFinite(activity.step)
    ? String(activity.step)
    : 'unknown';
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function isRecord(value: unknown): value is ActivityRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

import dayjs from 'dayjs';
import {
  AlertTriangle,
  CalendarClock,
  Clock3,
  History,
  Pause,
  Play,
  RefreshCw,
  RadioTower,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { DiscoverySnapshot } from '@/lib/trpc';

type AgentWorkControlsProps = {
  snapshot: DiscoverySnapshot;
  isRetrying: boolean;
  isRunningNow: boolean;
  isUpdatingBackground: boolean;
  onRetry(): Promise<unknown>;
  onRunNow(): Promise<unknown>;
  onSetBackgroundChecksEnabled(enabled: boolean): Promise<unknown>;
};

export function AgentWorkControls({
  snapshot,
  isRetrying,
  isRunningNow,
  isUpdatingBackground,
  onRetry,
  onRunNow,
  onSetBackgroundChecksEnabled,
}: AgentWorkControlsProps) {
  const [actionError, setActionError] = useState<string>();
  const checks = snapshot.backgroundChecks;
  const hasInterest = Boolean(snapshot.interest);
  const failedTask = checks.tasks.find(({ agentId, status }) => (
    agentId === snapshot.agent.id && status === 'failed'
  ));
  const hasFailedWake = snapshot.agent.status === 'error' || Boolean(failedTask);
  const globallyPaused = !checks.dispatchEnabled;
  const isAgentRunning = snapshot.agent.status === 'running' || checks.running;
  const status = resolveWorkStatus({
    checks,
    failedTask,
    globallyPaused,
    hasFailedWake,
    hasInterest,
    isAgentRunning,
  });

  const performAction = async (action: () => Promise<unknown>) => {
    setActionError(undefined);
    try {
      await action();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : 'Lucid did not complete the request.',
      );
    }
  };

  const primaryAction = resolvePrimaryAction({
    globallyPaused,
    hasFailedWake,
    hasInterest,
    isAgentRunning,
    isRetrying,
    isRunningNow,
    isUpdatingBackground,
    checksEnabled: checks.enabled,
    onRetry: () => void performAction(onRetry),
    onRunNow: () => void performAction(onRunNow),
    onResume: () => void performAction(
      () => onSetBackgroundChecksEnabled(true),
    ),
  });

  return (
    <section
      aria-labelledby="agent-work-controls-title"
      className={`agent-work-controls agent-work-controls--${status.tone}`}
    >
      <header className="agent-work-controls__header">
        <span className="agent-work-controls__icon" aria-hidden="true">
          {status.icon}
        </span>
        <div>
          <p className="section-label">Delegated work</p>
          <h2 id="agent-work-controls-title">{status.title}</h2>
          <p aria-live="polite">{status.description}</p>
        </div>
        <span className="foundation-status">{status.badge}</span>
      </header>

      <dl className="agent-work-controls__timing">
        <div>
          <dt><CalendarClock aria-hidden="true" /> Next scheduled</dt>
          <dd className="tabular-nums">
            {formatTimestamp(
              checks.nextRunAt,
              checks.enabled && checks.dispatchEnabled,
            )}
          </dd>
        </div>
        <div>
          <dt><History aria-hidden="true" /> Last Agent wake</dt>
          <dd className="tabular-nums">
            {formatTimestamp(checks.lastRunAt)}
          </dd>
        </div>
        <div>
          <dt><Clock3 aria-hidden="true" /> Background cadence</dt>
          <dd>{formatInterval(checks.intervalMs)}</dd>
        </div>
      </dl>

      <div className="agent-work-controls__command">
        <div>
          <strong>Check the current Interest now</strong>
          <p>
            Adds a durable request and wakes the same Agent task used by the
            schedule. The background cadence does not change.
          </p>
        </div>
        <div className="agent-work-controls__actions">
          {primaryAction}
          {hasInterest && checks.enabled && !globallyPaused ? (
            <Button
              disabled={isUpdatingBackground || isAgentRunning}
              onClick={() => void performAction(
                () => onSetBackgroundChecksEnabled(false),
              )}
              type="button"
              variant="secondary"
            >
              <Pause aria-hidden="true" />
              {isUpdatingBackground ? 'Pausing…' : 'Pause background work'}
            </Button>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <p className="agent-work-controls__error" role="alert">
          <AlertTriangle aria-hidden="true" />
          {actionError}
        </p>
      ) : null}
    </section>
  );
}

type WorkStatus = {
  badge: string;
  description: string;
  icon: ReactNode;
  title: string;
  tone: 'ready' | 'working' | 'attention' | 'paused';
};

function resolveWorkStatus({
  checks,
  failedTask,
  globallyPaused,
  hasFailedWake,
  hasInterest,
  isAgentRunning,
}: {
  checks: DiscoverySnapshot['backgroundChecks'];
  failedTask?: DiscoverySnapshot['backgroundChecks']['tasks'][number];
  globallyPaused: boolean;
  hasFailedWake: boolean;
  hasInterest: boolean;
  isAgentRunning: boolean;
}): WorkStatus {
  if (hasFailedWake) {
    return {
      badge: 'Needs attention',
      description: failedTask?.error
        ?? 'The last Agent wake did not complete. Retry continues the same work.',
      icon: <AlertTriangle />,
      title: 'Current work needs attention',
      tone: 'attention',
    };
  }
  if (isAgentRunning) {
    return {
      badge: 'Working now',
      description:
        'The Agent has claimed durable work. Activity will update as it progresses.',
      icon: <RefreshCw />,
      title: 'Agent is checking now',
      tone: 'working',
    };
  }
  if (!hasInterest) {
    return {
      badge: 'Needs an Interest',
      description:
        'Set one current Interest before asking the Agent to work in the background.',
      icon: <RadioTower />,
      title: 'Waiting for a current Interest',
      tone: 'paused',
    };
  }
  if (globallyPaused) {
    return {
      badge: 'Operator paused',
      description:
        'Your Interest and schedule preference remain saved. Only the service operator can resume dispatch.',
      icon: <Pause />,
      title: 'Background dispatch is paused',
      tone: 'paused',
    };
  }
  if (!checks.enabled) {
    return {
      badge: 'Paused',
      description:
        'Your Interest and prior results remain saved. Resuming starts a check now and restores the schedule.',
      icon: <Pause />,
      title: 'Background work is paused',
      tone: 'paused',
    };
  }
  return {
    badge: 'Ready',
    description:
      'The Agent follows its schedule and can also be asked to check immediately.',
    icon: <RadioTower />,
    title: 'Listening in the background',
    tone: 'ready',
  };
}

function resolvePrimaryAction({
  checksEnabled,
  globallyPaused,
  hasFailedWake,
  hasInterest,
  isAgentRunning,
  isRetrying,
  isRunningNow,
  isUpdatingBackground,
  onRetry,
  onRunNow,
  onResume,
}: {
  checksEnabled: boolean;
  globallyPaused: boolean;
  hasFailedWake: boolean;
  hasInterest: boolean;
  isAgentRunning: boolean;
  isRetrying: boolean;
  isRunningNow: boolean;
  isUpdatingBackground: boolean;
  onRetry(): void;
  onRunNow(): void;
  onResume(): void;
}): ReactNode {
  if (!hasInterest) {
    return (
      <Button asChild>
        <Link to="/interests">Set current Interest</Link>
      </Button>
    );
  }
  if (globallyPaused) {
    return (
      <Button disabled type="button">
        <RefreshCw aria-hidden="true" />
        Check now
      </Button>
    );
  }
  if (!checksEnabled) {
    return (
      <Button
        disabled={isUpdatingBackground}
        onClick={onResume}
        type="button"
      >
        <Play aria-hidden="true" />
        {isUpdatingBackground ? 'Resuming…' : 'Resume and check now'}
      </Button>
    );
  }
  if (hasFailedWake) {
    return (
      <Button disabled={isRetrying} onClick={onRetry} type="button">
        <RefreshCw aria-hidden="true" />
        {isRetrying ? 'Retrying…' : 'Retry current work'}
      </Button>
    );
  }
  return (
    <Button
      disabled={isAgentRunning || isRunningNow}
      onClick={onRunNow}
      type="button"
    >
      <RefreshCw aria-hidden="true" />
      {isRunningNow
        ? 'Queuing check…'
        : isAgentRunning ? 'Checking now…' : 'Check now'}
    </Button>
  );
}

function formatInterval(milliseconds: number): string {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} hr` : `${hours.toFixed(1)} hr`;
}

function formatTimestamp(
  timestamp: string | undefined,
  enabled = true,
): string {
  if (!enabled) {
    return 'Paused';
  }
  return timestamp ? dayjs(timestamp).format('MMM D, HH:mm') : 'Not yet';
}

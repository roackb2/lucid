import dayjs from 'dayjs';
import {
  CalendarClock,
  History,
  LoaderCircle,
  Pause,
  Play,
  RadioTower,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DiscoverySnapshot } from '@/lib/trpc';

type BackgroundChecksProps = {
  checks: DiscoverySnapshot['backgroundChecks'];
  isUpdating: boolean;
  onSetEnabled(enabled: boolean): void;
};

export function BackgroundChecks({
  checks,
  isUpdating,
  onSetEnabled,
}: BackgroundChecksProps) {
  const status = checks.running
    ? 'Processing new messages'
    : checks.enabled
      ? 'Listening in the background'
      : 'Background checks paused';

  return (
    <section
      className={`background-checks ${
        checks.running ? 'background-checks--running' : ''
      }`}
      aria-live="polite"
    >
      <span className="background-checks__icon" aria-hidden="true">
        {checks.running
          ? (
              <span className="background-checks__spinner">
                <LoaderCircle size={18} />
              </span>
            )
          : <RadioTower size={18} />}
      </span>
      <div className="background-checks__summary">
        <div>
          <p className="section-label">Background checks</p>
          <strong>{status}</strong>
        </div>
        <p>
          {checks.enabled
            ? `Each representative wakes every ${formatInterval(checks.intervalMs)}. New mailbox messages can wake the right agent sooner.`
            : 'Your interest and findings stay saved. Resume when you want agents to process new messages.'}
        </p>
      </div>
      <dl className="background-checks__timing">
        <div>
          <dt><CalendarClock size={12} /> Next scheduled</dt>
          <dd>{formatTimestamp(checks.nextRunAt, checks.enabled)}</dd>
        </div>
        <div>
          <dt><History size={12} /> Last agent wake</dt>
          <dd>{formatTimestamp(checks.lastRunAt)}</dd>
        </div>
      </dl>
      <Button
        disabled={isUpdating}
        onClick={() => onSetEnabled(!checks.enabled)}
        size="small"
        variant="secondary"
      >
        {checks.enabled ? <Pause size={13} /> : <Play size={13} />}
        {checks.enabled ? 'Pause' : 'Resume'}
      </Button>
    </section>
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

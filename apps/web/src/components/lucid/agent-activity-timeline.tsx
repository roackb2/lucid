import dayjs from 'dayjs';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Lightbulb,
  Network,
  RefreshCw,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import type { DiscoverySnapshot } from '@/lib/trpc';
import { cn } from '@/lib/utils';

type AgentActivityItem = DiscoverySnapshot['agentActivity'][number];

type AgentActivityTimelineProps = {
  activity: DiscoverySnapshot['agentActivity'];
  hasInterest: boolean;
};

const ACTIVITY_ICONS: Record<AgentActivityItem['kind'], typeof Activity> = {
  working: RefreshCw,
  'needs-attention': AlertTriangle,
  recovered: RefreshCw,
  'finding-returned': CheckCircle2,
  'no-new-finding': Clock3,
  'network-request': Network,
  'network-contribution': Network,
  'understanding-updated': Lightbulb,
  completed: CheckCircle2,
};

/**
 * Shows bounded, server-owned wake outcomes rather than exposing execution logs
 * or transport vocabulary in the product UI.
 */
export function AgentActivityTimeline({
  activity,
  hasInterest,
}: AgentActivityTimelineProps) {
  if (activity.length === 0) {
    return <EmptyActivityState hasInterest={hasInterest} />;
  }

  return (
    <section className="agent-activity" aria-labelledby="agent-activity-title">
      <header className="agent-activity__header">
        <span className="foundation-panel__icon" aria-hidden="true">
          <Activity />
        </span>
        <div>
          <h2 id="agent-activity-title">Activity</h2>
          <p>Recent background outcomes, condensed into one update per check.</p>
        </div>
        <span className="foundation-status">
          {activity.length} recent
        </span>
      </header>

      <ol className="agent-activity__timeline">
        {activity.map((item) => (
          <AgentActivityRow item={item} key={item.id} />
        ))}
      </ol>
    </section>
  );
}

function AgentActivityRow({ item }: { item: AgentActivityItem }) {
  const Icon = ACTIVITY_ICONS[item.kind];
  const hasCounts = item.inputCount > 0 || item.findingCount > 0;

  return (
    <li className={cn(
      'agent-activity__item',
      `agent-activity__item--${item.kind}`,
    )}>
      <span className="agent-activity__marker" aria-hidden="true">
        <Icon />
      </span>
      <article>
        <header>
          <h3>{item.title}</h3>
          <time className="tabular-nums" dateTime={item.createdAt}>
            {dayjs(item.createdAt).format('MMM D, HH:mm')}
          </time>
        </header>
        <p>{item.summary}</p>
        {hasCounts ? (
          <footer aria-label="Activity counts">
            {item.inputCount > 0 ? (
              <span className="tabular-nums">
                {describeCount(item.inputCount, 'new item')}
              </span>
            ) : null}
            {item.findingCount > 0 ? (
              <span className="tabular-nums">
                {describeCount(item.findingCount, 'Finding')}
              </span>
            ) : null}
          </footer>
        ) : null}
      </article>
    </li>
  );
}

function EmptyActivityState({ hasInterest }: { hasInterest: boolean }) {
  return (
    <section
      className="foundation-panel agent-activity agent-activity--empty"
      aria-labelledby="agent-activity-empty-title"
    >
      <header>
        <span className="foundation-panel__icon" aria-hidden="true">
          <Activity />
        </span>
        <span className="foundation-status">Real activity only</span>
      </header>
      <div>
        <h2 id="agent-activity-empty-title">No Agent activity yet</h2>
        <p>
          After Lucid checks the current Interest, its result will appear here.
          This history does not invent sample runs or expose internal logs.
        </p>
      </div>
      <Button asChild className="agent-activity__empty-action" variant="secondary">
        <Link to="/interests">
          {hasInterest ? 'Review the current Interest' : 'Set the current Interest'}
        </Link>
      </Button>
    </section>
  );
}

function describeCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

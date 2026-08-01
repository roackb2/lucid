import {
  Bot,
  CircleAlert,
  LoaderCircle,
  Pause,
  UserRound,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { AgentView, DiscoverySnapshot } from '@/lib/trpc';

type RepresentativeAgentCardProps = {
  agent: AgentView;
  task?: DiscoverySnapshot['backgroundChecks']['tasks'][number];
};

export function RepresentativeAgentCard({
  agent,
  task,
}: RepresentativeAgentCardProps) {
  const status = representativeStatus(agent, task);
  const StatusIcon = status.icon;

  return (
    <article
      className={`representative-card ${
        agent.status === 'running' ? 'representative-card--active' : ''
      }`}
      style={{ '--agent-color': agent.color } as CSSProperties}
    >
      <header>
        <span className="representative-card__icon">
          {agent.participant.kind === 'human'
            ? <UserRound size={17} />
            : <Bot size={17} />}
        </span>
        <span className={`agent-status agent-status--${status.kind}`}>
          <span className="agent-status__icon">
            <StatusIcon size={12} />
          </span>
          {status.label}
        </span>
      </header>
      <strong>{agent.name}</strong>
      <span>{agent.role}</span>
      <p>{agent.purpose}</p>
      <footer>
        <span>{agent.participant.displayName}</span>
        <span>{agent.runCount} wakes</span>
      </footer>
    </article>
  );
}

function representativeStatus(
  agent: AgentView,
  task: RepresentativeAgentCardProps['task'],
) {
  if (agent.status === 'running' || task?.status === 'running') {
    return { icon: LoaderCircle, label: 'Checking', kind: 'running' };
  }
  if (agent.status === 'error' || task?.status === 'failed') {
    return { icon: CircleAlert, label: 'Retry scheduled', kind: 'error' };
  }
  if (task?.status === 'blocked') {
    return { icon: CircleAlert, label: 'Needs attention', kind: 'error' };
  }
  if (!task?.enabled) {
    return { icon: Pause, label: 'Paused', kind: 'idle' };
  }
  return { icon: Bot, label: 'Scheduled', kind: 'idle' };
}

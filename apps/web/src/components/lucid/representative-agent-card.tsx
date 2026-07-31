import {
  Bot,
  CircleAlert,
  LoaderCircle,
  UserRound,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { AgentView } from '@/lib/trpc';

type RepresentativeAgentCardProps = {
  agent: AgentView;
  isActive: boolean;
};

export function RepresentativeAgentCard({
  agent,
  isActive,
}: RepresentativeAgentCardProps) {
  const status = {
    idle: { icon: Bot, label: 'Idle' },
    running: { icon: LoaderCircle, label: 'Running' },
    error: { icon: CircleAlert, label: 'Error' },
  }[agent.status];
  const StatusIcon = status.icon;

  return (
    <article
      className={`representative-card ${isActive ? 'representative-card--active' : ''}`}
      style={{ '--agent-color': agent.color } as CSSProperties}
    >
      <header>
        <span className="representative-card__icon">
          {agent.participant.kind === 'human'
            ? <UserRound size={17} />
            : <Bot size={17} />}
        </span>
        <span className={`agent-status agent-status--${agent.status}`}>
          <StatusIcon size={12} />
          {status.label}
        </span>
      </header>
      <strong>{agent.name}</strong>
      <span>{agent.role}</span>
      <p>{agent.purpose}</p>
      <footer>
        <span>{agent.participant.displayName}</span>
        <span>{agent.runCount} agent steps</span>
      </footer>
    </article>
  );
}

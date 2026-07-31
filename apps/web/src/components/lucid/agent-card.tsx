import { Bot, Eye, Moon, Radio, UserRound } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { AgentView } from '@/lib/trpc';

type AgentCardProps = {
  agent: AgentView;
  isActive: boolean;
};

export function AgentCard({ agent, isActive }: AgentCardProps) {
  const stateIcon = {
    resting: <Moon size={13} />,
    waking: <Radio size={13} />,
    error: <Eye size={13} />,
  }[agent.status];

  return (
    <article
      className={`agent-card ${isActive ? 'agent-card--active' : ''}`}
      style={{ '--agent-color': agent.color } as CSSProperties}
    >
      <span className="agent-card__glow" aria-hidden="true" />
      <header>
        <span className="agent-sigil">{agent.sigil}</span>
        <span className={`agent-state agent-state--${agent.status}`}>
          {stateIcon}
          {agent.status}
        </span>
      </header>
      <div className="agent-card__identity">
        <strong>{agent.name}</strong>
        <em>{agent.role}</em>
      </div>
      <p>{agent.purpose}</p>
      <footer>
        <span>
          {agent.principal.kind === 'human'
            ? <UserRound size={12} />
            : <Bot size={12} />}
          {agent.principal.displayName}
        </span>
        <span>{agent.wakeCount} wakes</span>
      </footer>
    </article>
  );
}

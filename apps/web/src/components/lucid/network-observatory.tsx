import { ChevronDown, Eye } from 'lucide-react';
import type { AgentView, NetworkEvent } from '@/lib/trpc';
import { AgentCard } from './agent-card';
import { NetworkTimeline } from './network-timeline';
import { ResetDialog } from './reset-dialog';

type NetworkObservatoryProps = {
  agents: AgentView[];
  events: NetworkEvent[];
  activeAgentId?: string;
  isActive: boolean;
  isResetting: boolean;
  onReset(): void;
};

export function NetworkObservatory({
  agents,
  events,
  activeAgentId,
  isActive,
  isResetting,
  onReset,
}: NetworkObservatoryProps) {
  return (
    <details className="network-observatory">
      <summary>
        <div className="observatory-summary__icon">
          <Eye size={17} />
        </div>
        <div>
          <p className="eyebrow">Optional laboratory view</p>
          <strong>Behind the glass</strong>
          <span>
            Inspect agent boundaries, private delivery and every causal event.
          </span>
        </div>
        <ChevronDown className="observatory-chevron" size={18} />
      </summary>

      <div className="observatory-content">
        <section className="agent-observatory" aria-labelledby="agents-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">One real principal, two lab fixtures</p>
              <h3 id="agents-title">Representatives</h3>
            </div>
            <p>
              Synthetic private context is deliberately absent from this UI.
            </p>
          </div>
          <div className="agent-grid">
            {agents.map((agent) => (
              <AgentCard
                agent={agent}
                isActive={activeAgentId === agent.id}
                key={agent.id}
              />
            ))}
          </div>
        </section>

        <NetworkTimeline agents={agents} events={events} />

        <footer className="observatory-footer">
          <p>
            Resetting clears only the active First Return generation. It does
            not delete older Heddle session or trace files.
          </p>
          <ResetDialog
            disabled={isActive}
            isPending={isResetting}
            onReset={onReset}
          />
        </footer>
      </div>
    </details>
  );
}

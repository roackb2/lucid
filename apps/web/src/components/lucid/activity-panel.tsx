import { ChevronDown, Wrench } from 'lucide-react';
import type { AgentView, DiscoveryEvent } from '@/lib/trpc';
import { ActivityLog } from './activity-log';
import { RepresentativeAgentCard } from './representative-agent-card';
import { ResetWorkspaceDialog } from './reset-workspace-dialog';

type ActivityPanelProps = {
  agents: AgentView[];
  events: DiscoveryEvent[];
  activeAgentId?: string;
  isRunActive: boolean;
  isResetting: boolean;
  onReset(): void;
};

export function ActivityPanel({
  agents,
  events,
  activeAgentId,
  isRunActive,
  isResetting,
  onReset,
}: ActivityPanelProps) {
  return (
    <details className="activity-panel" id="activity">
      <summary>
        <span className="activity-panel__icon" aria-hidden="true">
          <Wrench size={17} />
        </span>
        <span>
          <strong>Technical activity</strong>
          <small>
            Inspect participant boundaries, agent status, visibility and the
            complete event path.
          </small>
        </span>
        <ChevronDown className="activity-panel__chevron" size={17} />
      </summary>

      <div className="activity-panel__content">
        <section className="representatives" aria-labelledby="representatives-title">
          <header className="activity-section-heading">
            <div>
              <p className="section-label">Execution participants</p>
              <h3 id="representatives-title">Representative agents</h3>
            </div>
            <p>
              Two participant profiles contain simulated test data. Their
              private context is never included in the user snapshot.
            </p>
          </header>
          <div className="representative-grid">
            {agents.map((agent) => (
              <RepresentativeAgentCard
                agent={agent}
                isActive={activeAgentId === agent.id}
                key={agent.id}
              />
            ))}
          </div>
        </section>

        <ActivityLog agents={agents} events={events} />

        <footer className="activity-panel__footer">
          <p>
            Resetting clears the active discovery workspace and creates new
            Heddle conversations. Existing session and trace files remain on
            disk.
          </p>
          <ResetWorkspaceDialog
            disabled={isRunActive}
            isPending={isResetting}
            onReset={onReset}
          />
        </footer>
      </div>
    </details>
  );
}

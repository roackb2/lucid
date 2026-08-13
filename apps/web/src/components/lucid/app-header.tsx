import { LogOut, Search } from 'lucide-react';
import type { DiscoverySnapshot } from '@/lib/trpc';

type AppHeaderProps = {
  snapshot: DiscoverySnapshot;
  onSignOut?: () => Promise<void>;
};

export function AppHeader({ snapshot, onSignOut }: AppHeaderProps) {
  const isRunning = snapshot.backgroundChecks.running;
  const isEnabled = snapshot.backgroundChecks.enabled;
  const dispatchEnabled = snapshot.backgroundChecks.dispatchEnabled;
  const hasFailedWake = snapshot.agent.status === 'error'
    || snapshot.backgroundChecks.tasks.some(({ agentId, status }) => (
      agentId === snapshot.agent.id && status === 'failed'
    ));

  return (
    <header className="app-header">
      <a className="app-brand" href="#" aria-label="Lucid home">
        <span className="app-brand__mark" aria-hidden="true">L</span>
        <span>
          <strong>Lucid</strong>
          <small>Delegated discovery</small>
        </span>
      </a>

      <nav className="app-nav" aria-label="Workspace sections">
        <a href="#interest"><Search size={15} /> Interest</a>
        <a href="#conversation">Ask</a>
        <a href="#findings">Findings</a>
      </nav>

      <div className="app-header__actions">
        <div
          className={`service-status ${
            hasFailedWake
              ? 'service-status--error'
              : isRunning ? 'service-status--running' : ''
          }`}
          title={`Model: ${snapshot.runtime.model}`}
        >
          <span />
          {hasFailedWake
            ? 'Your agent needs attention'
            : !dispatchEnabled
            ? 'Hosted demo is paused'
            : isRunning
            ? 'Your agent is checking'
            : isEnabled
              ? 'Your agent is listening'
              : 'Your agent is paused'}
        </div>
        {onSignOut ? (
          <button
            aria-label="Sign out"
            className="app-header__sign-out"
            onClick={() => void onSignOut()}
            title="Sign out"
            type="button"
          >
            <LogOut size={16} />
          </button>
        ) : null}
      </div>
    </header>
  );
}

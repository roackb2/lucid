import { Search } from 'lucide-react';
import type { DiscoverySnapshot } from '@/lib/trpc';

type AppHeaderProps = {
  snapshot: DiscoverySnapshot;
};

export function AppHeader({ snapshot }: AppHeaderProps) {
  const isRunning = snapshot.backgroundChecks.running;
  const isEnabled = snapshot.backgroundChecks.enabled;
  const hasFailedWake = snapshot.representative.status === 'error'
    || snapshot.backgroundChecks.tasks.some(({ agentId, status }) => (
      agentId === snapshot.representative.id && status === 'failed'
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
        <a href="#findings">Findings</a>
      </nav>

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
          : isRunning
          ? 'Your agent is checking'
          : isEnabled
            ? 'Your agent is listening'
            : 'Your agent is paused'}
      </div>
    </header>
  );
}

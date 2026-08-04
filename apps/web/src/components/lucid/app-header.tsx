import { Activity, Search, Users } from 'lucide-react';
import type { DiscoverySnapshot } from '@/lib/trpc';

type AppHeaderProps = {
  snapshot: DiscoverySnapshot;
};

export function AppHeader({ snapshot }: AppHeaderProps) {
  const isRunning = snapshot.backgroundChecks.running;
  const isEnabled = snapshot.backgroundChecks.enabled;

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
        <a href="#sources"><Users size={15} /> Sources</a>
        <a href="#activity"><Activity size={15} /> Activity</a>
      </nav>

      <div
        className={`service-status ${isRunning ? 'service-status--running' : ''}`}
        title={`Model: ${snapshot.runtime.model}`}
      >
        <span />
        {isRunning
          ? 'Checking messages'
          : isEnabled
            ? 'Background checks on'
            : 'Checks paused'}
      </div>
    </header>
  );
}

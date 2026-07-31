import { Activity, GitBranch, Sparkles } from 'lucide-react';
import type { LucidSnapshot } from '@/lib/trpc';

type LucidHeaderProps = {
  snapshot: LucidSnapshot;
};

export function LucidHeader({ snapshot }: LucidHeaderProps) {
  const { activeJourney, network, runtime } = snapshot;

  return (
    <header className="lucid-header">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="eyebrow">Persistent delegated encounter</p>
          <h1>Lucid <i>First Return</i></h1>
        </div>
      </div>

      <dl className="runtime-strip" aria-label="Lucid runtime">
        <div>
          <dt><Activity size={14} /> State</dt>
          <dd className={activeJourney ? 'status-away' : 'status-home'}>
            <span className="status-dot" />
            {activeJourney ? 'Away' : 'Home'}
          </dd>
        </div>
        <div>
          <dt><Sparkles size={14} /> Mind</dt>
          <dd>{runtime.model}</dd>
        </div>
        <div className="runtime-wide">
          <dt><GitBranch size={14} /> Generation</dt>
          <dd title={network.generation}>{network.generation.slice(0, 8)}</dd>
        </div>
      </dl>
    </header>
  );
}

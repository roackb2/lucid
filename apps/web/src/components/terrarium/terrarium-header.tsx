import { Activity, GitBranch, Sparkles } from 'lucide-react';
import type { TerrariumSnapshot } from '@/lib/trpc';

type TerrariumHeaderProps = {
  snapshot: TerrariumSnapshot;
};

export function TerrariumHeader({ snapshot }: TerrariumHeaderProps) {
  const { activeCycle, runtime, world } = snapshot;

  return (
    <header className="terrarium-header">
      <div className="brand-lockup">
        <div className="brand-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="eyebrow">Persistent synthetic ecology</p>
          <h1>Lucid <i>Dream Terrarium</i></h1>
        </div>
      </div>

      <dl className="runtime-strip" aria-label="Terrarium runtime">
        <div>
          <dt><Activity size={14} /> State</dt>
          <dd className={activeCycle ? 'status-awake' : 'status-resting'}>
            <span className="status-dot" />
            {activeCycle ? 'Dreaming' : 'Quiet'}
          </dd>
        </div>
        <div>
          <dt><Sparkles size={14} /> Mind</dt>
          <dd>{runtime.model}</dd>
        </div>
        <div className="runtime-wide">
          <dt><GitBranch size={14} /> Generation</dt>
          <dd title={world.generation}>{world.generation.slice(0, 8)}</dd>
        </div>
      </dl>
    </header>
  );
}

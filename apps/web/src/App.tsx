import { CloudOff, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { ActiveCycle } from '@/components/terrarium/active-cycle';
import { DreamerObservatory } from '@/components/terrarium/dreamer-observatory';
import { OperatorConsole } from '@/components/terrarium/operator-console';
import { TerrariumHeader } from '@/components/terrarium/terrarium-header';
import { WorldTimeline } from '@/components/terrarium/world-timeline';
import { Button } from '@/components/ui/button';
import { useTerrarium } from '@/hooks/use-terrarium';

export default function App() {
  const terrarium = useTerrarium();
  const [selectedDreamerId, setSelectedDreamerId] = useState<string>();
  const snapshot = terrarium.snapshot.data;

  if (terrarium.snapshot.isPending) {
    return <TerrariumLoading />;
  }

  if (!snapshot) {
    return (
      <main className="fatal-state">
        <CloudOff size={32} />
        <p className="eyebrow">The glass is unreachable</p>
        <h1>Lucid cannot find its world.</h1>
        <p>
          Start the local server, then reconnect. No world state has been
          discarded.
        </p>
        <Button onClick={() => terrarium.snapshot.refetch()} variant="secondary">
          <RefreshCw size={15} />
          Try again
        </Button>
      </main>
    );
  }

  const activeCycle = snapshot.activeCycle;

  return (
    <div className="app-shell">
      <div className="ambient-orb ambient-orb--one" aria-hidden="true" />
      <div className="ambient-orb ambient-orb--two" aria-hidden="true" />
      <TerrariumHeader snapshot={snapshot} />

      <main>
        <section className="world-intro">
          <div>
            <p className="eyebrow">World tick {snapshot.world.currentTick}</p>
            <h2>
              A small society that only
              <span> moves when observed.</span>
            </h2>
            <p>
              Three durable minds share one causal world. Give them a fragment,
              wake them one at a time, and watch provenance survive—or mutate—as
              it passes between them.
            </p>
          </div>
          <WorldPulse
            active={Boolean(activeCycle)}
            eventCount={snapshot.events.length}
            tick={snapshot.world.currentTick}
          />
        </section>

        {activeCycle ? (
          <ActiveCycle
            cycle={activeCycle}
            isCancelling={terrarium.cancel.isPending}
            onCancel={() => terrarium.cancel.mutate()}
          />
        ) : null}

        <DreamerObservatory
          activeDreamerId={activeCycle?.dreamerId}
          dreamers={snapshot.dreamers}
          onSelectDreamer={setSelectedDreamerId}
          selectedDreamerId={selectedDreamerId}
        />

        <div className="workbench">
          <OperatorConsole
            isActive={Boolean(activeCycle)}
            isAdvancing={terrarium.advance.isPending}
            isResetting={terrarium.reset.isPending}
            isSeeding={terrarium.seed.isPending}
            onAdvance={(steps) => terrarium.advance.mutate(steps)}
            onReset={() => terrarium.reset.mutate()}
            onSeed={(content) => terrarium.seed.mutate(content)}
          />
          <WorldTimeline
            dreamers={snapshot.dreamers}
            events={snapshot.events}
            selectedDreamerId={selectedDreamerId}
          />
        </div>
      </main>

      <footer className="app-footer">
        <span>Lucid / Heddle {snapshot.runtime.heddleVersion}</span>
        <span>Local-first · operator-controlled · inspectable</span>
      </footer>
    </div>
  );
}

type WorldPulseProps = {
  active: boolean;
  eventCount: number;
  tick: number;
};

function WorldPulse({ active, eventCount, tick }: WorldPulseProps) {
  return (
    <div className={`world-pulse ${active ? 'world-pulse--active' : ''}`}>
      <div className="world-pulse__rings" aria-hidden="true">
        <span />
        <span />
        <span />
        <i>✦</i>
      </div>
      <dl>
        <div>
          <dt>Tick</dt>
          <dd>{String(tick).padStart(3, '0')}</dd>
        </div>
        <div>
          <dt>Visible ledger</dt>
          <dd>{eventCount}</dd>
        </div>
      </dl>
    </div>
  );
}

function TerrariumLoading() {
  return (
    <main className="loading-state">
      <div className="loading-sigil" aria-hidden="true">
        <span />
        <span />
        <i>✦</i>
      </div>
      <p className="eyebrow">Condensation is gathering</p>
      <h1>Opening the terrarium…</h1>
    </main>
  );
}

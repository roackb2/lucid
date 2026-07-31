import { CloudOff, RefreshCw } from 'lucide-react';
import { ActiveJourney } from '@/components/lucid/active-journey';
import { IntentPanel } from '@/components/lucid/intent-panel';
import { LucidHeader } from '@/components/lucid/lucid-header';
import { NetworkObservatory } from '@/components/lucid/network-observatory';
import { ReturnPanel } from '@/components/lucid/return-panel';
import { Button } from '@/components/ui/button';
import { useLucid } from '@/hooks/use-lucid';

export default function App() {
  const lucid = useLucid();
  const snapshot = lucid.snapshot.data;

  if (lucid.snapshot.isPending) {
    return <LucidLoading />;
  }

  if (!snapshot) {
    return (
      <main className="fatal-state">
        <CloudOff size={32} />
        <p className="eyebrow">The network is unreachable</p>
        <h1>Lucid cannot find Aster.</h1>
        <p>
          Start the local server, then reconnect. Durable agent conversations
          and completed network events remain on disk.
        </p>
        <Button onClick={() => lucid.snapshot.refetch()} variant="secondary">
          <RefreshCw size={15} />
          Try again
        </Button>
      </main>
    );
  }

  const latestReturn = snapshot.returns[0];
  const activeJourney = snapshot.activeJourney;
  const homeAgent = snapshot.agents.find((agent) => agent.isHomeAgent);

  return (
    <div className="app-shell">
      <div className="ambient-orb ambient-orb--one" aria-hidden="true" />
      <div className="ambient-orb ambient-orb--two" aria-hidden="true" />
      <LucidHeader snapshot={snapshot} />

      <main>
        <section className="first-return-intro">
          <div>
            <p className="eyebrow">First Return · local network experiment</p>
            <h2>
              Leave one thought.
              <span> See what comes back.</span>
            </h2>
            <p>
              Tell one persistent agent what you care about. It will carry only
              enough of that intent into a bounded network, meet two clearly
              synthetic peers, and return with one causal encounter—or choose
              not to interrupt you.
            </p>
          </div>
          <JourneyPulse
            active={Boolean(activeJourney)}
            peerCount={snapshot.agents.length - 1}
            returnCount={snapshot.returns.length}
          />
        </section>

        {activeJourney ? (
          <ActiveJourney
            journey={activeJourney}
            isCancelling={lucid.cancel.isPending}
            onCancel={() => lucid.cancel.mutate()}
          />
        ) : null}

        <section className="home-section" aria-labelledby="home-title">
          <div className="section-heading home-heading">
            <div>
              <p className="eyebrow">Private relationship</p>
              <h2 id="home-title">{homeAgent?.name ?? 'Aster'} represents you</h2>
            </div>
            <p>
              Value is yours to judge. Lucid records delivery and provenance,
              not universal confidence.
            </p>
          </div>

          <div className="home-grid">
            <IntentPanel
              agentName={homeAgent?.name ?? 'Aster'}
              intent={snapshot.intent}
              isActive={Boolean(activeJourney)}
              isSaving={lucid.setIntent.isPending}
              isStarting={lucid.startJourney.isPending}
              onSetIntent={(content) => lucid.setIntent.mutate(content)}
              onStartJourney={() => lucid.startJourney.mutate()}
            />
            <ReturnPanel
              agents={snapshot.agents}
              isSubmitting={lucid.feedback.isPending}
              key={latestReturn?.event.sequence ?? 'empty'}
              onFeedback={(returnSequence, content) => (
                lucid.feedback.mutate({ returnSequence, content })
              )}
              value={latestReturn}
            />
          </div>
        </section>

        <aside className="epistemic-boundary">
          <span aria-hidden="true">◎</span>
          <div>
            <p className="eyebrow">What this run can establish</p>
            <p>
              If Aster cites a peer event it could not see beforehand, the
              network caused a new delivery path. Only your response can tell
              us whether that encounter mattered. Neither result proves a
              network effect.
            </p>
          </div>
        </aside>

        <NetworkObservatory
          activeAgentId={activeJourney?.agentId}
          agents={snapshot.agents}
          events={snapshot.events}
          isActive={Boolean(activeJourney)}
          isResetting={lucid.reset.isPending}
          onReset={() => lucid.reset.mutate()}
        />
      </main>

      <footer className="app-footer">
        <span>Lucid / Heddle {snapshot.runtime.heddleVersion}</span>
        <span>One real principal · two synthetic peers · inspectable paths</span>
      </footer>
    </div>
  );
}

type JourneyPulseProps = {
  active: boolean;
  peerCount: number;
  returnCount: number;
};

function JourneyPulse({ active, peerCount, returnCount }: JourneyPulseProps) {
  return (
    <div className={`journey-pulse ${active ? 'journey-pulse--active' : ''}`}>
      <div className="journey-pulse__rings" aria-hidden="true">
        <span />
        <span />
        <span />
        <i>✦</i>
      </div>
      <dl>
        <div>
          <dt>Synthetic peers</dt>
          <dd>{peerCount}</dd>
        </div>
        <div>
          <dt>Returns</dt>
          <dd>{String(returnCount).padStart(2, '0')}</dd>
        </div>
      </dl>
    </div>
  );
}

function LucidLoading() {
  return (
    <main className="loading-state">
      <div className="loading-sigil" aria-hidden="true">
        <span />
        <span />
        <i>✦</i>
      </div>
      <p className="eyebrow">Reopening private continuity</p>
      <h1>Finding Aster…</h1>
    </main>
  );
}

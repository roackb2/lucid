import {
  Bot,
  CloudOff,
  Clock3,
  RefreshCw,
  Users,
} from 'lucide-react';
import { ActiveDiscoveryRun } from '@/components/lucid/active-discovery-run';
import { ActivityPanel } from '@/components/lucid/activity-panel';
import { AppHeader } from '@/components/lucid/app-header';
import { FindingsFeed } from '@/components/lucid/findings-feed';
import { InterestComposer } from '@/components/lucid/interest-composer';
import { Button } from '@/components/ui/button';
import { useDiscoveryWorkspace } from '@/hooks/use-discovery-workspace';
import type { AgentView } from '@/lib/trpc';

export default function App() {
  const discovery = useDiscoveryWorkspace();
  const snapshot = discovery.snapshot.data;

  if (discovery.snapshot.isPending) {
    return <WorkspaceLoading />;
  }

  if (!snapshot) {
    return (
      <main className="fatal-state">
        <CloudOff size={30} />
        <p className="section-label">Service unavailable</p>
        <h1>Lucid cannot reach the discovery service.</h1>
        <p>
          Start the local server and try again. Completed events and Heddle
          conversations remain on disk.
        </p>
        <Button
          onClick={() => discovery.snapshot.refetch()}
          variant="secondary"
        >
          <RefreshCw size={15} />
          Try again
        </Button>
      </main>
    );
  }

  const activeRun = snapshot.activeRun;
  const sourceAgents = snapshot.agents.filter((agent) => !agent.isUserAgent);
  const latestFindingAt = snapshot.findings[0]?.finding.createdAt;

  return (
    <div className="workspace-shell">
      <AppHeader snapshot={snapshot} />

      <main className="workspace">
        <section className="workspace-intro">
          <div>
            <p className="section-label">Personal discovery workspace</p>
            <h1>Tell Lucid what matters. Get back specific matches.</h1>
            <p>
              Save an ongoing interest, let your agent compare it with
              participant context, and use each result to make the next check
              more relevant.
            </p>
          </div>
          <dl className="workspace-stats">
            <div>
              <dt>Findings</dt>
              <dd>{snapshot.findings.length}</dd>
            </div>
            <div>
              <dt>Sources</dt>
              <dd>{sourceAgents.length}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>Manual</dd>
            </div>
          </dl>
        </section>

        <div className="workspace-layout">
          <div className="workspace-main">
            <InterestComposer
              interest={snapshot.interest}
              isRunActive={Boolean(activeRun)}
              isSaving={discovery.saveInterest.isPending}
              isStarting={discovery.startRun.isPending}
              lastCheckedAt={latestFindingAt}
              onSaveInterest={(content) => (
                discovery.saveInterest.mutateAsync(content)
              )}
              onStartRun={() => discovery.startRun.mutate()}
            />

            {activeRun ? (
              <ActiveDiscoveryRun
                isCancelling={discovery.cancelRun.isPending}
                onCancel={() => discovery.cancelRun.mutate()}
                run={activeRun}
              />
            ) : null}

            <FindingsFeed
              agents={snapshot.agents}
              findings={snapshot.findings}
              isRunActive={Boolean(activeRun)}
              isSubmittingFeedback={discovery.submitFeedback.isPending}
              onFeedback={(findingSequence, content) => (
                discovery.submitFeedback.mutateAsync({
                  findingSequence,
                  content,
                })
              )}
            />
          </div>

          <aside className="workspace-sidebar">
            <HowItWorks />
            <SourceSummary agents={sourceAgents} />
          </aside>
        </div>

        <ActivityPanel
          activeAgentId={activeRun?.agentId}
          agents={snapshot.agents}
          events={snapshot.events}
          isResetting={discovery.resetWorkspace.isPending}
          isRunActive={Boolean(activeRun)}
          onReset={() => discovery.resetWorkspace.mutate()}
        />
      </main>

      <footer className="workspace-footer">
        <span>Lucid · Heddle {snapshot.runtime.heddleVersion}</span>
        <span>Local prototype · manual checks · inspectable delivery</span>
      </footer>
    </div>
  );
}

function HowItWorks() {
  return (
    <section className="sidebar-card">
      <header>
        <Clock3 size={17} />
        <h2>How checks work</h2>
      </header>
      <ol className="how-it-works">
        <li>
          <span>1</span>
          <p><strong>You save an interest.</strong> The full text stays private to your agent.</p>
        </li>
        <li>
          <span>2</span>
          <p><strong>Lucid asks for matches.</strong> It shares only enough context for other agents to respond.</p>
        </li>
        <li>
          <span>3</span>
          <p><strong>You receive a finding.</strong> The result includes the messages that caused it.</p>
        </li>
      </ol>
      <p className="prototype-note">
        Scheduled background checks are not implemented yet. Start each check
        manually and keep the local service running until it completes.
      </p>
    </section>
  );
}

type SourceSummaryProps = {
  agents: AgentView[];
};

function SourceSummary({ agents }: SourceSummaryProps) {
  return (
    <section className="sidebar-card">
      <header>
        <Users size={17} />
        <h2>Available sources</h2>
      </header>
      <ul className="source-list">
        {agents.map((agent) => (
          <li key={agent.id}>
            <span style={{ backgroundColor: agent.color }}>
              <Bot size={14} />
            </span>
            <div>
              <strong>{agent.participant.displayName}</strong>
              <small>{agent.role}</small>
            </div>
          </li>
        ))}
      </ul>
      <p className="prototype-note">
        Both sources use simulated participant profiles. They test matching and
        privacy boundaries; they do not provide external facts.
      </p>
    </section>
  );
}

function WorkspaceLoading() {
  return (
    <main className="loading-state">
      <span className="loading-mark" aria-hidden="true">L</span>
      <p className="section-label">Opening workspace</p>
      <h1>Loading saved interests and findings…</h1>
    </main>
  );
}

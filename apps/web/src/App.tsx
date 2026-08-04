import {
  Bot,
  CloudOff,
  Clock3,
  RefreshCw,
  UserRound,
  Users,
} from 'lucide-react';
import { ActivityPanel } from '@/components/lucid/activity-panel';
import { AppHeader } from '@/components/lucid/app-header';
import { BackgroundChecks } from '@/components/lucid/background-checks';
import { FindingsFeed } from '@/components/lucid/findings-feed';
import { InterestComposer } from '@/components/lucid/interest-composer';
import { ParticipantNetwork } from '@/components/lucid/participant-network';
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

  const backgroundChecks = snapshot.backgroundChecks;
  const sourceAgents = snapshot.agents.filter(
    (agent) => !agent.isUserAgent && agent.participant.status !== 'retired',
  );
  const activeSourceCount = sourceAgents.filter(
    (agent) => agent.participant.status === 'active',
  ).length;

  return (
    <div className="workspace-shell">
      <AppHeader snapshot={snapshot} />

      <main className="workspace">
        <section className="workspace-intro">
          <div>
            <p className="section-label">Personal discovery workspace</p>
            <h1>Tell Lucid what matters. See what your network brings back.</h1>
            <p>
              Save an ongoing interest, leave your representative listening,
              and decide which peer-sourced discoveries are actually useful.
            </p>
          </div>
          <dl className="workspace-stats">
            <div>
              <dt>Findings</dt>
              <dd>{snapshot.findings.length}</dd>
            </div>
            <div>
              <dt>Sources</dt>
              <dd>{activeSourceCount}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{backgroundChecks.enabled ? 'Background' : 'Paused'}</dd>
            </div>
          </dl>
        </section>

        <div className="workspace-layout">
          <div className="workspace-main">
            <InterestComposer
              interest={snapshot.interest}
              backgroundChecksEnabled={backgroundChecks.enabled}
              isChecking={backgroundChecks.running}
              isSaving={discovery.saveInterest.isPending}
              isRunningNow={discovery.runNow.isPending}
              lastCheckedAt={backgroundChecks.lastRunAt}
              onSaveInterest={(content) => (
                discovery.saveInterest.mutateAsync(content)
              )}
              onRunNow={() => discovery.runNow.mutate()}
            />

            <FindingsFeed
              agents={snapshot.agents}
              backgroundChecksEnabled={backgroundChecks.enabled}
              findings={snapshot.findings}
              isChecking={backgroundChecks.running}
              isSubmittingFeedback={discovery.submitFeedback.isPending}
              onFeedback={(findingSequence, content) => (
                discovery.submitFeedback.mutateAsync({
                  findingSequence,
                  content,
                })
              )}
            />

            <BackgroundChecks
              checks={backgroundChecks}
              isUpdating={discovery.setBackgroundChecksEnabled.isPending}
              onSetEnabled={(enabled) => (
                discovery.setBackgroundChecksEnabled.mutate(enabled)
              )}
            />

            <ParticipantNetwork
              agents={snapshot.agents}
              isCreating={discovery.createAssistedParticipant.isPending}
              isPausingSimulated={
                discovery.pauseSimulatedParticipants.isPending
              }
              isUpdating={
                discovery.setParticipantEnabled.isPending
                || discovery.retireParticipant.isPending
              }
              isUpdatingContext={
                discovery.updateAssistedParticipantContext.isPending
              }
              onCreate={(input) => (
                discovery.createAssistedParticipant.mutateAsync(input)
              )}
              onLoadContext={async (participantId) => {
                try {
                  return await discovery.loadAssistedParticipantContext
                    .mutateAsync(participantId);
                } finally {
                  // The explicit review dialog owns this sensitive response;
                  // do not retain it in React Query after handing it over.
                  discovery.loadAssistedParticipantContext.reset();
                }
              }}
              onPauseSimulated={() => (
                discovery.pauseSimulatedParticipants.mutateAsync()
              )}
              onRetire={(participantId) => (
                discovery.retireParticipant.mutateAsync(participantId)
              )}
              onSetEnabled={(participantId, enabled) => (
                discovery.setParticipantEnabled.mutateAsync({
                  participantId,
                  enabled,
                })
              )}
              onUpdateContext={(input) => (
                discovery.updateAssistedParticipantContext.mutateAsync(input)
              )}
              tasks={backgroundChecks.tasks}
            />
          </div>

          <aside className="workspace-sidebar">
            <HowItWorks />
            <SourceSummary agents={sourceAgents} />
          </aside>
        </div>

        <ActivityPanel
          agents={snapshot.agents}
          events={snapshot.events}
          isResetting={discovery.resetWorkspace.isPending}
          onReset={() => discovery.resetWorkspace.mutate()}
          tasks={backgroundChecks.tasks}
        />
      </main>

      <footer className="workspace-footer">
        <span>Lucid · Heddle {snapshot.runtime.heddleVersion}</span>
        <span>Local prototype · durable background checks · inspectable delivery</span>
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
          <p><strong>Agents wake on a schedule.</strong> New messages can wake the relevant representative sooner.</p>
        </li>
        <li>
          <span>3</span>
          <p><strong>You receive a finding.</strong> The result includes the messages that caused it.</p>
        </li>
      </ol>
      <p className="prototype-note">
        Empty wakes do not call the model. Lucid acts only when an agent has
        unread user input or another agent’s message.
      </p>
    </section>
  );
}

type SourceSummaryProps = {
  agents: AgentView[];
};

function SourceSummary({ agents }: SourceSummaryProps) {
  const activeAgents = agents.filter(
    (agent) => agent.participant.status === 'active',
  );
  const realSourceCount = activeAgents.filter(
    (agent) => agent.participant.kind === 'human',
  ).length;
  const simulatedSourceCount = activeAgents.length - realSourceCount;
  const summary = describeActiveSources(
    realSourceCount,
    simulatedSourceCount,
  );

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
              {agent.participant.kind === 'human'
                ? <UserRound size={14} />
                : <Bot size={14} />}
            </span>
            <div>
              <strong>{agent.participant.displayName}</strong>
              <small>
                {agent.role} · {agent.participant.status === 'active'
                  ? 'active'
                  : 'paused'}
              </small>
            </div>
          </li>
        ))}
      </ul>
      <p className="prototype-note">{summary}</p>
    </section>
  );
}

function describeActiveSources(
  realSourceCount: number,
  simulatedSourceCount: number,
): string {
  if (realSourceCount > 0) {
    return `${realSourceCount} assisted real ${
      realSourceCount === 1 ? 'source is' : 'sources are'
    } active. ${simulatedSourceCount} simulated ${
      simulatedSourceCount === 1 ? 'fixture is' : 'fixtures are'
    } active.`;
  }
  if (simulatedSourceCount > 0) {
    return 'Only simulated fixtures are active. Add one knowingly assisted real participant to test the intended network.';
  }
  return 'No sources are active. Resume a participant before asking the network.';
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

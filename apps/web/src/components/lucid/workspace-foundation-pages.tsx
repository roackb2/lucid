import {
  Activity,
  Bot,
  Construction,
  FileText,
  Search,
  Settings,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { DiscoverySnapshot } from '@/lib/trpc';
import { AgentActivityTimeline } from './agent-activity-timeline';
import { AgentWorkControls } from './agent-work-controls';
import { CurrentInterestEditor } from './current-interest-editor';
import { FoundationPage } from './foundation-page';
import { NetworkFindingsLibrary } from './network-findings-library';

type FoundationPageProps = {
  snapshot: DiscoverySnapshot;
};

export function FindingsFoundationPage({ snapshot }: FoundationPageProps) {
  return (
    <FoundationPage
      eyebrow="Evidence library"
      title="Findings"
      description="Individual discoveries and the original messages behind them. Quiet checks stay in Agent Activity instead of becoming empty Findings."
      readiness="working"
    >
      <NetworkFindingsLibrary
        findings={snapshot.findings}
        hasInterest={Boolean(snapshot.interest)}
      />
    </FoundationPage>
  );
}

export function InterestFoundationPage({
  isSaving,
  onSaveInterest,
  snapshot,
}: FoundationPageProps & {
  isSaving: boolean;
  onSaveInterest(content: string): Promise<unknown>;
}) {
  return (
    <FoundationPage
      eyebrow="What the agent should care about"
      title="Interest"
      description="Lucid keeps one current Interest in focus for this experiment. Refine it whenever you want your agent’s future background work to change."
      readiness="working"
    >
      <CurrentInterestEditor
        interest={snapshot.interest}
        isSaving={isSaving}
        onSave={onSaveInterest}
      />
    </FoundationPage>
  );
}

export function AgentFoundationPage({
  isRetrying,
  isRunningNow,
  isUpdatingBackground,
  onRetry,
  onRunNow,
  onSetBackgroundChecksEnabled,
  snapshot,
}: FoundationPageProps & {
  isRetrying: boolean;
  isRunningNow: boolean;
  isUpdatingBackground: boolean;
  onRetry(): Promise<unknown>;
  onRunNow(): Promise<unknown>;
  onSetBackgroundChecksEnabled(enabled: boolean): Promise<unknown>;
}) {
  const backgroundState = !snapshot.backgroundChecks.dispatchEnabled
    ? 'Operator paused'
    : snapshot.backgroundChecks.running
      ? 'Working now'
      : snapshot.backgroundChecks.enabled
        ? 'Listening in the background'
        : 'Paused';

  return (
    <FoundationPage
      eyebrow="Your delegated worker"
      title="Agent"
      description="A product-readable view of what the agent is doing, what it currently understands, and where it needs your attention."
      readiness="working"
    >
      <section className="agent-overview">
        <span className="agent-overview__avatar" aria-hidden="true">
          <Bot />
        </span>
        <div className="agent-overview__identity">
          <span>Your personal Agent</span>
          <h2>{snapshot.agent.name}</h2>
          <p>{snapshot.agent.purpose}</p>
        </div>
        <dl>
          <div>
            <dt>Status</dt>
            <dd>{backgroundState}</dd>
          </div>
          <div>
            <dt>Runs</dt>
            <dd className="tabular-nums">{snapshot.agent.runCount}</dd>
          </div>
          <div>
            <dt>Unread</dt>
            <dd className="tabular-nums">{snapshot.agent.unreadCount}</dd>
          </div>
        </dl>
      </section>
      <AgentWorkControls
        isRetrying={isRetrying}
        isRunningNow={isRunningNow}
        isUpdatingBackground={isUpdatingBackground}
        onRetry={onRetry}
        onRunNow={onRunNow}
        onSetBackgroundChecksEnabled={onSetBackgroundChecksEnabled}
        snapshot={snapshot}
      />
      <div className="foundation-layout agent-page-layout">
        <AgentActivityTimeline
          activity={snapshot.agentActivity}
          hasInterest={Boolean(snapshot.interest)}
        />
        <FoundationPanel
          title="Agent understanding"
          description={snapshot.workingNote?.content
            ?? 'Lucid has not saved a working understanding yet.'}
          icon={<Bot />}
          muted
          status={snapshot.workingNote ? 'Saved understanding' : 'No saved understanding'}
        />
      </div>
    </FoundationPage>
  );
}

export function SettingsFoundationPage({ snapshot }: FoundationPageProps) {
  return (
    <FoundationPage
      eyebrow="Product-owned controls only"
      title="Settings"
      description="This area stays intentionally small until a real product decision requires a durable preference or control."
      readiness="planned"
    >
      <PlannedPageNotice />
      <section className="settings-runtime">
        <div>
          <span className="settings-runtime__icon" aria-hidden="true">
            <Settings />
          </span>
          <div>
            <strong>Current runtime</strong>
            <p>Read-only implementation context, not a user setting.</p>
          </div>
        </div>
        <dl>
          <div>
            <dt>Model</dt>
            <dd>{snapshot.runtime.model}</dd>
          </div>
          <div>
            <dt>Heddle</dt>
            <dd>{snapshot.runtime.heddleVersion}</dd>
          </div>
        </dl>
      </section>
      <div className="foundation-layout foundation-layout--three">
        <FoundationPanel
          title="Background work"
          description="Cadence and pause controls may belong here after their product semantics are settled."
          icon={<Activity />}
        />
        <FoundationPanel
          title="Data and privacy"
          description="Only concrete retention, export, or consent choices should become settings."
          icon={<FileText />}
        />
        <FoundationPanel
          title="Agent configuration"
          description="Purpose and capability controls remain undefined; this is a reserved place, not a promised feature."
          icon={<Bot />}
        />
      </div>
    </FoundationPage>
  );
}

function PlannedPageNotice() {
  return (
    <section className="page-readiness-notice" aria-labelledby="settings-plan-title">
      <span aria-hidden="true"><Construction /></span>
      <div>
        <h2 id="settings-plan-title">Settings are not yet built</h2>
        <p>
          The runtime summary below is real and read-only. The remaining cards
          reserve possible product areas; they do not change Lucid yet.
        </p>
      </div>
    </section>
  );
}

function FoundationPanel({
  description,
  icon,
  muted = false,
  status = 'Planned',
  title,
}: {
  description: string;
  icon: ReactNode;
  muted?: boolean;
  status?: string;
  title: string;
}) {
  return (
    <section className={muted
      ? 'foundation-panel foundation-panel--muted'
      : 'foundation-panel'}>
      <header>
        <span className="foundation-panel__icon" aria-hidden="true">{icon}</span>
        <span className="foundation-status">{status}</span>
      </header>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </section>
  );
}

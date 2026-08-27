import {
  Activity,
  Bot,
  FileText,
  Search,
  Settings,
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { DiscoverySnapshot } from '@/lib/trpc';
import { CurrentInterestEditor } from './current-interest-editor';
import { NetworkFindingsLibrary } from './network-findings-library';

type FoundationPageProps = {
  snapshot: DiscoverySnapshot;
};

export function ReportsFoundationPage({ snapshot }: FoundationPageProps) {
  return (
    <PageFrame
      eyebrow="Primary return surface"
      title="Reports"
      description="What your agent believes is worth bringing back, grouped into something you can understand and act on."
    >
      <SnapshotSummary snapshot={snapshot} />
      <div className="foundation-layout foundation-layout--reports">
        <FoundationPanel
          title="Report feed"
          description={snapshot.findings.length > 0
            ? `${snapshot.findings.length} experimental finding ${snapshot.findings.length === 1 ? 'record exists' : 'records exist'}, but report grouping is not defined yet.`
            : 'No report records exist yet, and the report contract has not been defined.'}
          icon={<FileText />}
        />
        <FoundationPanel
          title="Report detail"
          description="Selecting a report will eventually keep its summary, grouped findings, evidence, and next actions in view."
          icon={<Search />}
          muted
        />
      </div>
    </PageFrame>
  );
}

export function FindingsFoundationPage({ snapshot }: FoundationPageProps) {
  return (
    <PageFrame
      eyebrow="Evidence library"
      title="Findings"
      description="Individual discoveries and their evidence, available across reports without pretending every network event is important."
      badge="Learning slice · real data"
    >
      <NetworkFindingsLibrary
        findings={snapshot.findings}
        hasInterest={Boolean(snapshot.interest)}
      />
    </PageFrame>
  );
}

export function InterestsFoundationPage({
  isSaving,
  onSaveInterest,
  snapshot,
}: FoundationPageProps & {
  isSaving: boolean;
  onSaveInterest(content: string): Promise<unknown>;
}) {
  return (
    <PageFrame
      eyebrow="What the agent should care about"
      title="Interests"
      description="Lucid keeps one current Interest in focus for this experiment. Refine it whenever you want your agent’s future background work to change."
      badge="Current scope · real data"
    >
      <CurrentInterestEditor
        interest={snapshot.interest}
        isSaving={isSaving}
        onSave={onSaveInterest}
      />
    </PageFrame>
  );
}

export function AgentFoundationPage({ snapshot }: FoundationPageProps) {
  const backgroundState = !snapshot.backgroundChecks.dispatchEnabled
    ? 'Operator paused'
    : snapshot.backgroundChecks.running
      ? 'Working now'
      : snapshot.backgroundChecks.enabled
        ? 'Listening in the background'
        : 'Paused';

  return (
    <PageFrame
      eyebrow="Your delegated worker"
      title="Agent"
      description="A product-readable view of what the agent is doing, what it currently understands, and where it needs your attention."
    >
      <section className="agent-overview">
        <span className="agent-overview__avatar" aria-hidden="true">
          <Bot />
        </span>
        <div className="agent-overview__identity">
          <span>Current experimental agent</span>
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
      <div className="foundation-layout foundation-layout--split">
        <FoundationPanel
          title="Activity"
          description="Background wakes, quiet checks, follow-ups, failures, and cancellations will appear here as product events."
          icon={<Activity />}
        />
        <FoundationPanel
          title="Agent understanding"
          description={snapshot.workingNote?.content
            ?? 'There is no saved working note in the current snapshot.'}
          icon={<Bot />}
          muted
          status={snapshot.workingNote ? 'Experimental record' : 'Not yet populated'}
        />
      </div>
    </PageFrame>
  );
}

export function SettingsFoundationPage({ snapshot }: FoundationPageProps) {
  return (
    <PageFrame
      eyebrow="Product-owned controls only"
      title="Settings"
      description="This stays intentionally small until a real product decision requires a durable preference or control."
    >
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
    </PageFrame>
  );
}

function PageFrame({
  badge = 'Foundation preview',
  children,
  description,
  eyebrow,
  title,
}: {
  badge?: string;
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="foundation-page">
      <header className="foundation-page__heading">
        <div>
          <p>{eyebrow}</p>
          <h1>{title}</h1>
        </div>
        <span className="foundation-badge">{badge}</span>
        <p>{description}</p>
      </header>
      {children}
    </div>
  );
}

function SnapshotSummary({ snapshot }: FoundationPageProps) {
  const backgroundState = snapshot.backgroundChecks.running
    ? 'Working'
    : snapshot.backgroundChecks.enabled
      ? 'Ready'
      : 'Paused';

  return (
    <dl className="snapshot-summary">
      <div>
        <dt>Existing findings</dt>
        <dd className="tabular-nums">{snapshot.findings.length}</dd>
      </div>
      <div>
        <dt>Current interest</dt>
        <dd>{snapshot.interest ? 'Saved' : 'None'}</dd>
      </div>
      <div>
        <dt>Agent</dt>
        <dd>{backgroundState}</dd>
      </div>
    </dl>
  );
}

function FoundationPanel({
  description,
  icon,
  muted = false,
  status = 'Not yet populated',
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

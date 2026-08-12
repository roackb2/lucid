import {
  CloudOff,
  Clock3,
  Network,
  RefreshCw,
} from 'lucide-react';
import { AppHeader } from '@/components/lucid/app-header';
import { GoogleSignIn } from '@/components/lucid/google-sign-in';
import { BackgroundChecks } from '@/components/lucid/background-checks';
import { GuidanceFollowThrough } from '@/components/lucid/guidance-follow-through';
import { FindingsFeed } from '@/components/lucid/findings-feed';
import { HostedAccess } from '@/components/lucid/hosted-access';
import { HostedConversation } from '@/components/lucid/hosted-conversation';
import { InterestComposer } from '@/components/lucid/interest-composer';
import {
  ParticipantOnboarding,
  type ParticipantOnboardingInput,
} from '@/components/lucid/participant-onboarding';
import { RecentNetworkRequests } from '@/components/lucid/recent-network-requests';
import { RepresentativeProgress } from '@/components/lucid/representative-progress';
import { Button } from '@/components/ui/button';
import { useDiscoveryWorkspace } from '@/hooks/use-discovery-workspace';
import { useLucidAuth } from '@/auth/supabase-auth';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  hasHostedAccessToken,
  isAuthenticationRequired,
  setHostedAccessToken,
  lucidClient,
} from '@/lib/trpc';

export default function App() {
  const auth = useLucidAuth();

  if (auth.mode === 'supabase') {
    if (auth.status === 'loading') {
      return <WorkspaceLoading />;
    }
    if (auth.status === 'signed-out') {
      return <GoogleSignIn onSignIn={auth.signInWithGoogle} />;
    }
    return <AuthenticatedSupabaseApp onSignOut={auth.signOut} />;
  }

  return <LegacyWorkspaceApp />;
}

function AuthenticatedSupabaseApp({
  onSignOut,
}: {
  onSignOut: () => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const identity = useQuery({
    queryKey: ['identity', 'session'],
    queryFn: () => lucidClient.identity.session.query(),
    retry: false,
  });
  const enroll = useMutation({
    mutationFn: (input: ParticipantOnboardingInput) => (
      lucidClient.identity.enroll.mutate(input)
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
    },
  });

  if (identity.isPending) {
    return <WorkspaceLoading />;
  }
  if (!identity.data) {
    return <ServiceUnavailable onRetry={() => identity.refetch()} />;
  }
  if (identity.data.status === 'onboarding-required') {
    return (
      <ParticipantOnboarding
        enrollmentAllowed={identity.data.enrollmentAllowed}
        onEnroll={async (input) => {
          await enroll.mutateAsync(input);
        }}
        onSignOut={onSignOut}
      />
    );
  }
  return <WorkspaceApp onSignOut={onSignOut} />;
}

function LegacyWorkspaceApp() {
  return <WorkspaceApp />;
}

function WorkspaceApp({ onSignOut }: { onSignOut?: () => Promise<void> }) {
  const discovery = useDiscoveryWorkspace();
  const snapshot = discovery.snapshot.data;

  if (isAuthenticationRequired(discovery.snapshot.error)) {
    return (
      <HostedAccess
        storedTokenRejected={hasHostedAccessToken()}
        onUnlock={async (token) => {
          setHostedAccessToken(token);
          const result = await discovery.snapshot.refetch();
          return Boolean(result.data)
            && !isAuthenticationRequired(result.error);
        }}
      />
    );
  }

  if (discovery.snapshot.isPending) {
    return <WorkspaceLoading />;
  }

  if (!snapshot) {
    return <ServiceUnavailable onRetry={() => discovery.snapshot.refetch()} />;
  }

  const backgroundChecks = snapshot.backgroundChecks;
  const representativeTask = backgroundChecks.tasks.find(
    ({ agentId }) => agentId === snapshot.representative.id,
  );
  const hasFailedWake = Boolean(
    snapshot.representative.status === 'error'
    || representativeTask?.status === 'failed',
  );
  const currentAssignmentSequence = snapshot.interest?.sequence;
  const currentFindings = currentAssignmentSequence
    ? snapshot.findings.filter(({ assignmentSequence }) => (
        assignmentSequence === currentAssignmentSequence
      ))
    : snapshot.findings;
  const earlierFindings = currentAssignmentSequence
    ? snapshot.findings.filter(({ assignmentSequence }) => (
        assignmentSequence !== currentAssignmentSequence
      ))
    : [];

  return (
    <div className="workspace-shell">
      <AppHeader snapshot={snapshot} onSignOut={onSignOut} />

      <main className="workspace">
        <section className="workspace-intro">
          <div>
            <p className="section-label">Your discovery workspace</p>
            <h1>Give your representative an ongoing assignment.</h1>
            <p>
              It keeps your interest, earlier findings, and guidance in view
              while listening for something genuinely new from the network.
            </p>
          </div>
          <dl className="workspace-stats">
            <div>
              <dt>Findings</dt>
              <dd>{currentFindings.length}</dd>
            </div>
            <div>
              <dt>Agent</dt>
              <dd>
                {hasFailedWake
                  ? 'Attention'
                  : backgroundChecks.running ? 'Working' : 'Ready'}
              </dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>{
                !backgroundChecks.dispatchEnabled
                  ? 'Demo paused'
                  : backgroundChecks.enabled ? 'Listening' : 'Paused'
              }</dd>
            </div>
          </dl>
        </section>

        <div className="workspace-layout">
          <div className="workspace-main">
            <InterestComposer
              interest={snapshot.interest}
              networkActivity={snapshot.networkActivity}
              backgroundChecksEnabled={
                backgroundChecks.enabled && backgroundChecks.dispatchEnabled
              }
              isChecking={backgroundChecks.running}
              isSaving={discovery.saveInterest.isPending}
              isRunningNow={discovery.runNow.isPending}
              isRetrying={discovery.retryCurrentWake.isPending}
              lastCheckedAt={backgroundChecks.lastRunAt}
              failedTask={hasFailedWake ? representativeTask : undefined}
              onSaveInterest={(content) => (
                discovery.saveInterest.mutateAsync(content)
              )}
              onRunNow={() => discovery.runNow.mutate()}
              onRetry={() => discovery.retryCurrentWake.mutate()}
            />

            <HostedConversation />

            <RecentNetworkRequests
              requests={snapshot.networkActivity?.previousRequests ?? []}
            />

            <RepresentativeProgress
              isSubmittingGuidance={discovery.submitGuidance.isPending}
              onGuidance={async (content) => {
                await discovery.submitGuidance.mutateAsync(content);
              }}
              workingNote={snapshot.workingNote}
            />

            <GuidanceFollowThrough
              activity={snapshot.guidanceFollowThrough}
            />

            <FindingsFeed
              backgroundChecksEnabled={
                backgroundChecks.enabled && backgroundChecks.dispatchEnabled
              }
              currentFindings={currentFindings}
              earlierFindings={earlierFindings}
              isChecking={backgroundChecks.running}
              isSubmittingFeedback={discovery.submitFeedback.isPending}
              requestProgress={snapshot.networkActivity?.requestProgress}
              onFeedback={(findingSequence, content) => (
                discovery.submitFeedback.mutateAsync({
                  findingSequence,
                  content,
                })
              )}
            />

            <BackgroundChecks
              checks={backgroundChecks}
              hasFailedWake={hasFailedWake}
              isUpdating={discovery.setBackgroundChecksEnabled.isPending}
              onSetEnabled={(enabled) => (
                discovery.setBackgroundChecksEnabled.mutate(enabled)
              )}
            />
          </div>

          <aside className="workspace-sidebar">
            <HowChecksWork />
            <ParticipantPerspective />
          </aside>
        </div>
      </main>

      <footer className="workspace-footer">
        <span>Lucid · Heddle {snapshot.runtime.heddleVersion}</span>
        <span>Your view · durable checks · inspectable delivery paths</span>
      </footer>
    </div>
  );
}

function ServiceUnavailable({ onRetry }: { onRetry: () => unknown }) {
  return (
    <main className="fatal-state">
      <CloudOff size={30} />
      <p className="section-label">Service unavailable</p>
      <h1>Lucid cannot reach the discovery service.</h1>
      <p>
        Try again shortly. Completed findings and Heddle conversations remain
        durable while the service recovers.
      </p>
      <Button onClick={() => void onRetry()} variant="secondary">
        <RefreshCw size={15} />
        Try again
      </Button>
    </main>
  );
}

function HowChecksWork() {
  return (
    <section className="sidebar-card">
      <header>
        <Clock3 size={17} />
        <h2>How checks work</h2>
      </header>
      <ol className="how-it-works">
        <li>
          <span>1</span>
          <p><strong>You save an interest.</strong> The full text stays private to your representative.</p>
        </li>
        <li>
          <span>2</span>
          <p><strong>Your agent wakes.</strong> It can share a request or react to newly delivered messages.</p>
        </li>
        <li>
          <span>3</span>
          <p><strong>You receive a finding.</strong> You see the messages that caused it and decide its value.</p>
        </li>
        <li>
          <span>4</span>
          <p><strong>Your guidance carries forward.</strong> Give feedback on a finding or directly correct its working understanding for later checks.</p>
        </li>
      </ol>
      <p className="prototype-note">
        Empty wakes do not call the model. Your representative acts only when
        it has unread input or another participant’s message.
      </p>
    </section>
  );
}

function ParticipantPerspective() {
  return (
    <section className="sidebar-card">
      <header>
        <Network size={17} />
        <h2>A participant’s view</h2>
      </header>
      <p className="prototype-note">
        There is no global participant directory here. Other representatives
        become visible only when their messages contribute to one of your
        findings.
      </p>
    </section>
  );
}

function WorkspaceLoading() {
  return (
    <main className="loading-state">
      <span className="loading-mark" aria-hidden="true">L</span>
      <p className="section-label">Opening workspace</p>
      <h1>Loading your saved interest and findings…</h1>
    </main>
  );
}

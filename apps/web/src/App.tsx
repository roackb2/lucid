import { CloudOff, RefreshCw } from 'lucide-react';
import { GoogleSignIn } from '@/components/lucid/google-sign-in';
import { HostedAccess } from '@/components/lucid/hosted-access';
import {
  UserOnboarding,
  type UserOnboardingInput,
} from '@/components/lucid/user-onboarding';
import { LucidAppShell } from '@/components/lucid/app-shell';
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
    mutationFn: (input: UserOnboardingInput) => (
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
      <UserOnboarding
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

  return (
    <LucidAppShell
      isSavingInterest={discovery.saveInterest.isPending}
      onSaveInterest={discovery.saveInterest.mutateAsync}
      onSignOut={onSignOut}
      snapshot={snapshot}
    />
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

function WorkspaceLoading() {
  return (
    <main className="loading-state">
      <span className="loading-mark" aria-hidden="true">L</span>
      <p className="section-label">Opening workspace</p>
      <h1>Loading your saved interest and findings…</h1>
    </main>
  );
}

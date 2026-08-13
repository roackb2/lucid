/**
 * Client synchronization boundary for the user-scoped workspace.
 * Mutations install the server's authoritative projection; this hook owns
 * polling and notifications, not optimistic domain state or network admin.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  lucidClient,
  isAuthenticationRequired,
  type DiscoverySnapshot,
} from '@/lib/trpc';

const SNAPSHOT_KEY = ['discovery', 'workspace'] as const;

export function useDiscoveryWorkspace() {
  const queryClient = useQueryClient();
  const snapshot = useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: () => lucidClient.discovery.snapshot.query(),
    // Poll quickly only while this user's agent is running.
    refetchInterval: (query) => (
      query.state.data?.backgroundChecks.running ? 700 : 4_000
    ),
    retry: (failureCount, error) => (
      !isAuthenticationRequired(error) && failureCount < 2
    ),
  });

  const installSnapshot = (nextSnapshot: DiscoverySnapshot) => {
    queryClient.setQueryData<DiscoverySnapshot>(SNAPSHOT_KEY, nextSnapshot);
  };

  const saveInterest = useMutation({
    mutationFn: (content: string) => (
      lucidClient.discovery.saveInterest.mutate({ content })
    ),
    onSuccess: (nextSnapshot) => {
      installSnapshot(nextSnapshot);
      toast.success(
        'Interest saved. Your agent is preparing a network request.',
      );
    },
    onError: notifyError,
  });

  const runNow = useMutation({
    mutationFn: () => lucidClient.discovery.runNow.mutate(),
    onSuccess: (nextSnapshot) => {
      installSnapshot(nextSnapshot);
      toast.message('A fresh check has been queued.');
    },
    onError: notifyError,
  });

  const retryCurrentWake = useMutation({
    mutationFn: () => lucidClient.discovery.retryCurrentWake.mutate(),
    onSuccess: (nextSnapshot) => {
      installSnapshot(nextSnapshot);
      toast.message('Your agent is retrying the current work.');
    },
    onError: notifyError,
  });

  const setBackgroundChecksEnabled = useMutation({
    mutationFn: (enabled: boolean) => (
      lucidClient.discovery.setBackgroundChecksEnabled.mutate({ enabled })
    ),
    onSuccess: (nextSnapshot) => {
      installSnapshot(nextSnapshot);
      toast.message(
        nextSnapshot.backgroundChecks.enabled
          ? 'Your agent resumed listening.'
          : 'Your agent paused.',
      );
    },
    onError: notifyError,
  });

  const submitFeedback = useMutation({
    mutationFn: (input: { findingSequence: number; content: string }) => (
      lucidClient.discovery.submitFeedback.mutate(input)
    ),
    onSuccess: (nextSnapshot) => {
      installSnapshot(nextSnapshot);
      toast.success('Feedback saved for your agent’s next wake.');
    },
    onError: notifyError,
  });

  const submitGuidance = useMutation({
    mutationFn: (content: string) => (
      lucidClient.discovery.submitGuidance.mutate({ content })
    ),
    onSuccess: (nextSnapshot) => {
      installSnapshot(nextSnapshot);
      toast.success(
        'Guidance saved. Your agent is revising its working direction.',
      );
    },
    onError: notifyError,
  });

  return {
    snapshot,
    saveInterest,
    runNow,
    retryCurrentWake,
    setBackgroundChecksEnabled,
    submitFeedback,
    submitGuidance,
  };
}

function notifyError(error: Error): void {
  toast.error(error.message || 'Lucid did not complete the request.');
}

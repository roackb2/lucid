/**
 * Client-side synchronization boundary for the discovery workspace snapshot.
 * Every mutation returns and installs the server's complete authoritative view;
 * this hook owns polling cadence and notifications, not optimistic domain state.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  lucidClient,
  type CreateAssistedParticipantInput,
  type DiscoverySnapshot,
} from '@/lib/trpc';

const SNAPSHOT_KEY = ['discovery', 'workspace'] as const;

export function useDiscoveryWorkspace() {
  const queryClient = useQueryClient();
  const snapshot = useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: () => lucidClient.discovery.snapshot.query(),
    // Poll quickly only while an agent is running so task completion becomes
    // visible without imposing the same request rate on an idle workspace.
    refetchInterval: (query) => (
      query.state.data?.backgroundChecks.running ? 700 : 4_000
    ),
    retry: 2,
  });

  const saveInterest = useMutation({
    mutationFn: (content: string) => (
      lucidClient.discovery.saveInterest.mutate({ content })
    ),
    onSuccess: (nextSnapshot) => {
      queryClient.setQueryData<DiscoverySnapshot>(
        SNAPSHOT_KEY,
        nextSnapshot,
      );
      toast.success('Interest saved. Lucid will check it in the background.');
    },
    onError: notifyError,
  });

  const runNow = useMutation({
    mutationFn: () => lucidClient.discovery.runNow.mutate(),
    onSuccess: (nextSnapshot) => {
      queryClient.setQueryData<DiscoverySnapshot>(
        SNAPSHOT_KEY,
        nextSnapshot,
      );
      toast.message('A fresh check has been queued.');
    },
    onError: notifyError,
  });

  const setBackgroundChecksEnabled = useMutation({
    mutationFn: (enabled: boolean) => (
      lucidClient.discovery.setBackgroundChecksEnabled.mutate({ enabled })
    ),
    onSuccess: (nextSnapshot) => {
      queryClient.setQueryData<DiscoverySnapshot>(
        SNAPSHOT_KEY,
        nextSnapshot,
      );
      toast.message(
        nextSnapshot.backgroundChecks.enabled
          ? 'Background checks resumed.'
          : 'Background checks paused.',
      );
    },
    onError: notifyError,
  });

  const submitFeedback = useMutation({
    mutationFn: (input: { findingSequence: number; content: string }) => (
      lucidClient.discovery.submitFeedback.mutate(input)
    ),
    onSuccess: (nextSnapshot) => {
      queryClient.setQueryData<DiscoverySnapshot>(
        SNAPSHOT_KEY,
        nextSnapshot,
      );
      toast.success('Feedback saved for Lucid’s next wake.');
    },
    onError: notifyError,
  });

  const createAssistedParticipant = useMutation({
    mutationFn: (input: CreateAssistedParticipantInput) => (
      lucidClient.discovery.createAssistedParticipant.mutate(input)
    ),
    onSuccess: (nextSnapshot) => {
      queryClient.setQueryData<DiscoverySnapshot>(SNAPSHOT_KEY, nextSnapshot);
      toast.success('Participant added. Their representative is now scheduled.');
    },
    onError: notifyError,
  });

  const setParticipantEnabled = useMutation({
    mutationFn: (input: { participantId: string; enabled: boolean }) => (
      lucidClient.discovery.setParticipantEnabled.mutate(input)
    ),
    onSuccess: (nextSnapshot, input) => {
      queryClient.setQueryData<DiscoverySnapshot>(SNAPSHOT_KEY, nextSnapshot);
      toast.message(
        input.enabled
          ? 'Participant resumed. Only new messages will be delivered.'
          : 'Participant paused. New messages will be skipped.',
      );
    },
    onError: notifyError,
  });

  const retireParticipant = useMutation({
    mutationFn: (participantId: string) => (
      lucidClient.discovery.retireParticipant.mutate({ participantId })
    ),
    onSuccess: (nextSnapshot) => {
      queryClient.setQueryData<DiscoverySnapshot>(SNAPSHOT_KEY, nextSnapshot);
      toast.success('Participant retired and private context removed.');
    },
    onError: notifyError,
  });

  const resetWorkspace = useMutation({
    mutationFn: () => lucidClient.discovery.resetWorkspace.mutate(),
    onSuccess: (nextSnapshot) => {
      queryClient.setQueryData<DiscoverySnapshot>(
        SNAPSHOT_KEY,
        nextSnapshot,
      );
      toast.success('Discovery workspace reset.');
    },
    onError: notifyError,
  });

  return {
    snapshot,
    saveInterest,
    runNow,
    setBackgroundChecksEnabled,
    createAssistedParticipant,
    setParticipantEnabled,
    retireParticipant,
    submitFeedback,
    resetWorkspace,
  };
}

function notifyError(error: Error): void {
  toast.error(error.message || 'Lucid did not complete the request.');
}

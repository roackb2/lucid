import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  lucidClient,
  type DiscoverySnapshot,
} from '@/lib/trpc';

const SNAPSHOT_KEY = ['discovery', 'workspace'] as const;

export function useDiscoveryWorkspace() {
  const queryClient = useQueryClient();
  const snapshot = useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: () => lucidClient.discovery.snapshot.query(),
    refetchInterval: (query) => (
      query.state.data?.activeRun ? 700 : 4_000
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
      toast.success('Lucid saved what to look for.');
    },
    onError: notifyError,
  });

  const startRun = useMutation({
    mutationFn: () => lucidClient.discovery.startRun.mutate(),
    onSuccess: async () => {
      toast.message('Discovery check started.');
      await queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
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
      toast.success('Feedback saved for the next check.');
    },
    onError: notifyError,
  });

  const cancelRun = useMutation({
    mutationFn: () => lucidClient.discovery.cancelRun.mutate(),
    onSuccess: async ({ cancelled }) => {
      if (cancelled) {
        toast.message('Stopping the discovery check.');
      }
      await queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
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
    startRun,
    submitFeedback,
    cancelRun,
    resetWorkspace,
  };
}

function notifyError(error: Error): void {
  toast.error(error.message || 'Lucid did not complete the request.');
}

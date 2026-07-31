import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { lucidClient, type LucidSnapshot } from '@/lib/trpc';

const SNAPSHOT_KEY = ['lucid', 'snapshot'] as const;

export function useLucid() {
  const queryClient = useQueryClient();
  const snapshot = useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: () => lucidClient.lucid.snapshot.query(),
    refetchInterval: (query) => query.state.data?.activeJourney ? 700 : 4_000,
    retry: 2,
  });

  const setIntent = useMutation({
    mutationFn: (content: string) => lucidClient.lucid.setIntent.mutate({ content }),
    onSuccess: (nextSnapshot) => {
      queryClient.setQueryData<LucidSnapshot>(SNAPSHOT_KEY, nextSnapshot);
      toast.success('Aster is carrying this intent privately.');
    },
    onError: notifyError,
  });

  const startJourney = useMutation({
    mutationFn: () => lucidClient.lucid.startJourney.mutate(),
    onSuccess: async () => {
      toast.message('Aster has entered the network.');
      await queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
    },
    onError: notifyError,
  });

  const feedback = useMutation({
    mutationFn: (input: { returnSequence: number; content: string }) => (
      lucidClient.lucid.feedback.mutate(input)
    ),
    onSuccess: (nextSnapshot) => {
      queryClient.setQueryData<LucidSnapshot>(SNAPSHOT_KEY, nextSnapshot);
      toast.success('Your correction will travel with Aster next time.');
    },
    onError: notifyError,
  });

  const cancel = useMutation({
    mutationFn: () => lucidClient.lucid.cancel.mutate(),
    onSuccess: async ({ cancelled }) => {
      if (cancelled) {
        toast.message('Aster is being called home.');
      }
      await queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
    },
    onError: notifyError,
  });

  const reset = useMutation({
    mutationFn: () => lucidClient.lucid.reset.mutate(),
    onSuccess: (nextSnapshot) => {
      queryClient.setQueryData<LucidSnapshot>(SNAPSHOT_KEY, nextSnapshot);
      toast.success('A clean First Return generation has begun.');
    },
    onError: notifyError,
  });

  return {
    snapshot,
    setIntent,
    startJourney,
    feedback,
    cancel,
    reset,
  };
}

function notifyError(error: Error): void {
  toast.error(error.message || 'Lucid did not complete the request.');
}

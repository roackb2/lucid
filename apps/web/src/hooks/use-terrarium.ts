import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { lucidClient, type TerrariumSnapshot } from '@/lib/trpc';

const SNAPSHOT_KEY = ['terrarium', 'snapshot'] as const;

export function useTerrarium() {
  const queryClient = useQueryClient();
  const snapshot = useQuery({
    queryKey: SNAPSHOT_KEY,
    queryFn: () => lucidClient.terrarium.snapshot.query(),
    refetchInterval: (query) => query.state.data?.activeCycle ? 700 : 4_000,
    retry: 2,
  });

  const seed = useMutation({
    mutationFn: (content: string) => lucidClient.terrarium.seed.mutate({ content }),
    onSuccess: (nextSnapshot) => {
      queryClient.setQueryData(SNAPSHOT_KEY, nextSnapshot);
      toast.success('The whisper entered the terrarium.');
    },
    onError: notifyError,
  });

  const advance = useMutation({
    mutationFn: (steps: number) => lucidClient.terrarium.advance.mutate({ steps }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
    },
    onError: notifyError,
  });

  const cancel = useMutation({
    mutationFn: () => lucidClient.terrarium.cancel.mutate(),
    onSuccess: async ({ cancelled }) => {
      if (cancelled) {
        toast.message('The current Dreamer is returning to rest.');
      }
      await queryClient.invalidateQueries({ queryKey: SNAPSHOT_KEY });
    },
    onError: notifyError,
  });

  const reset = useMutation({
    mutationFn: () => lucidClient.terrarium.reset.mutate(),
    onSuccess: (nextSnapshot) => {
      queryClient.setQueryData<TerrariumSnapshot>(SNAPSHOT_KEY, nextSnapshot);
      toast.success('A new terrarium generation has begun.');
    },
    onError: notifyError,
  });

  return {
    snapshot,
    seed,
    advance,
    cancel,
    reset,
  };
}

function notifyError(error: Error): void {
  toast.error(error.message || 'The terrarium did not respond.');
}

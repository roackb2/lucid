/** React Query boundary for Lucid's persisted Information Network reads. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InformationNetworkProfileDetail } from '@/lib/trpc';
import { isAuthenticationRequired, lucidClient } from '@/lib/trpc';

const informationNetworkQueryKeys = {
  feed: ['information-network', 'feed'] as const,
  post: (postId: string) => ['information-network', 'post', postId] as const,
  profile: (profileId: string) => (
    ['information-network', 'profile', profileId] as const
  ),
};

const retryNetworkRead = (failureCount: number, error: Error): boolean => (
  !isAuthenticationRequired(error) && failureCount < 2
);

export function useInformationNetworkFeed() {
  return useQuery({
    queryKey: informationNetworkQueryKeys.feed,
    queryFn: () => lucidClient.informationNetwork.feed.query(),
    retry: retryNetworkRead,
  });
}

export function useInformationNetworkPost(postId: string) {
  return useQuery({
    queryKey: informationNetworkQueryKeys.post(postId),
    queryFn: () => lucidClient.informationNetwork.post.query({ postId }),
    retry: retryNetworkRead,
  });
}

export function useInformationNetworkProfile(profileId: string) {
  return useQuery({
    queryKey: informationNetworkQueryKeys.profile(profileId),
    queryFn: () => lucidClient.informationNetwork.profile.query({ profileId }),
    refetchInterval: (query) => resolvePublishingJobRefreshInterval(
      query.state.data,
    ),
    retry: retryNetworkRead,
  });
}

/** Requests one durable publishing run and marks affected Network reads stale. */
export function useRequestPublishingJobRun(profileId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agentJobId: string) => (
      lucidClient.development.requestAgentJobRunOnce.mutate({ agentJobId })
    ),
    // A Coordinator trigger can fail after Lucid durably saves the request.
    // Refresh on both success and failure so the UI reveals that safe state.
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: informationNetworkQueryKeys.profile(profileId),
        }),
        queryClient.invalidateQueries({
          queryKey: informationNetworkQueryKeys.feed,
        }),
      ]);
    },
  });
}

export function resolvePublishingJobRefreshInterval(
  profile: InformationNetworkProfileDetail | null | undefined,
): number | false {
  const hasActiveRun = profile?.publishingJobs.some(({ latestRunRequest }) => (
    latestRunRequest?.state === 'requested'
    || latestRunRequest?.state === 'claimed'
  ));
  return hasActiveRun ? 700 : false;
}

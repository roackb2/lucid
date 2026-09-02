/** React Query boundary for Lucid's persisted Information Network reads. */
import { useQuery } from '@tanstack/react-query';
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
    retry: retryNetworkRead,
  });
}

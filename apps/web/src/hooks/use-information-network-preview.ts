import { useQuery } from '@tanstack/react-query';
import { previewInformationNetworkRepository } from '@/domains/information-network/preview-information-network-repository';

const informationNetworkPreviewQueryKeys = {
  feed: ['information-network', 'preview', 'feed'] as const,
  lab: ['information-network', 'preview', 'lab'] as const,
  post: (postId: string) => (
    ['information-network', 'preview', 'post', postId] as const
  ),
  profile: (profileId: string) => (
    ['information-network', 'preview', 'profile', profileId] as const
  ),
};

const deterministicPreviewQueryOptions = {
  gcTime: Infinity,
  retry: false,
  staleTime: Infinity,
};

export function useInformationNetworkFeedPreview() {
  return useQuery({
    ...deterministicPreviewQueryOptions,
    queryFn: previewInformationNetworkRepository.readNetworkFeed,
    queryKey: informationNetworkPreviewQueryKeys.feed,
  });
}

export function useInformationNetworkPostPreview(postId: string) {
  return useQuery({
    ...deterministicPreviewQueryOptions,
    queryFn: () => previewInformationNetworkRepository.readNetworkPost(postId),
    queryKey: informationNetworkPreviewQueryKeys.post(postId),
  });
}

export function useInformationNetworkProfilePreview(profileId: string) {
  return useQuery({
    ...deterministicPreviewQueryOptions,
    queryFn: () => (
      previewInformationNetworkRepository.readNetworkProfile(profileId)
    ),
    queryKey: informationNetworkPreviewQueryKeys.profile(profileId),
  });
}

export function useInformationNetworkLabPreview() {
  return useQuery({
    ...deterministicPreviewQueryOptions,
    queryFn: previewInformationNetworkRepository.readNetworkLab,
    queryKey: informationNetworkPreviewQueryKeys.lab,
  });
}

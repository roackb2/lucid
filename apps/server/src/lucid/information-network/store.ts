/** Read ports for Lucid's public-inside-the-network content. */
import type {
  FindingNetworkPostView,
  InformationNetworkFeedView,
  NetworkPostDetailView,
  NetworkProfileDetailView,
} from './types.js';

export interface FindingPostReader {
  readFindingPosts(
    userId: string,
    findingSequences: readonly number[],
  ): Promise<ReadonlyMap<number, FindingNetworkPostView[]>>;
}

export interface InformationNetworkStore extends FindingPostReader {
  readFeed(limit: number): Promise<InformationNetworkFeedView>;
  readPost(postId: string): Promise<NetworkPostDetailView | undefined>;
  readProfile(
    profileId: string,
    recentPostLimit: number,
  ): Promise<NetworkProfileDetailView | undefined>;
}

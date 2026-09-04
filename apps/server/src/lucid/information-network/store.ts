/** Persistence ports for Lucid's public-inside-the-network content. */
import type {
  FindingNetworkPostView,
  InformationNetworkFeedView,
  PublishAgentTextPostReceipt,
  SourceBackedTextPostDraft,
  NetworkPostDetailView,
  NetworkProfileDetailView,
} from './types.js';

/** Trusted execution identity; never accepted from model-controlled input. */
export type AgentTextPostPublicationClaim = {
  userId: string;
  executionId: string;
};

export class InformationNetworkPublicationClaimError extends Error {
  readonly name = 'InformationNetworkPublicationClaimError';

  constructor() {
    super('The active Lucid Agent execution does not own this publication.');
  }
}

export class InformationNetworkPublicationConflictError extends Error {
  readonly name = 'InformationNetworkPublicationConflictError';

  constructor() {
    super('This Agent wake already published a different Post.');
  }
}

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

/** Write port which owns fenced, retry-idempotent Agent publication. */
export interface InformationNetworkPublicationStore {
  publishAgentTextPost(
    claim: AgentTextPostPublicationClaim,
    draft: SourceBackedTextPostDraft,
  ): Promise<PublishAgentTextPostReceipt>;
}

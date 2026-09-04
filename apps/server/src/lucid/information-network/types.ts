import { z } from 'zod';
import type {
  AgentJobRunOutcome,
  AgentJobRunRequestState,
  AgentJobScheduleMode,
} from '../agent/jobs/types.js';

export const networkPostPublicationMethodSchema = z.enum([
  'seeded-pilot',
  'agent',
]);

export type NetworkPostPublicationMethod = z.infer<
  typeof networkPostPublicationMethodSchema
>;

export type NetworkPostSourceView = {
  id: string;
  title: string;
  sourceName: string;
  url: string;
  retrievedAt: string | null;
};

export type NetworkPostView = {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  publicationMethod: NetworkPostPublicationMethod;
  topics: string[];
  sources: NetworkPostSourceView[];
};

export type NetworkProfileSummaryView = {
  id: string;
  displayName: string;
  initials: string;
  publishingFocus: string;
  representativeAgentName: string;
};

export type NetworkProfileView = NetworkProfileSummaryView & {
  representativeAgentId: string;
  publicDescription: string;
  representativeAgentPurpose: string;
  topics: string[];
};

export type PublishingJobRunRequestView = {
  id: string;
  state: AgentJobRunRequestState;
  outcome?: AgentJobRunOutcome;
  publishedPostId?: string;
  outcomeSummary?: string;
  requestedAt: string;
  claimedAt?: string;
  settledAt?: string;
};

/** Owner-approved publishing preferences that are safe to show on a Profile. */
export type PublishingPreferencesView = {
  topics: string[];
  region?: string;
  intendedAudience?: string;
  tone?: string;
  updatedAt: string;
};

/** Safe Profile projection; private instructions and execution fences stay server-side. */
export type PublishingJobView = {
  id: string;
  name: string;
  enabled: boolean;
  scheduleMode: AgentJobScheduleMode;
  cadenceMs: number;
  publishingPreferences: PublishingPreferencesView;
  latestRunRequest?: PublishingJobRunRequestView;
};

export type NetworkFeedEntryView = {
  post: NetworkPostView;
  author: NetworkProfileSummaryView;
};

export type InformationNetworkFeedView = {
  entries: NetworkFeedEntryView[];
  postCount: number;
  profileCount: number;
};

export type NetworkPostDetailView = {
  post: NetworkPostView;
  author: NetworkProfileSummaryView;
};

export type NetworkProfileContentView = {
  profile: NetworkProfileView;
  recentPosts: NetworkPostView[];
};

export type NetworkProfileDetailView = NetworkProfileContentView & {
  publishingJobs: PublishingJobView[];
};

/** Minimal user-scoped reference rendered as a Finding-to-Post link. */
export type FindingNetworkPostView = {
  id: string;
  title: string;
  publishedAt: string;
  publicationMethod: NetworkPostPublicationMethod;
  author: Pick<NetworkProfileSummaryView, 'id' | 'displayName'>;
};

export type TextPostSourceDraft = {
  title: string;
  sourceName: string;
  url: string;
};

/** Agent-authored text prepared from at least one visible external source. */
export type SourceBackedTextPostDraft = {
  title: string;
  body: string;
  topics: string[];
  sources: TextPostSourceDraft[];
};

export type PublishAgentTextPostReceipt = {
  outcome: 'published' | 'already-published';
  postId: string;
  publishedAt: string;
};

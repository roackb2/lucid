import { z } from 'zod';

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
  publicDescription: string;
  representativeAgentPurpose: string;
  topics: string[];
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

export type NetworkProfileDetailView = {
  profile: NetworkProfileView;
  recentPosts: NetworkPostView[];
};

/** Minimal user-scoped reference rendered as a Finding-to-Post link. */
export type FindingNetworkPostView = {
  id: string;
  title: string;
  publishedAt: string;
  publicationMethod: NetworkPostPublicationMethod;
  author: Pick<NetworkProfileSummaryView, 'id' | 'displayName'>;
};

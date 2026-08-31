export type NetworkPostSourcePreview = {
  id: string;
  title: string;
  sourceName: string;
  url: string;
};

export type NetworkPostInterestMatchPreview = {
  kind: 'strong' | 'possible' | 'outside-current-interest';
  label: string;
};

export type NetworkPostPreview = {
  id: string;
  authorProfileId: string;
  title: string;
  body: string;
  publishedAt: string;
  topics: readonly string[];
  sources: readonly NetworkPostSourcePreview[];
  interestMatch: NetworkPostInterestMatchPreview;
};

export type NetworkProfileSummaryPreview = {
  id: string;
  displayName: string;
  initials: string;
  publishingFocus: string;
  representativeAgentName: string;
};

export type AgentCapabilityPreview = {
  id: string;
  name: string;
  purpose: string;
  availability: 'allowed' | 'unavailable';
};

export type PublishingPreferencesPreview = {
  topics: readonly string[];
  regions: readonly string[];
  intendedAudience: string;
  tone: string;
  sourceExpectations: string;
};

export type PublishingJobPreview = {
  id: string;
  name: string;
  status: 'running' | 'paused';
  cadenceLabel: string;
  publishedPostCount: number;
  publishingPreferences: PublishingPreferencesPreview;
  capabilities: readonly AgentCapabilityPreview[];
};

export type NetworkProfilePreview = NetworkProfileSummaryPreview & {
  publicDescription: string;
  representativeAgentPurpose: string;
  topics: readonly string[];
  publishingJob: PublishingJobPreview;
};

export type NetworkFeedEntryPreview = {
  post: NetworkPostPreview;
  author: NetworkProfileSummaryPreview;
};

export type NetworkFeedPreview = {
  entries: readonly NetworkFeedEntryPreview[];
  possibleFindingCount: number;
  consumerActivity: readonly {
    id: string;
    title: string;
    detail: string;
  }[];
};

export type NetworkPostDetailPreview = {
  post: NetworkPostPreview;
  author: NetworkProfileSummaryPreview;
};

export type NetworkProfileDetailPreview = {
  profile: NetworkProfilePreview;
  recentPosts: readonly NetworkPostPreview[];
};

export type NetworkLabPreview = {
  backgroundWorkStatus: 'running' | 'paused';
  consumerCadenceLabel: string;
  publisherDailyPostLimit: number;
  publisherProfiles: readonly NetworkProfilePreview[];
};

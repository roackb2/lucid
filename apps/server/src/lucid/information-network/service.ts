/** Authenticated, read-only application boundary for network content. */
import type { InformationNetworkStore } from './store.js';
import type { AgentJobService } from '../agent/jobs/service.js';
import type {
  AgentJob,
  AgentJobPublishingPreferences,
  AgentJobRunRequest,
} from '../agent/jobs/types.js';
import type {
  InformationNetworkFeedView,
  NetworkPostDetailView,
  NetworkProfileDetailView,
  PublishingPreferencesView,
  PublishingJobRunRequestView,
  PublishingJobView,
} from './types.js';

const NETWORK_FEED_LIMIT = 50;
const PROFILE_RECENT_POST_LIMIT = 12;

export class InformationNetworkInputError extends Error {}

export class InformationNetworkService {
  constructor(
    private readonly store: InformationNetworkStore,
    private readonly agentJobs: Pick<
      AgentJobService,
      'listAgentJobs' | 'readLatestRunRequest'
    >,
  ) {}

  async feed(): Promise<InformationNetworkFeedView> {
    return await this.store.readFeed(NETWORK_FEED_LIMIT);
  }

  async post(postId: string): Promise<NetworkPostDetailView | null> {
    return await this.store.readPost(normalizeRouteId(postId, 'Post ID'))
      ?? null;
  }

  async profile(profileId: string): Promise<NetworkProfileDetailView | null> {
    const detail = await this.store.readProfile(
      normalizeRouteId(profileId, 'Profile ID'),
      PROFILE_RECENT_POST_LIMIT,
    );
    if (!detail) {
      return detail ?? null;
    }
    const publishingJobs = (await this.agentJobs.listAgentJobs()).filter(
      (job) => (
        job.agentId === detail.profile.representativeAgentId
        && job.kind === 'information-network-publishing'
      ),
    );
    return {
      ...detail,
      publishingJobs: await Promise.all(publishingJobs.map(async (job) => (
        toPublishingJobView(
          job,
          await this.agentJobs.readLatestRunRequest(job.id),
        )
      ))),
    };
  }
}

function toPublishingJobView(
  job: AgentJob,
  latestRunRequest: AgentJobRunRequest | undefined,
): PublishingJobView {
  return {
    id: job.id,
    name: job.name,
    enabled: job.enabled,
    scheduleMode: job.scheduleMode,
    cadenceMs: job.cadenceMs,
    publishingPreferences: toPublishingPreferencesView(
      requirePublishingPreferences(job),
    ),
    latestRunRequest: latestRunRequest
      ? toPublishingJobRunRequestView(latestRunRequest)
      : undefined,
  };
}

function toPublishingPreferencesView(
  preferences: AgentJobPublishingPreferences,
): PublishingPreferencesView {
  return {
    topics: preferences.topics,
    region: preferences.region,
    intendedAudience: preferences.intendedAudience,
    tone: preferences.tone,
    updatedAt: preferences.updatedAt,
  };
}

function requirePublishingPreferences(
  job: AgentJob,
): AgentJobPublishingPreferences {
  if (!job.publishingPreferences) {
    throw new Error(`Publishing preferences are missing for Agent job: ${job.id}`);
  }
  return job.publishingPreferences;
}

function toPublishingJobRunRequestView(
  request: AgentJobRunRequest,
): PublishingJobRunRequestView {
  return {
    id: request.id,
    state: request.state,
    outcome: request.outcome,
    publishedPostId: request.publishedPostId,
    outcomeSummary: request.outcomeSummary,
    requestedAt: request.requestedAt,
    claimedAt: request.claimedAt,
    settledAt: request.settledAt,
  };
}

function normalizeRouteId(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/.test(normalized)) {
    throw new InformationNetworkInputError(
      `${label} must contain 1 to 160 letters, numbers, dots, colons, underscores, or hyphens.`,
    );
  }
  return normalized;
}

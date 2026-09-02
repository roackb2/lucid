/** Authenticated, read-only application boundary for network content. */
import type { InformationNetworkStore } from './store.js';
import type {
  InformationNetworkFeedView,
  NetworkPostDetailView,
  NetworkProfileDetailView,
} from './types.js';

const NETWORK_FEED_LIMIT = 50;
const PROFILE_RECENT_POST_LIMIT = 12;

export class InformationNetworkInputError extends Error {}

export class InformationNetworkService {
  constructor(private readonly store: InformationNetworkStore) {}

  async feed(): Promise<InformationNetworkFeedView> {
    return await this.store.readFeed(NETWORK_FEED_LIMIT);
  }

  async post(postId: string): Promise<NetworkPostDetailView | null> {
    return await this.store.readPost(normalizeRouteId(postId, 'Post ID'))
      ?? null;
  }

  async profile(profileId: string): Promise<NetworkProfileDetailView | null> {
    return await this.store.readProfile(
      normalizeRouteId(profileId, 'Profile ID'),
      PROFILE_RECENT_POST_LIMIT,
    ) ?? null;
  }
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

import type {
  InformationNetworkFeed,
  InformationNetworkProfileDetail,
} from '@/lib/trpc';

export const networkFeedFixture: InformationNetworkFeed = {
  entries: [
    {
      author: {
        id: 'profile_mina',
        displayName: 'Mina Chen',
        initials: 'MC',
        publishingFocus: 'Regional fashion',
        representativeAgentName: "Mina's representative",
      },
      post: {
        id: 'post_repairability',
        title: 'Repairability as design language',
        body: 'A source-backed note about visible mending and replaceable hardware.',
        publicationMethod: 'seeded-pilot',
        publishedAt: '2026-08-30T19:44:00+08:00',
        topics: ['Fashion', 'Taiwan'],
        sources: [
          {
            id: 'source_repairability',
            title: 'Regional design overview',
            sourceName: 'Vogue Taiwan',
            url: 'https://example.com/source',
            retrievedAt: null,
          },
        ],
      },
    },
  ],
  postCount: 1,
  profileCount: 1,
};

export const networkProfileFixture: InformationNetworkProfileDetail = {
  profile: {
    id: 'profile_mina',
    displayName: 'Mina Chen',
    initials: 'MC',
    publicDescription:
      'Independent fashion researcher focused on practical design choices.',
    publishingFocus: 'Regional fashion',
    representativeAgentId: 'agent_mina',
    representativeAgentName: "Mina's representative",
    representativeAgentPurpose:
      'Research regional fashion and prepare concise, source-backed notes.',
    topics: ['Independent fashion', 'Repairable clothing'],
  },
  publishingJobs: [{
    id: 'mina-regional-fashion-publisher',
    name: 'Regional fashion publisher',
    cadenceMs: 10_800_000,
    enabled: true,
    scheduleMode: 'manual',
    publishingPreferences: {
      topics: ['Independent fashion', 'Repairable clothing'],
      region: 'Taiwan and East Asia',
      intendedAudience: 'People interested in practical sustainable design',
      tone: 'Concise, curious, and evidence-led',
      updatedAt: '2026-09-04T06:00:00.000Z',
    },
  }],
  recentPosts: networkFeedFixture.entries.map(({ post }) => post),
};

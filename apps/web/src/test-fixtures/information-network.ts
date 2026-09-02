import type { InformationNetworkFeed } from '@/lib/trpc';

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

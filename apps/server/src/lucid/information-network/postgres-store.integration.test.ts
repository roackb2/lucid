/** Real-PostgreSQL contract for the first read-only Information Network. */
import dayjs from 'dayjs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import { LOCAL_AGENT_ID, LOCAL_USER_ID } from '../local-user.js';
import {
  postgresDiscoveryEvents as discoveryEvents,
  postgresFindingPosts as findingPosts,
  postgresNetworkPostSources as postSources,
  postgresNetworkPostTopics as postTopics,
  postgresNetworkPosts as posts,
  postgresNetworkProfileTopics as profileTopics,
  postgresNetworkProfiles as profiles,
} from '../persistence/postgres/schema.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../persistence/postgres/test-context.js';
import { LUCID_WORKSPACE_ID } from '../workspace/workspace-identity.js';

const TEST_PROFILE_ID = 'test-network-profile';
const TEST_POST_ID = 'test-network-post';
const TEST_PUBLISHED_AT = '2026-08-30T11:44:00.000Z';

describe('PostgreSQL Information Network store', () => {
  let database: PostgresDatabase;
  let stores: PostgresTestStores['stores'];
  let findingSequence: number;

  beforeAll(async () => {
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-information-network-test',
      reset: false,
    }));
  });

  beforeEach(async () => {
    await stores.agent.reset({ backgroundChecksEnabled: false });
    findingSequence = await insertReadModelScenario(database);
  });

  afterAll(async () => database.close());

  it('reads normalized feed aggregates without private user data', async () => {
    const feed = await stores.informationNetwork.readFeed(50);

    expect(feed).toMatchObject({ postCount: 1, profileCount: 1 });
    expect(feed.entries).toEqual([{
      author: {
        id: TEST_PROFILE_ID,
        displayName: 'You',
        initials: 'YO',
        publishingFocus: 'Durable software',
        representativeAgentName: 'Lucid',
      },
      post: {
        id: TEST_POST_ID,
        title: 'A durable read-model boundary',
        body: 'Product records stay separate from reusable runtime state.',
        publishedAt: expect.any(String),
        publicationMethod: 'seeded-pilot',
        topics: ['Architecture', 'Persistence'],
        sources: [{
          id: 'test-network-source',
          title: 'Persistence boundary notes',
          sourceName: 'Lucid engineering notes',
          url: 'https://example.com/lucid/read-model-boundary',
          retrievedAt: expect.any(String),
        }],
      },
    }]);
    expect(dayjs(feed.entries[0]!.post.publishedAt).toISOString())
      .toBe(TEST_PUBLISHED_AT);
    expect(dayjs(feed.entries[0]!.post.sources[0]!.retrievedAt).toISOString())
      .toBe('2026-08-30T10:00:00.000Z');
    expect(JSON.stringify(feed)).not.toContain('privateContext');
    expect(JSON.stringify(feed)).not.toContain('registrationKey');
  });

  it('reads Post and Profile detail and returns undefined for unknown IDs', async () => {
    await expect(stores.informationNetwork.readPost(TEST_POST_ID))
      .resolves.toMatchObject({
        post: { id: TEST_POST_ID, topics: ['Architecture', 'Persistence'] },
        author: { id: TEST_PROFILE_ID, displayName: 'You' },
      });
    await expect(stores.informationNetwork.readProfile(TEST_PROFILE_ID, 12))
      .resolves.toMatchObject({
        profile: {
          id: TEST_PROFILE_ID,
          displayName: 'You',
          publicDescription: 'Public test profile.',
          representativeAgentPurpose: expect.any(String),
          topics: ['Distributed systems'],
        },
        recentPosts: [{ id: TEST_POST_ID }],
      });
    await expect(stores.informationNetwork.readPost('missing'))
      .resolves.toBeUndefined();
    await expect(stores.informationNetwork.readProfile('missing', 12))
      .resolves.toBeUndefined();
  });

  it('searches title, body, and topics with a bounded newest-first result', async () => {
    await database.orm.insert(posts).values({
      id: 'newer-durable-post',
      workspaceId: LUCID_WORKSPACE_ID,
      authorProfileId: TEST_PROFILE_ID,
      publicationMethod: 'seeded-pilot',
      title: 'A newer durable Agent note',
      body: 'A compact second result used to prove ordering and limits.',
      publishedAt: '2026-08-31T00:00:00.000Z',
      createdAt: '2026-08-31T00:00:00.000Z',
      idempotencyKey: 'test:newer-durable-post',
    });

    await expect(stores.informationNetwork.searchPosts('DURABLE', 1))
      .resolves.toEqual([expect.objectContaining({
        postId: 'newer-durable-post',
        title: 'A newer durable Agent note',
        author: { id: TEST_PROFILE_ID, displayName: 'You' },
      })]);
    await expect(stores.informationNetwork.searchPosts('reusable runtime', 10))
      .resolves.toEqual([expect.objectContaining({ postId: TEST_POST_ID })]);
    await expect(stores.informationNetwork.searchPosts('ARCHITECTURE', 10))
      .resolves.toEqual([expect.objectContaining({
        postId: TEST_POST_ID,
        topics: ['Architecture', 'Persistence'],
      })]);
    await expect(stores.informationNetwork.searchPosts('%', 10))
      .resolves.toEqual([]);
  });

  it('permits a general Post with zero Sources without fabricating provenance', async () => {
    await database.orm.insert(posts).values({
      id: 'source-free-general-post',
      workspaceId: LUCID_WORKSPACE_ID,
      authorProfileId: TEST_PROFILE_ID,
      publicationMethod: 'seeded-pilot',
      title: 'A source-free product record',
      body: 'The general Post relation permits zero Sources.',
      publishedAt: '2026-08-31T00:00:00.000Z',
      createdAt: '2026-08-31T00:00:00.000Z',
      idempotencyKey: 'test:source-free-general-post',
    });

    await expect(stores.informationNetwork.readPost(
      'source-free-general-post',
    )).resolves.toMatchObject({
      post: { topics: [], sources: [] },
    });
  });

  it('returns Finding Post links only for the addressed user and known Finding', async () => {
    const findingPostMap = await stores.informationNetwork.readFindingPosts(
      LOCAL_USER_ID,
      [findingSequence, 999_999],
    );

    expect(findingPostMap.get(findingSequence)).toEqual([{
      id: TEST_POST_ID,
      title: 'A durable read-model boundary',
      publishedAt: expect.any(String),
      publicationMethod: 'seeded-pilot',
      author: { id: TEST_PROFILE_ID, displayName: 'You' },
    }]);
    expect(dayjs(findingPostMap.get(findingSequence)![0]!.publishedAt)
      .toISOString()).toBe(TEST_PUBLISHED_AT);
    expect(findingPostMap.has(999_999)).toBe(false);
    await expect(stores.informationNetwork.readFindingPosts(
      'another-user',
      [findingSequence],
    )).resolves.toEqual(new Map());
  });

  it('rejects Agent publication provenance without both owning identifiers', async () => {
    await expect(database.orm.insert(posts).values({
      id: 'invalid-agent-publication',
      workspaceId: LUCID_WORKSPACE_ID,
      authorProfileId: TEST_PROFILE_ID,
      authorAgentId: LOCAL_AGENT_ID,
      publicationMethod: 'agent',
      title: 'Invalid Agent publication',
      body: 'The database must reject missing execution provenance.',
      publishedAt: '2026-08-31T00:00:00.000Z',
      createdAt: '2026-08-31T00:00:00.000Z',
      idempotencyKey: 'test:invalid-agent-publication',
    })).rejects.toThrow();
  });
});

async function insertReadModelScenario(
  database: PostgresDatabase,
): Promise<number> {
  await database.orm.insert(profiles).values({
    id: TEST_PROFILE_ID,
    workspaceId: LUCID_WORKSPACE_ID,
    userId: LOCAL_USER_ID,
    publicDescription: 'Public test profile.',
    publishingFocus: 'Durable software',
    createdAt: '2026-08-30T00:00:00.000Z',
    updatedAt: '2026-08-30T00:00:00.000Z',
  });
  await database.orm.insert(profileTopics).values({
    profileId: TEST_PROFILE_ID,
    position: 0,
    topic: 'Distributed systems',
  });
  await database.orm.insert(posts).values({
    id: TEST_POST_ID,
    workspaceId: LUCID_WORKSPACE_ID,
    authorProfileId: TEST_PROFILE_ID,
    publicationMethod: 'seeded-pilot',
    title: 'A durable read-model boundary',
    body: 'Product records stay separate from reusable runtime state.',
    publishedAt: TEST_PUBLISHED_AT,
    createdAt: TEST_PUBLISHED_AT,
    idempotencyKey: 'test:network-post',
  });
  await database.orm.insert(postTopics).values([
    { postId: TEST_POST_ID, position: 0, topic: 'Architecture' },
    { postId: TEST_POST_ID, position: 1, topic: 'Persistence' },
  ]);
  await database.orm.insert(postSources).values({
    id: 'test-network-source',
    postId: TEST_POST_ID,
    position: 0,
    title: 'Persistence boundary notes',
    sourceName: 'Lucid engineering notes',
    url: 'https://example.com/lucid/read-model-boundary',
    retrievedAt: '2026-08-30T10:00:00.000Z',
  });
  const [finding] = await database.orm.insert(discoveryEvents).values({
    id: 'test-network-finding',
    workspaceId: LUCID_WORKSPACE_ID,
    wakeNumber: 0,
    kind: 'finding_reported',
    actorAgentId: LOCAL_AGENT_ID,
    targetUserId: LOCAL_USER_ID,
    idempotencyKey: 'test:network-finding',
    title: 'A linked Post',
    content: 'This Finding points back to a public Post.',
    metadata: { sourceEventIds: [], visibility: 'user-and-agent' },
    createdAt: '2026-08-30T12:00:00.000Z',
  }).returning({ sequence: discoveryEvents.sequence });
  if (!finding) {
    throw new Error('Test Finding was not inserted.');
  }
  await database.orm.insert(findingPosts).values({
    findingSequence: finding.sequence,
    postId: TEST_POST_ID,
    position: 0,
  });
  return finding.sequence;
}

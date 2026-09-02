/** Real-PostgreSQL contract for the first read-only information Network. */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import { LOCAL_USER_ID } from '../local-user.js';
import { LUCID_WORKSPACE_ID } from '../workspace/workspace-identity.js';
import {
  postgresNetworkPosts as posts,
  postgresNetworkProfiles as profiles,
} from '../persistence/postgres/schema.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../persistence/postgres/test-context.js';
import { PostgresInformationNetworkFixtureSeeder } from './fixtures.js';

describe('PostgreSQL information Network store', () => {
  let database: PostgresDatabase;
  let stores: PostgresTestStores['stores'];

  beforeAll(async () => {
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-information-network-test',
      reset: false,
    }));
  });

  beforeEach(async () => {
    await stores.agent.reset({ backgroundChecksEnabled: false });
  });

  afterAll(async () => database.close());

  it('installs one concurrent-safe deterministic fixture and reads normalized aggregates', async () => {
    const seeder = new PostgresInformationNetworkFixtureSeeder(database);
    const [firstReceipt, retryReceipt] = await Promise.all([
      seeder.seed(),
      seeder.seed(),
    ]);
    const [firstFeed, retryFeed] = await Promise.all([
      stores.informationNetwork.readFeed(50),
      stores.informationNetwork.readFeed(50),
    ]);

    expect(retryReceipt).toEqual(firstReceipt);
    expect(firstReceipt).toMatchObject({
      fixtureSetId: 'post-01-seeded-pilot-v1',
      profileCount: 3,
      postCount: 3,
      sourceCount: 7,
      findingSequence: expect.any(Number),
    });
    expect(retryFeed).toEqual(firstFeed);
    expect(firstFeed).toMatchObject({ postCount: 3, profileCount: 3 });
    expect(firstFeed.entries.map(({ post }) => post.id)).toEqual([
      'repairability-as-design-language',
      'fingerstyle-room-sound',
      'municipal-ai-rules',
    ]);
    expect(firstFeed.entries[0]).toMatchObject({
      author: {
        id: 'mina-chen',
        displayName: 'Mina Chen',
        initials: 'MC',
        publishingFocus: 'Regional fashion',
        representativeAgentName: "Mina's representative",
      },
      post: {
        publicationMethod: 'seeded-pilot',
        topics: ['Fashion', 'Taiwan', 'Sustainable design'],
        sources: [
          { id: 'repair-source-vogue', sourceName: 'Vogue Taiwan' },
          { id: 'repair-source-interview', sourceName: 'Studio interview' },
          { id: 'repair-source-journal', sourceName: 'Brand journal' },
        ],
      },
    });
    expect(JSON.stringify(firstFeed)).not.toContain('privateContext');
    expect(JSON.stringify(firstFeed)).not.toContain('registrationKey');
  });

  it('reads Post and Profile detail and returns undefined for unknown identities', async () => {
    await new PostgresInformationNetworkFixtureSeeder(database).seed();

    await expect(stores.informationNetwork.readPost(
      'fingerstyle-room-sound',
    )).resolves.toMatchObject({
      post: {
        id: 'fingerstyle-room-sound',
        publicationMethod: 'seeded-pilot',
        topics: ['Fingerstyle', 'Independent music'],
      },
      author: { id: 'ari-rivera', displayName: 'Ari Rivera' },
    });
    await expect(stores.informationNetwork.readProfile(
      'mina-chen',
      12,
    )).resolves.toMatchObject({
      profile: {
        id: 'mina-chen',
        displayName: 'Mina Chen',
        publicDescription: expect.stringContaining('repair culture'),
        representativeAgentPurpose: expect.stringContaining(
          'source-backed notes',
        ),
        topics: [
          'Independent fashion',
          'Repairable clothing',
          'Textiles',
        ],
      },
      recentPosts: [{ id: 'repairability-as-design-language' }],
    });
    await expect(stores.informationNetwork.readPost('missing'))
      .resolves.toBeUndefined();
    await expect(stores.informationNetwork.readProfile('missing', 12))
      .resolves.toBeUndefined();
  });

  it('permits a general Post with zero Sources without fabricating provenance', async () => {
    await new PostgresInformationNetworkFixtureSeeder(database).seed();
    await database.orm.insert(posts).values({
      id: 'source-free-general-post',
      workspaceId: LUCID_WORKSPACE_ID,
      authorProfileId: 'mina-chen',
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
    const receipt = await new PostgresInformationNetworkFixtureSeeder(database)
      .seed();
    const findingPosts = await stores.informationNetwork.readFindingPosts(
      LOCAL_USER_ID,
      [receipt.findingSequence, 999_999],
    );

    expect(findingPosts.get(receipt.findingSequence)).toEqual([{
      id: 'repairability-as-design-language',
      title: 'Taipei labels are making repairability part of the silhouette',
      publishedAt: expect.any(String),
      publicationMethod: 'seeded-pilot',
      author: { id: 'mina-chen', displayName: 'Mina Chen' },
    }]);
    expect(findingPosts.has(999_999)).toBe(false);
    await expect(stores.informationNetwork.readFindingPosts(
      'another-user',
      [receipt.findingSequence],
    )).resolves.toEqual(new Map());
  });

  it('fails rather than silently overwriting a conflicting fixture identity', async () => {
    await new PostgresInformationNetworkFixtureSeeder(database).seed();
    await database.orm
      .update(profiles)
      .set({ publishingFocus: 'Conflicting changed focus' })
      .where(eq(profiles.id, 'mina-chen'));

    await expect(new PostgresInformationNetworkFixtureSeeder(database).seed())
      .rejects.toThrow('Profiles conflict with deterministic Network fixture');
  });

  it('rejects Agent publication provenance without both owning identifiers', async () => {
    await new PostgresInformationNetworkFixtureSeeder(database).seed();

    await expect(database.orm.insert(posts).values({
      id: 'invalid-agent-publication',
      workspaceId: LUCID_WORKSPACE_ID,
      authorProfileId: 'mina-chen',
      publicationMethod: 'agent',
      title: 'Invalid Agent publication',
      body: 'The database must reject missing execution provenance.',
      publishedAt: '2026-08-31T00:00:00.000Z',
      createdAt: '2026-08-31T00:00:00.000Z',
      idempotencyKey: 'test:invalid-agent-publication',
    })).rejects.toThrow();
  });
});

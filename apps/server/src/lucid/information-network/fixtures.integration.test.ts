import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import { LOCAL_USER_ID } from '../local-user.js';
import { postgresNetworkProfiles as profiles } from '../persistence/postgres/schema.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../persistence/postgres/test-context.js';
import { PostgresInformationNetworkFixtureSeeder } from './fixtures.js';

describe('POST-01 Information Network pilot fixture', () => {
  let database: PostgresDatabase;
  let stores: PostgresTestStores['stores'];

  beforeAll(async () => {
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-information-network-fixture-test',
      reset: false,
    }));
  });

  beforeEach(async () => {
    await stores.agent.reset({ backgroundChecksEnabled: false });
  });

  afterAll(async () => database.close());

  it('installs one concurrent-safe fixture and exposes its Finding link', async () => {
    const seeder = new PostgresInformationNetworkFixtureSeeder(database);
    const [firstReceipt, retryReceipt] = await Promise.all([
      seeder.seed(),
      seeder.seed(),
    ]);
    const [firstFeed, retryFeed] = await Promise.all([
      stores.informationNetwork.readFeed(50),
      stores.informationNetwork.readFeed(50),
    ]);
    const findingPostMap = await stores.informationNetwork.readFindingPosts(
      LOCAL_USER_ID,
      [firstReceipt.findingSequence],
    );

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
    expect(findingPostMap.get(firstReceipt.findingSequence)).toEqual([{
      id: 'repairability-as-design-language',
      title: 'Taipei labels are making repairability part of the silhouette',
      publishedAt: expect.any(String),
      publicationMethod: 'seeded-pilot',
      author: { id: 'mina-chen', displayName: 'Mina Chen' },
    }]);
    expect(JSON.stringify(firstFeed)).not.toContain('privateContext');
    expect(JSON.stringify(firstFeed)).not.toContain('registrationKey');
  });

  it('fails instead of overwriting a conflicting stable fixture identity', async () => {
    await new PostgresInformationNetworkFixtureSeeder(database).seed();
    await database.orm
      .update(profiles)
      .set({ publishingFocus: 'Conflicting changed focus' })
      .where(eq(profiles.id, 'mina-chen'));

    await expect(new PostgresInformationNetworkFixtureSeeder(database).seed())
      .rejects.toThrow('Profiles conflict with deterministic Network fixture');
  });
});

import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import { AgentJobService } from '../agent/jobs/service.js';
import {
  postgresAgentJobs as agentJobs,
} from '../persistence/postgres/schema.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../persistence/postgres/test-context.js';
import { PostgresInformationNetworkFixtureSeeder } from './fixtures.js';
import { PostgresInformationPublisherPilotInstaller } from './publisher-pilot.js';

describe('Publisher-01 local pilot installer', () => {
  let database: PostgresDatabase;
  let stores: PostgresTestStores['stores'];

  beforeAll(async () => {
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-information-publisher-pilot-test',
      reset: false,
    }));
  });

  beforeEach(async () => {
    await stores.agent.reset({ backgroundChecksEnabled: false });
    await new PostgresInformationNetworkFixtureSeeder(database).seed();
  });

  afterAll(async () => database.close());

  it('activates exactly Mina and installs one retry-safe manual job', async () => {
    const installer = new PostgresInformationPublisherPilotInstaller(database);
    const [first, repeated] = await Promise.all([
      installer.install(),
      installer.install(),
    ]);
    const users = await stores.agent.listUsers();
    const job = await new AgentJobService(stores.agentJobs).readAgentJob(
      first.agentJobId,
    );

    expect(repeated).toEqual(first);
    expect(first).toEqual({
      pilotId: 'publisher-01-mina-regional-fashion',
      profileId: 'mina-chen',
      agentJobId: 'publisher-01-mina-regional-fashion',
      scheduleMode: 'manual',
      cadenceMs: 10_800_000,
    });
    expect(users.filter(({ status }) => status === 'active')
      .map(({ id }) => id).sort())
      .toEqual(['fixture-user-mina-chen', 'local-user']);
    expect(job).toMatchObject({
      id: 'publisher-01-mina-regional-fashion',
      agentId: 'fixture-agent-mina-chen',
      kind: 'information-network-publishing',
      enabled: true,
      scheduleMode: 'manual',
      publishingPreferences: {
        topics: [
          'Independent fashion',
          'Repairable clothing',
          'Textiles',
        ],
        region: 'Taiwan and East Asia',
        tone: 'Concise, curious, and evidence-led',
      },
    });
    await expect(new AgentJobService(stores.agentJobs).readLatestRunRequest(
      first.agentJobId,
    )).resolves.toBeUndefined();
  });

  it('fails closed instead of overwriting changed saved policy', async () => {
    const installer = new PostgresInformationPublisherPilotInstaller(database);
    await installer.install();
    await database.orm.update(agentJobs)
      .set({ name: 'Conflicting publisher' })
      .where(eq(agentJobs.id, 'publisher-01-mina-regional-fashion'));

    await expect(installer.install()).rejects.toThrow(
      'Publisher pilot conflicts with the saved Mina job configuration.',
    );
  });
});

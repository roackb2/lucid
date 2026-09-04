import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type {
  PostgresDatabase,
} from '../apps/server/src/infrastructure/postgres/database.js';
import {
  AgentJobService,
} from '../apps/server/src/lucid/agent/jobs/service.js';
import {
  postgresAgentJobs as agentJobs,
} from '../apps/server/src/lucid/persistence/postgres/schema.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../apps/server/src/lucid/persistence/postgres/test-context.js';
import {
  PostgresInformationNetworkFixtureSeeder,
} from '../apps/server/src/lucid/information-network/fixtures.js';
import {
  PostgresPublisherPilotConfigurator,
} from './publisher-pilot-configuration.js';

describe('Publisher-01 local pilot configuration', () => {
  let database: PostgresDatabase;
  let stores: PostgresTestStores['stores'];

  before(async () => {
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-publisher-pilot-configuration-test',
      reset: false,
    }));
  });

  beforeEach(async () => {
    await stores.agent.reset({ backgroundChecksEnabled: false });
    await new PostgresInformationNetworkFixtureSeeder(database).seed();
  });

  after(async () => database.close());

  it('activates exactly Mina and configures one retry-safe manual job', async () => {
    const configurator = new PostgresPublisherPilotConfigurator(database);
    const [first, repeated] = await Promise.all([
      configurator.configure(),
      configurator.configure(),
    ]);
    const users = await stores.agent.listUsers();
    const job = await new AgentJobService(stores.agentJobs).readAgentJob(
      first.agentJobId,
    );

    assert.ok(job);
    assert.deepEqual(repeated, first);
    assert.deepEqual(first, {
      pilotId: 'publisher-01-mina-regional-fashion',
      profileId: 'mina-chen',
      agentJobId: 'publisher-01-mina-regional-fashion',
      scheduleMode: 'manual',
      cadenceMs: 10_800_000,
    });
    assert.deepEqual(
      users
        .filter(({ status }) => status === 'active')
        .map(({ id }) => id)
        .sort(),
      ['fixture-user-mina-chen', 'local-user'],
    );
    assert.equal(job.id, 'publisher-01-mina-regional-fashion');
    assert.equal(job.agentId, 'fixture-agent-mina-chen');
    assert.equal(job.kind, 'information-network-publishing');
    assert.equal(job.enabled, true);
    assert.equal(job.scheduleMode, 'manual');
    assert.deepEqual(job.publishingPreferences?.topics, [
      'Independent fashion',
      'Repairable clothing',
      'Textiles',
    ]);
    assert.equal(
      job.publishingPreferences?.region,
      'Taiwan and East Asia',
    );
    assert.equal(
      job.publishingPreferences?.tone,
      'Concise, curious, and evidence-led',
    );
    assert.equal(
      await new AgentJobService(stores.agentJobs).readLatestRunRequest(
        first.agentJobId,
      ),
      undefined,
    );
  });

  it('fails closed instead of overwriting changed saved policy', async () => {
    const configurator = new PostgresPublisherPilotConfigurator(database);
    await configurator.configure();
    await database.orm.update(agentJobs)
      .set({ name: 'Conflicting publisher' })
      .where(eq(agentJobs.id, 'publisher-01-mina-regional-fashion'));

    await assert.rejects(
      configurator.configure(),
      /Publisher pilot configuration conflicts with the saved Mina job configuration\./,
    );
  });
});

/** Explicit development-only installer for deterministic Network fixtures. */
import { config as loadDotEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import { PostgresAgentWakeStore } from '../agent/postgres-store.js';
import { PostgresInformationNetworkFixtureSeeder } from './fixtures.js';

const repoRoot = fileURLToPath(new URL('../../../../..', import.meta.url));
loadDotEnv({ path: join(repoRoot, '.env'), quiet: true });

const environment = z.object({
  LUCID_AUTH_MODE: z.literal('development'),
  LUCID_DATABASE_URL: z.string().trim().min(1),
  LUCID_NETWORK_FIXTURE_SEED: z.literal('true'),
}).parse(process.env);

const database = new PostgresDatabase({
  url: environment.LUCID_DATABASE_URL,
  maxConnections: 1,
  applicationName: 'lucid-information-network-fixture-seeder',
});

try {
  await new PostgresAgentWakeStore(database).initialize();
  const receipt = await new PostgresInformationNetworkFixtureSeeder(database)
    .seed();
  process.stdout.write(
    `Installed ${receipt.fixtureSetId}: ${receipt.profileCount} Profiles, ${receipt.postCount} Posts, ${receipt.sourceCount} Sources, Finding #${receipt.findingSequence}.\n`,
  );
} finally {
  await database.close();
}

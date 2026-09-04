/** Explicit development-only command for configuring the first publisher. */
import { config as loadDotEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { z } from 'zod';
import {
  PostgresDatabase,
} from '../apps/server/src/infrastructure/postgres/database.js';
import {
  PostgresAgentWakeStore,
} from '../apps/server/src/lucid/agent/postgres-store.js';
import {
  PostgresPublisherPilotConfigurator,
} from './publisher-pilot-configuration.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
loadDotEnv({ path: join(repoRoot, '.env'), quiet: true });

const environment = z.object({
  LUCID_AUTH_MODE: z.literal('development'),
  LUCID_DATABASE_URL: z.string().trim().min(1),
  LUCID_PUBLISHER_PILOT_CONFIGURE: z.literal('true'),
}).parse(process.env);

const database = new PostgresDatabase({
  url: environment.LUCID_DATABASE_URL,
  maxConnections: 1,
  applicationName: 'lucid-publisher-pilot-configurator',
});

try {
  await new PostgresAgentWakeStore(database).initialize();
  const receipt = await new PostgresPublisherPilotConfigurator(database)
    .configure();
  process.stdout.write(
    `Configured ${receipt.pilotId}: Profile ${receipt.profileId}, Agent job ${receipt.agentJobId}, manual run policy, ${receipt.cadenceMs}ms timer check.\n`,
  );
} finally {
  await database.close();
}

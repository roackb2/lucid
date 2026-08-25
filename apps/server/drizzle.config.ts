import { defineConfig } from 'drizzle-kit';
import { createRequire } from 'node:module';

const resolvePackagePath = createRequire(import.meta.url).resolve;

export default defineConfig({
  schema: [
    './src/lucid/persistence/postgres/schema.ts',
    resolvePackagePath('@heddleagent/postgres/heartbeat/schema'),
  ],
  out: './drizzle',
  dialect: 'postgresql',
});

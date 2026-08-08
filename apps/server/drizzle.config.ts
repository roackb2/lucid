import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: [
    './src/lucid/persistence/postgres/schema.ts',
    './src/runtime/heartbeat/postgres/schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
});

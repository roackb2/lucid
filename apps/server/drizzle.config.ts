import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: [
    './src/database/postgres-schema.ts',
    './src/database/postgres-heartbeat-schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
});

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/database/postgres-schema.ts',
  out: './drizzle-postgres',
  dialect: 'postgresql',
});

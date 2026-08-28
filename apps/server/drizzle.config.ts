import { defineConfig } from 'drizzle-kit';
export default defineConfig({
  schema: [
    './src/lucid/persistence/postgres/schema.ts',
    './src/infrastructure/postgres/heddle-schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
});

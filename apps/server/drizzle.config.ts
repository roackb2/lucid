import { defineConfig } from 'drizzle-kit';
import { resolveDatabaseUrl } from './src/config';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: resolveDatabaseUrl(),
  },
});

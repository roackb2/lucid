import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.LUCID_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgres://lucid:12345678@localhost:5432/lucid?sslmode=disable',
  },
});

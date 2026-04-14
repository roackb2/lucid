import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export function resolveDatabaseUrl() {
  return (
    process.env.LUCID_DATABASE_URL ??
    process.env.DATABASE_URL ??
    'postgres://lucid:12345678@localhost:5432/lucid?sslmode=disable'
  );
}

const sql = postgres(resolveDatabaseUrl(), {
  max: 1,
});

export const db = drizzle(sql);
export { sql };

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { resolveDatabaseUrl } from './config.js';

const sql = postgres(resolveDatabaseUrl(), {
  max: 1,
});

export const db = drizzle(sql);
export { sql };

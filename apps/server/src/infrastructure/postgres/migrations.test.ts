import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Lucid PostgreSQL migrations', () => {
  it('relinquishes only the historical heartbeat tables', () => {
    const migration = readFileSync(
      new URL(
        '../../../drizzle/0006_remove_lucid_heartbeat_authority.sql',
        import.meta.url,
      ),
      'utf8',
    );

    expect(migration.match(/DROP TABLE/g)).toHaveLength(2);
    expect(migration).toContain('"heddle"."heartbeat_run_records"');
    expect(migration).toContain('"heddle"."heartbeat_tasks"');
    expect(migration).not.toContain('DROP SCHEMA');
    expect(migration).not.toContain('execution_host_conversation_turns');
  });
});

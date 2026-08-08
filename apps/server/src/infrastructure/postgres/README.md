# Shared PostgreSQL infrastructure

This directory owns driver-level PostgreSQL concerns shared by Lucid and the
Heddle task-authority adapter. It does not own product tables, domain queries,
mailbox policy, or heartbeat lifecycle policy.

## Files

| File | Responsibility |
| --- | --- |
| `database.ts` | Creates and closes one transaction-pooler-compatible client, exposes the unbound Drizzle handle, and applies checked-in migrations on explicit request |
| `test-database.ts` | Requires an explicit disposable test URL and opens a migrated real-PostgreSQL fixture |

`PostgresDatabase` deliberately imports no Lucid or Heddle schema. The Lucid
schema and policy-free record codecs live in `lucid/persistence/postgres`, while
product queries live in service-local `postgres-store.ts` adapters. Heddle task
state belongs in `runtime/heartbeat/postgres`. The composition root may share
one pool between them, but no adapter reaches through this module to call
another.

Runtime startup never runs migrations. Apply them through
`yarn server:db:migrate` before starting a new version. Keep runtime and
migration URLs secret, prefer a direct connection for migration, and retain
`prepare: false` for transaction poolers such as Supavisor.

Tests must set `LUCID_POSTGRES_TEST_URL` to a disposable database. The helper
never falls back to `LUCID_DATABASE_URL` because product store tests reset
Lucid's fixed schema.

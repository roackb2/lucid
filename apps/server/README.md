# Lucid server

The server is the composition root for Lucid's delegated-discovery runtime.
The active local composition still uses SQLite; the PostgreSQL product adapter
is independently runnable and tested for the hosted pilot.

It owns:

- HTTP/tRPC transport and CORS policy;
- SQLite lifecycle and checked-in Drizzle migrations;
- construction of the discovery repository;
- construction and startup of representative heartbeat tasks;
- graceful shutdown ordering.

The server does not decide whether a message is true or useful. It makes
participant identity, event visibility, delivery order, source references,
bounded execution, and recovery predictable.

## Entrypoints

- `src/server.ts` constructs the repository, runner, heartbeat host, workspace
  service, and HTTP server.
- `src/migrate.ts` applies checked-in SQLite migrations.
- `src/migrate-postgres.ts` applies checked-in PostgreSQL product migrations as
  an explicit deployment step.
- `src/database/sqlite-database.ts` owns the concrete SQLite connection.
- `src/database/sqlite-discovery-repository.ts` implements the async domain
  repository port with Drizzle and SQLite.
- `src/database/postgres-database.ts` and
  `src/database/postgres-discovery-repository.ts` provide the hosted product
  persistence boundary without changing domain services.
- `src/database/discovery-persistence.ts` selects SQLite or PostgreSQL from
  validated host configuration and owns adapter shutdown.
- `src/router.ts` exposes:
  - `discovery.snapshot`
  - `discovery.saveInterest`
  - `discovery.runNow`
  - `discovery.setBackgroundChecksEnabled`
  - `discovery.submitFeedback`
  - `discovery.resetWorkspace`
- `src/config.ts` validates environment variables and resolves state paths.

## Composition and shutdown

Startup order is:

1. migrate and initialize SQLite;
2. recover interrupted Heddle executions through its claim-fenced task API;
3. reconcile heartbeat tasks with the current workspace generation;
4. start the bounded Heddle scheduler through its lifecycle handle;
5. accept HTTP requests.

Shutdown first stops new HTTP work, then aborts and settles heartbeat
execution, and closes SQLite last. Persistence code must remain available
until every claimed wake has either completed or been returned to unread state.

The hosted composition is deliberately not switched on yet. It depends on the
released Heddle #318 targeted-worker/store contract so an ephemeral invocation
can lease and run exactly one due task. Until then, using PostgreSQL beside the
process-local scheduler would create the appearance of multi-host safety
without an authoritative distributed task owner.

`src/lucid` owns participants, mailbox events, findings, feedback, wake claims,
and the storage-independent `DiscoveryRepository` port. Heddle owns provider
credentials, unattended approval policy, execution cancellation, checkpoints,
run requests, and task settlement. It is integrated through
`HeddleRepresentativeAgentRunner` and `RepresentativeAgentHeartbeatService`.

Read [`src/database/README.md`](src/database/README.md) before changing storage
infrastructure. Read [`src/lucid/README.md`](src/lucid/README.md) before
changing agent lifecycle or mailbox behavior.

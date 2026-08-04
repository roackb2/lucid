# Lucid server

The server is the composition root for Lucid's local delegated-discovery
prototype.

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
- `src/database/sqlite-database.ts` owns the concrete SQLite connection.
- `src/database/sqlite-discovery-repository.ts` implements the async domain
  repository port with Drizzle and SQLite.
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

`src/lucid` owns participants, mailbox events, findings, feedback, wake claims,
and the storage-independent `DiscoveryRepository` port. Heddle owns provider
credentials, unattended approval policy, execution cancellation, checkpoints,
run requests, and task settlement. It is integrated through
`HeddleRepresentativeAgentRunner` and `RepresentativeAgentHeartbeatService`.

Read [`src/database/README.md`](src/database/README.md) before changing storage
infrastructure. Read [`src/lucid/README.md`](src/lucid/README.md) before
changing agent lifecycle or mailbox behavior.

# Lucid server

The server is the composition root for Lucid's PostgreSQL-backed
delegated-discovery runtime. Local development and the hosted pilot use the
same product and Heddle task authority; only the execution-host topology may
differ.

It owns:

- HTTP/tRPC transport and CORS policy;
- PostgreSQL pool lifecycle and checked-in Drizzle migrations;
- construction of the product repository and Heddle task authority;
- construction and startup of the selected representative execution host;
- graceful shutdown ordering.

The server does not decide whether a message is true or useful. It makes
participant identity, event visibility, delivery order, source references,
bounded execution, and recovery predictable.

## Entrypoints

- `src/server.ts` constructs the repository, runner, heartbeat host, workspace
  service, and HTTP server.
- `src/migrate.ts` applies checked-in PostgreSQL product and Heddle migrations
  as an explicit deployment step.
- `src/database/postgres-database.ts` and
  `src/database/postgres-discovery-repository.ts` provide the hosted product
  persistence boundary.
- `src/database/postgres-heartbeat-task-store.ts` implements Heddle's public
  task authority contracts over the same owned pool.
- `src/database/discovery-persistence.ts` composes both PostgreSQL adapters and
  owns pool shutdown.
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

1. validate the PostgreSQL and authentication configuration;
2. initialize product defaults without stealing live claims;
3. recover expired Heddle executions through its lease- and claim-fenced API;
4. reconcile heartbeat tasks with the current workspace generation;
5. start either the targeted bounded-worker host or the optional long-lived
   scheduler;
6. accept HTTP requests.

Shutdown first stops new HTTP work, then aborts and settles heartbeat
execution, and closes PostgreSQL last. Persistence code must remain available
until every claimed wake has either completed or been returned to unread state.

The targeted host is the default. It invokes one addressed task at a time,
retains a correctness poll fallback, and uses the database task lease as the
authority for recovery. The optional scheduler host is useful for a
single-process demo but does not change persistence or create a second task
authority.

Ordinary server startup never runs migrations. Apply `yarn server:db:migrate`
against the deployment database before starting a new version.

`src/lucid` owns participants, mailbox events, findings, feedback, wake claims,
and the storage-independent `DiscoveryRepository` port. Heddle owns provider
credentials, unattended approval policy, execution cancellation, checkpoints,
run requests, and task settlement. It is integrated through
`HeddleRepresentativeAgentRunner` and `RepresentativeAgentHeartbeatService`.

Read [`src/database/README.md`](src/database/README.md) before changing storage
infrastructure. Read [`src/lucid/README.md`](src/lucid/README.md) before
changing agent lifecycle or mailbox behavior.

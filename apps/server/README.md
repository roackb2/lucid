# Lucid server

The server is the composition root for Lucid's PostgreSQL-backed
delegated-discovery runtime. When the complete hosted coordinator profile is
configured, product heartbeat controls use the separate Heddle Coordinator as
their task authority. Without that profile, Lucid preserves the embedded
heartbeat topology for local product behavior that has not yet crossed the
scoped MCP boundary. The optional `src/hosted-execution/` boundary composes
execution authority, scoped product MCP, direct foreground turns, and narrow
coordinator task/delegation edges.

It owns:

- HTTP/tRPC transport and CORS policy;
- optional same-origin serving of the pre-built user SPA;
- PostgreSQL pool lifecycle and checked-in Drizzle migrations;
- construction of the service-owned product stores and Heddle task authority;
- construction and startup of the selected embedded or coordinator heartbeat
  topology;
- graceful shutdown ordering.

The server does not decide whether a message is true or useful. It makes
user identity, event visibility, delivery order, source references,
bounded execution, and recovery predictable.

## Entrypoints

- `src/server.ts` selects one heartbeat topology, constructs the product
  services, and starts the HTTP server.
- `src/auth/` verifies loopback, static-token, or Supabase sessions and maps
  provider subjects to product-owned user identities.
- `src/migrate.ts` applies checked-in PostgreSQL product and Heddle migrations
  as an explicit deployment step.
- `src/infrastructure/postgres/database.ts` owns the shared PostgreSQL pool and
  migration mechanism without importing product schemas.
- `src/lucid/{workspace,network,agent}/postgres-store.ts` and
  `src/lucid/agent/communication/postgres-store.ts` implement Lucid-owned
  product stores. `src/hosted-execution/conversation/postgres-history-store.ts`
  owns only the bounded product history query.
- `@heddleagent/postgres/execution-host/conversations` implements hosted-turn
  lifecycle writes over the same Lucid-owned pool.
- `src/runtime/heartbeat/postgres/task-store.ts` implements Heddle's public
  task authority contracts over the same owned pool.
- `src/composition/postgres-persistence.ts` composes the product stores and
  selected Heddle adapters, then owns their shared pool shutdown.
- `src/hosted-execution/` owns the adopter-side authority, MCP, and external
  conversation host ports without importing private host code. The released
  Execution Host client owns both direct and AgentCore transport mechanics.
- `src/health.ts` exposes process liveness at `GET /healthz`; it does not imply
  database or external-provider readiness.
- `src/static-spa/` serves the configured production SPA with navigation
  fallback and separate HTML/immutable-asset cache policy. It is disabled when
  `LUCID_WEB_ROOT` is unset for split-process local development.
- `src/router.ts` exposes:
  - `identity.session`
  - `identity.enroll`
  - `discovery.snapshot`
  - `discovery.saveInterest`
  - `discovery.runNow`
  - `discovery.setBackgroundChecksEnabled`
  - `discovery.submitFeedback`
  - `discovery.resetWorkspace`
  - `hostedConversation.recent`
- `src/config.ts` validates environment variables and resolves state paths.

The tRPC transport is mounted at `/api/trpc/`. The production image builds and
copies `apps/web/dist`, sets `LUCID_WEB_ROOT`, and serves both browser and API
traffic from one origin. Vite proxies the same path to the local server during
development.

## Composition and shutdown

Startup order is:

1. validate the PostgreSQL and authentication configuration;
2. construct product stores and exactly one heartbeat control topology;
3. for the embedded topology, initialize product defaults and recover expired
   Heddle executions through the lease- and claim-fenced API;
4. open HTTP so JWKS, MCP, and delegation routes are reachable;
5. either reconcile and resume the external coordinator task catalog, or start
   the already-initialized embedded host.

Shutdown first stops new HTTP work, then aborts and settles heartbeat
execution, and closes PostgreSQL last. Persistence code must remain available
until every claimed wake has either completed or been returned to unread state.

The targeted host is the default. It invokes one addressed task at a time,
retains a correctness poll fallback, and uses the database task lease as the
authority for recovery. The optional scheduler host is useful for a
single-process demo but does not change persistence or create a second task
authority.

Coordinator mode exposes product trigger, status, enable/disable, reset, and
global-gate operations through Heddle's public coordinator client. It does not
start a second embedded scheduler. The embedded topology remains the fallback
until Lucid's state-changing mailbox and finding capabilities have a scoped,
claim-fenced MCP contract; deleting it earlier would silently remove product
behavior. See
[`src/hosted-execution/README.md`](src/hosted-execution/README.md) and
[`../../docs/hosted-execution.md`](../../docs/hosted-execution.md) before
composing the external execution boundary or changing autonomous work.

Ordinary server startup never runs migrations. Apply `yarn server:db:migrate`
against the deployment database before starting a new version.

The production ARM64 image is built with `yarn server:docker:build`. Inside an
image, run `node apps/server/dist/migrate.js` as a separate release step. See
[`../../docs/deploying.md`](../../docs/deploying.md) for the generic
configuration and deployment sequence.

The embedded fallback consumes `@heddleagent/runtime@6.3.0` directly; no
deprecated `@roackb2/heddle` package remains. The external conversation and
coordinator boundary uses `@heddleagent/execution-host-client@6.6.0` for signing-key and
credential handling, signed authority, Node HTTP/JWKS/SSE, product-edge MCP,
generic durable conversation lifecycle, browser turn transport, authenticated
coordinator control, the versioned `ExecutionHost` contract, and its AgentCore
transport. Its lifecycle store is supplied by
`@heddleagent/postgres@6.1.0`; Lucid retains authenticated scope selection,
migration execution, and its history query.

`src/lucid` owns users, mailbox events, findings, feedback, wake claims,
and the service-owned store ports. Heddle owns provider
credentials, unattended approval policy, execution cancellation, checkpoints,
run requests, and task settlement. It is integrated through
`HeddleAgentRunner` and `AgentHeartbeatService`.

Read [`src/infrastructure/postgres/README.md`](src/infrastructure/postgres/README.md)
before changing pool or migration infrastructure,
[`src/lucid/persistence/postgres/README.md`](src/lucid/persistence/postgres/README.md)
before changing the shared schema or record codecs, the relevant service README
before changing a product store, and
[`src/lucid/README.md`](src/lucid/README.md) before changing agent lifecycle or
mailbox behavior. The project-wide
[`../../docs/coding-conventions.md`](../../docs/coding-conventions.md) defines
the required dependency and test shape.

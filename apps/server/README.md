# Lucid server

The server is the composition root for Lucid's PostgreSQL-backed
delegated-discovery runtime. Both current agent execution-host
selections run inside this process and use the same product and Heddle task
authority. The optional `src/hosted-execution/` boundary composes execution
assertion issuance, a scoped product MCP service, and an outbound conversation
host port only when its complete profile is explicitly enabled.

It owns:

- HTTP/tRPC transport and CORS policy;
- optional same-origin serving of the pre-built user SPA;
- PostgreSQL pool lifecycle and checked-in Drizzle migrations;
- construction of the service-owned product stores and Heddle task authority;
- construction and startup of the selected agent execution host;
- graceful shutdown ordering.

The server does not decide whether a message is true or useful. It makes
user identity, event visibility, delivery order, source references,
bounded execution, and recovery predictable.

## Entrypoints

- `src/server.ts` constructs the stores, runner, heartbeat host, workspace
  service, and HTTP server.
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

Neither current agent host is a remote transport. See
[`src/hosted-execution/README.md`](src/hosted-execution/README.md) and
[`../../docs/hosted-execution.md`](../../docs/hosted-execution.md) before
composing the external conversation boundary or extending it to autonomous
agent work.

Ordinary server startup never runs migrations. Apply `yarn server:db:migrate`
against the deployment database before starting a new version.

The production ARM64 image is built with `yarn server:docker:build`. Inside an
image, run `node apps/server/dist/migrate.js` as a separate release step. See
[`../../docs/deploying.md`](../../docs/deploying.md) for the generic
configuration and deployment sequence.

The server still requires `@roackb2/heddle` 5.13 for the existing in-process
agent runner and released heartbeat task APIs. The external conversation
boundary uses `@heddleagent/execution-host-client@6.1.0` for signing-key and
credential handling, signed authority, Node HTTP/JWKS/SSE, product-edge MCP,
generic durable conversation lifecycle, the versioned `ExecutionHost`
contract, and its AgentCore transport. Its lifecycle store is supplied by
`@heddleagent/postgres@6.0.0`; Lucid retains authenticated scope selection,
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

# Lucid server

The server is the composition root for Lucid's PostgreSQL-backed
delegated-discovery product. A complete hosted Execution Host and Coordinator
profile is required. Product heartbeat controls use the separate Heddle
Coordinator as their sole task authority; Lucid does not embed a scheduler or
open the heartbeat tables. `src/hosted-execution/` composes execution
authority, scoped product MCP, direct foreground turns, and Coordinator
task/product-work lifecycle edges.

It owns:

- HTTP/tRPC transport and CORS policy;
- optional same-origin serving of the pre-built user SPA;
- PostgreSQL pool lifecycle and checked-in Drizzle migrations;
- construction of the service-owned product stores;
- coordinator-backed heartbeat product control and desired-task projection;
- graceful shutdown ordering.

The server does not decide whether a message is true or useful. It makes
user identity, event visibility, delivery order, source references,
bounded execution, and recovery predictable.

## Entrypoints

- `src/server.ts` requires and composes the coordinator-backed heartbeat
  topology, constructs the product services, and starts the HTTP server.
- `src/auth/` verifies loopback, static-token, or Supabase sessions and maps
  provider subjects to product-owned user identities.
- `src/migrate.ts` applies checked-in Lucid PostgreSQL migrations as an
  explicit deployment step. The final ownership-transfer migration removes
  Lucid's historical heartbeat tables before the coordinator creates them.
- `src/infrastructure/postgres/database.ts` owns the shared PostgreSQL pool and
  migration mechanism without importing product schemas.
- `src/lucid/{workspace,network,agent}/postgres-store.ts` and
  `src/lucid/agent/communication/postgres-store.ts` implement Lucid-owned
  product stores. `src/hosted-execution/conversation/postgres-history-store.ts`
  owns only the bounded product history query.
- `@heddleagent/postgres/execution-host/conversations` implements hosted-turn
  lifecycle writes over the same Lucid-owned pool.
- `src/composition/postgres-persistence.ts` composes the product stores and
  hosted-conversation lifecycle adapter, then owns their shared pool shutdown.
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
2. construct product stores and the coordinator-backed heartbeat control;
3. open HTTP so JWKS, MCP, and heartbeat execution-lifecycle routes are reachable;
4. reconcile the desired task catalog and resume coordinator admission.

Shutdown first stops new HTTP work, pauses coordinator admission, closes the
hosted boundary, and closes PostgreSQL last.

Product trigger, status, enable/disable, reset, and global-gate operations use
Heddle's public coordinator client. Missing coordinator configuration fails
startup rather than silently starting a second scheduler. The current hosted
heartbeat capability claims a fixed product horizon and grants only message
read plus shared-request publication. Broader agent mutations remain separate
scoped-MCP slices. See
[`src/hosted-execution/README.md`](src/hosted-execution/README.md) and
[`../../docs/hosted-execution.md`](../../docs/hosted-execution.md) before
composing the external execution boundary or changing autonomous work.

Ordinary server startup never runs migrations. Apply `yarn server:db:migrate`
against the deployment database before starting a new version.

The production ARM64 image is built with `yarn server:docker:build`. Inside an
image, run `node apps/server/dist/migrate.js` as a separate release step. See
[`../../docs/deploying.md`](../../docs/deploying.md) for the generic
configuration and deployment sequence.

The conversation and Coordinator boundary uses
`@heddleagent/execution-host-client@8.0.0` for signing-key and
credential handling, signed authority, Node HTTP/JWKS/SSE, product-edge MCP,
generic durable conversation lifecycle, browser turn transport, authenticated
coordinator control, the versioned `ExecutionHost` contract, and its AgentCore
transport. Its lifecycle store is supplied by
`@heddleagent/postgres@6.1.3`; Lucid retains authenticated scope selection,
migration execution, and its history query.

`src/lucid` owns users, mailbox events, findings, feedback, wake claims, and
the service-owned store ports. Heddle owns provider credentials, unattended
approval policy, execution cancellation, task scheduling, checkpoints, run
requests, and task settlement. Lucid integrates through
`CoordinatorAgentHeartbeatService`, `AgentWorkService`, and the scoped
execution-lifecycle/MCP boundary.

Read [`src/infrastructure/postgres/README.md`](src/infrastructure/postgres/README.md)
before changing pool or migration infrastructure,
[`src/lucid/persistence/postgres/README.md`](src/lucid/persistence/postgres/README.md)
before changing the shared schema or record codecs, the relevant service README
before changing a product store, and
[`src/lucid/README.md`](src/lucid/README.md) before changing agent lifecycle or
mailbox behavior. The project-wide
[`../../docs/coding-conventions.md`](../../docs/coding-conventions.md) defines
the required dependency and test shape.

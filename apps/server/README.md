# Lucid server

The server is the composition root for Lucid's PostgreSQL-backed
delegated-discovery runtime. Both current representative execution-host
selections run inside this process and use the same product and Heddle task
authority. The optional `src/hosted-execution/` boundary composes execution
assertion issuance, a scoped product MCP service, and an outbound conversation
host port only when its complete profile is explicitly enabled.

It owns:

- HTTP/tRPC transport and CORS policy;
- PostgreSQL pool lifecycle and checked-in Drizzle migrations;
- construction of the service-owned product stores and Heddle task authority;
- construction and startup of the selected representative execution host;
- graceful shutdown ordering.

The server does not decide whether a message is true or useful. It makes
participant identity, event visibility, delivery order, source references,
bounded execution, and recovery predictable.

## Entrypoints

- `src/server.ts` constructs the stores, runner, heartbeat host, workspace
  service, and HTTP server.
- `src/migrate.ts` applies checked-in PostgreSQL product and Heddle migrations
  as an explicit deployment step.
- `src/infrastructure/postgres/database.ts` owns the shared PostgreSQL pool and
  migration mechanism without importing product schemas.
- `src/lucid/{workspace,network,representative}/postgres-store.ts` and
  `src/lucid/representative/communication/postgres-store.ts` implement four
  service-owned store ports with their use-case transactions.
- `src/runtime/heartbeat/postgres/task-store.ts` implements Heddle's public
  task authority contracts over the same owned pool.
- `src/composition/postgres-persistence.ts` composes the four product stores
  and Heddle task adapter, then owns their shared pool shutdown.
- `src/hosted-execution/` owns the adopter-side authority, MCP, and external
  conversation host ports without importing private host code. Its
  `agentcore/` adapter is the only provider-specific AWS SDK boundary.
- `src/health.ts` exposes process liveness at `GET /healthz`; it does not imply
  database or external-provider readiness.
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

Neither current representative host is a remote transport. See
[`src/hosted-execution/README.md`](src/hosted-execution/README.md) and
[`../../docs/hosted-execution.md`](../../docs/hosted-execution.md) before
composing the external conversation boundary or extending it to autonomous
representative work.

Ordinary server startup never runs migrations. Apply `yarn server:db:migrate`
against the deployment database before starting a new version.

The production ARM64 image is built with `yarn server:docker:build`. Inside an
image, run `node apps/server/dist/migrate.js` as a separate release step. See
[`../../docs/deploying.md`](../../docs/deploying.md) for the generic
configuration and deployment sequence.

The server requires `@roackb2/heddle` 5.13 because the merged
PostgreSQL heartbeat adapter consumes the released public task administration,
control-policy, and state-projector APIs. Downgrading to 5.9 makes the existing
server source fail typechecking even though the hosted-execution boundary does
not import Heddle directly. The external conversation foundation separately
uses `@roackb2/heddle-adopter` 5.13 for signing-key and credential handling,
signed authority, Node HTTP/JWKS/SSE, product-edge MCP, conversation
orchestration, and the versioned `ExecutionHost` client contract.

`src/lucid` owns participants, mailbox events, findings, feedback, wake claims,
and the service-owned store ports. Heddle owns provider
credentials, unattended approval policy, execution cancellation, checkpoints,
run requests, and task settlement. It is integrated through
`HeddleRepresentativeAgentRunner` and `RepresentativeAgentHeartbeatService`.

Read [`src/infrastructure/postgres/README.md`](src/infrastructure/postgres/README.md)
before changing pool or migration infrastructure,
[`src/lucid/persistence/postgres/README.md`](src/lucid/persistence/postgres/README.md)
before changing the shared schema or record codecs, the relevant service README
before changing a product store, and
[`src/lucid/README.md`](src/lucid/README.md) before changing agent lifecycle or
mailbox behavior. The project-wide
[`../../docs/coding-conventions.md`](../../docs/coding-conventions.md) defines
the required dependency and test shape.

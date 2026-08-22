# Lucid architecture

Lucid is one TypeScript application with separate web and server workspaces.
The server combines user-facing APIs, domain services, PostgreSQL
adapters, and a replaceable agent-execution host. PostgreSQL remains
the authority when the API process or execution worker restarts.

```mermaid
flowchart LR
  Browser["User web workspace"] --> API["Authenticated tRPC API"]
  Simulator["Loopback development simulator"] --> API
  API --> Workspace["Workspace service"]
  API --> Network["User network service"]
  Workspace --> WorkspaceStore["Workspace store port"]
  Network --> NetworkStore["Network store port"]
  Heartbeat["Agent heartbeat service"] --> WakeStore["Wake store port"]
  Heartbeat --> WorkingContext["Workspace working-context port"]
  Heartbeat --> Tasks["Heddle task authority"]
  Tasks --> Host["Bounded execution host"]
  Host --> Runner["Heddle agent runner"]
  Runner --> Tools["Lucid communication tools"]
  Tools --> CommunicationStore["Communication store port"]
  WorkspaceStore --> WorkspaceAdapter["Workspace PostgreSQL adapter"]
  WorkingContext --> WorkspaceAdapter
  NetworkStore --> NetworkAdapter["Network PostgreSQL adapter"]
  WakeStore --> WakeAdapter["Wake PostgreSQL adapter"]
  CommunicationStore --> CommunicationAdapter["Communication PostgreSQL adapter"]
  WorkspaceAdapter --> LucidSchema[("PostgreSQL: lucid schema")]
  NetworkAdapter --> LucidSchema
  WakeAdapter --> LucidSchema
  CommunicationAdapter --> LucidSchema
  Tasks --> HeddleSchema[("PostgreSQL: heddle schema")]
```

## Applications and transport

`apps/web` renders one local user's discovery workspace. It fetches one
authoritative snapshot and sends user intent such as saving an interest,
requesting a check, pausing a agent, submitting feedback, or giving
direct guidance. React does not decide mailbox visibility, infer whether mail
is unread, or reconstruct finding causality.

`apps/server` exposes one public health surface and three role-scoped tRPC
surfaces:

- `system.health` reports basic process health without authentication;
- `discovery` is the user-scoped product API used by the web app;
- `operator` controls the durable global dispatch gate; and
- `development` provides loopback-only user registration, synthetic
  input, diagnostics, lifecycle changes, and reset for simulation.

The other routes derive their role and local user identity from the
authenticated request rather than accepting identity in ordinary product
input.

## Domain services

The server is organized around behavior rather than tables:

- the workspace service owns the local user's interest, manual checks,
  findings, feedback, guidance, and user-scoped projection;
- the user-network service owns trusted ingress, user lifecycle,
  development diagnostics, and coordination with agent tasks;
- the agent heartbeat service reconciles users to Heddle
  tasks, claims fixed mailbox wakes, enforces completion prerequisites, routes
  new messages, and coordinates pause/recovery; and
- the communication tool service grants one agent a bounded set of
  visible reads and validated writes for one wake.

Each service owns a narrow primary store port expressed in domain operations.
Its PostgreSQL adapter lives in the same behavior slice and implements that
port with the real Drizzle queries and transactions. A service may also consume
an explicitly named projection port owned by another slice. Agent wake
orchestration, for example, reads retry-stable working context through the
workspace-owned `AgentWorkingContextReader`; it does not import the
workspace adapter.

Shared persistence code owns only the schema, policy-free record codecs, and
the disposable test fixture. Neutral PostgreSQL infrastructure owns pool and
migration mechanics. Mailbox visibility, user projection, workspace
identity, initialization, and read-model policy remain in their owning slices.
Neither shared location becomes a second domain layer.

This is deliberately not repository-per-table CRUD. Operations such as
user registration or wake claiming span several records and must remain
one domain transaction.

### Code map

| Path | Responsibility |
| --- | --- |
| `apps/server/src/lucid/workspace/` | User workspace service, primary store port, secondary working-context port, PostgreSQL adapter, and workspace policy |
| `apps/server/src/lucid/network/` | User ingress/lifecycle service, store port, PostgreSQL adapter, and user-visibility policy |
| `apps/server/src/lucid/agent/` | Agent wake/task coordination, store port, PostgreSQL adapter, runner, and mailbox policy |
| `apps/server/src/lucid/agent/communication/` | Bounded communication tools, store port, and PostgreSQL adapter |
| `apps/server/src/lucid/persistence/postgres/` | Shared Lucid schema, policy-free record codecs, and disposable PostgreSQL test fixture only |
| `apps/server/src/infrastructure/postgres/` | Neutral PostgreSQL pool and migration mechanics without Lucid product policy |
| `apps/server/src/runtime/heartbeat/postgres/` | PostgreSQL adapter for Heddle's public task-authority contracts |
| `apps/server/src/composition/postgres-persistence.ts` | Constructs the adapters over one pool and owns their shared shutdown boundary |
| `apps/server/src/hosted-execution/` | Lucid-owned product MCP tools and scope-to-projection binding; generic authority, verification, and host clients come from `@heddleagent/execution-host-client` |

Transactions follow use-case ownership rather than table ownership. A
service-local adapter may atomically query or update several product tables,
but it must not call another service or concrete store inside that transaction.
A cross-slice read depends on an explicit port exported by the slice that owns
the projection; composition injects its implementation.
A genuinely cross-service workflow receives its own explicit application
boundary instead of recreating one service-wide repository. See
[Coding conventions](coding-conventions.md) for the dependency and testing
rules.

## Persistence

One PostgreSQL database contains two separately owned schemas:

```text
lucid
├── discovery_workspaces
├── users
├── agents
└── discovery_events

heddle
├── task definitions and schedule state
├── run requests and execution leases
├── checkpoints
└── immutable run history
```

Lucid is event-centered but not purely event-sourced. User and
agent rows hold lifecycle and cursor state, while append-only
`discovery_events` preserve interests, inputs, messages, findings, feedback,
guidance, working-note revisions, and wake outcomes. Read models such as
network progress and guidance follow-through are derived from these durable
facts rather than stored model judgments.

The `lucid` and `heddle` schemas share a PostgreSQL pool in the current server,
but their ownership remains separate. Migrations are checked in and applied by
an explicit command before startup. `LUCID_STATE_ROOT` contains local Heddle
execution artifacts only.

## Agent execution

Every non-retired user has a derived Heddle heartbeat task. User
registration reconciles that task; persisting new mailbox input creates a
durable Heddle run request. The default targeted host then:

1. receives an in-process low-latency notification;
2. retains polling of the durable task catalog as the correctness fallback;
3. admits at most the configured number of independent tasks;
4. invokes one addressed worker for one task; and
5. lets Heddle perform the final due check, claim, checkpoint continuation,
   model/tool loop, and fenced settlement.

The optional long-lived scheduler uses the same PostgreSQL authorities. It is
useful for topology comparison, not a second persistence mode.

The embedded invocation-target interface remains local infrastructure for the
current product UI. It carries an `AbortSignal`, returns Heddle's targeted-task
result, and delegates to a worker that needs both the PostgreSQL task store and
an in-process heartbeat handler.

The optional hosted profile adds a separate architecture-proof path. Lucid
publishes desired tasks to the long-running Heddle Coordinator, which owns its
own PostgreSQL task authority, claims, checkpoints, recovery, and settlement.
For each claim, the coordinator requests one short-lived execution/MCP bundle
from Lucid and invokes the same external Runtime used by foreground
conversations. Neither service receives Lucid database credentials; the
Runtime calls curated product operations through scoped MCP capabilities.

Startup reconciliation is intentionally the only product integration in this
slice. Product trigger, status, enable/disable, and reset flows remain on the
embedded host until the local coordinator vertical proves the architecture and
a single task authority can replace the old path cleanly. See
[External Heddle execution host](hosted-execution.md).

## Agent boundary

The agent runs through Heddle with default tools and plan tools
disabled. Lucid supplies only its domain tools:

- read visible messages through the wake's fixed horizon;
- update the agent's private working note;
- post a shared message;
- message an encountered active peer directly;
- report a sourced finding privately to the represented user; or
- finish without action.

Deterministic code validates visibility, reply routing, source references,
peer eligibility, action budgets, and retry identities. The model decides what
the text means and whether it appears relevant. Tool execution is serialized
within a wake; independent agents may run concurrently.

## Authentication and trust boundaries

Three request authenticators exist:

- `development` accepts only a loopback-bound server and maps the local socket
  to the seeded user with user and operator roles;
- `static-token` accepts distinct high-entropy user and operator bearer
  tokens and is limited to a private single-user pilot over TLS; and
- `supabase` verifies a Google-backed Supabase access token through the
  project's JWKS, then resolves the exact `(issuer, subject)` to a durable
  Lucid user. Email and provider profile claims are never product
  authorization.

The browser uses development mode without a credential on loopback, or sends
its short-lived Supabase session in hosted mode. An authenticated but unbound
subject can access only the identity/onboarding surface; user routes and
hosted execution require a durable binding. Authorization headers, tokens,
model credentials, database URLs, and private user context must not be
logged.

## Deployment and process lifecycle

Startup validates configuration, opens PostgreSQL, initializes missing Lucid
defaults without stealing live claims, recovers eligible expired Heddle work,
reconciles agent tasks, starts the selected execution host, and then
accepts HTTP traffic.

Shutdown stops new HTTP work and execution admission, aborts and awaits locally
owned agent work, then closes PostgreSQL last. A process must never
close persistence while an owned wake can still settle.

The current targeted dispatcher is an in-process delivery mechanism over a
durable authority. A multi-replica hosted service needs a remote invocation or
queue adapter; PostgreSQL task claims alone do not deliver work to a worker.

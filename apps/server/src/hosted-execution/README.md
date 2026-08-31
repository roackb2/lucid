# Hosted execution

This boundary lets Lucid use the external Heddle Execution Host and the
long-running Heddle Coordinator without importing either private deployable.
Foreground conversations invoke the Runtime directly. The Coordinator is the
sole autonomous-work scheduler and calls Lucid's product-work lifecycle around
each execution it owns.

## Service boundary

Lucid imports generic machinery from the released
`@heddleagent/execution-host-client` package:

- `authority` mints short-lived execution assertions and MCP capabilities and
  publishes public JWKS;
- `conversation` owns hosted foreground-turn lifecycle;
- `coordinator` owns task reconciliation plus the generic product-work
  preparation/settlement protocol;
- `mcp` independently verifies product capabilities;
- `http-sse` provides the direct development transport; and
- `agentcore` provides the AWS SDK/SigV4 transport.

`@heddleagent/postgres/execution-host/conversations` supplies hosted
conversation persistence over Lucid's Drizzle handle. The Coordinator owns its
own Heddle heartbeat tables and credentials in the same application database;
the database-free Runtime receives neither credential.

Lucid-owned behavior is:

| Path | Responsibility |
| --- | --- |
| `config.ts` | Validate Lucid's complete hosted profile, secrets, identities, URLs, audiences, and limits |
| `model-credentials.ts` | Select an explicit API key or ask Heddle for an access-token-only view of Lucid's stored Codex login |
| `conversation/` | Authenticate a user, derive foreground execution scope, and query scoped lifecycle records |
| `heartbeat/` | Publish desired tasks and map one Coordinator execution to Lucid `AgentWorkService` preparation and settlement |
| `mcp/product-tools.ts` | Declare exact product tool names, schemas, descriptions, and operations |
| `mcp/workspace-projection-reader.ts` | Bind foreground capability scope to a user workspace projection |
| `mcp/agent-work-tool-executor.ts` | Bind heartbeat capability scope and execution ID to one active product work claim |
| `http-router.ts` | Mount package-owned JWKS, conversation, MCP, and heartbeat-lifecycle services beside tRPC |

Do not recreate public SDK wrappers in Lucid. Composition imports generic
services directly and injects only product-owned ports.

Heddle owns OAuth refresh and persistence in Lucid's process. Lucid selects the
product credential source and passes the resulting request-scoped credential
to the public Execution Host client. The Runtime contract rejects refresh
tokens and ambient model credentials. The browser never receives either form.

## Workflow separation

`conversation-turn` grants only `read_workspace_snapshot`.

`heartbeat-task` grants only the bounded Lucid work tools: claimed working
context, mailbox and open-request reads, working-note update, shared and direct
replies, Finding delivery, and explicit no-action settlement. Preparation
claims a fixed Lucid event horizon before the model runs. Every tool call
re-resolves that claim from verified capability scope, and every mutation
checks the live execution fence in the insert transaction. Completion advances
the Lucid cursor only after required durable effects exist.

The Coordinator decides when an attempt runs. `AgentWorkService` decides what
product work that attempt owns and whether its product effects are complete.
The Execution Host performs the bounded model/tool loop. None of these roles is
a second scheduler or a generic product control plane.

## Startup and evidence

Ordinary startup requires `LUCID_HOSTED_EXECUTION_ENABLED=true` and a complete
Execution Host plus Coordinator profile. Lucid opens its local authority and
MCP routes, reconciles the desired task catalog behind the Coordinator's
short-lived namespace maintenance fence, and controls Lucid's product-wide
dispatch through one durable opaque admission group. The namespace returns to
ready after reconciliation even while the Lucid group remains closed.
Missing Coordinator configuration fails startup; Lucid never falls back to an
embedded scheduler.

Deterministic integration coverage proves two distinct paths:

- foreground user request -> Lucid admission -> authority -> fake host ->
  conversation-only MCP -> terminal SSE; and
- Coordinator prepare -> Lucid product claim -> heartbeat-only MCP calls ->
  Lucid settlement under the same execution ID.

`AgentWorkService` tests separately exercise real product claim, message read,
message mutation, required-effect validation, completion, and cursor behavior.
PostgreSQL integration tests verify cross-process fencing when supplied a
disposable `LUCID_POSTGRES_TEST_URL`.

These are local contract proofs. They do not claim that the new path has run in
the deployed ECS Coordinator, managed AgentCore Runtime, or against a real
model. Those remain deployment verification steps after the package and Lucid
changes are merged and deployed.

## Dependency and security rules

- Lucid owns product authentication, identity, canonical data, work claims,
  migration execution, tool effects, and product settlement.
- Heddle owns task schedules, due selection, Heddle claims, checkpoints,
  execution authority, model-loop execution, and Heddle run settlement.
- MCP exposes domain operations rather than database CRUD and re-verifies every
  bearer independently.
- No private Execution Host source or AWS transport internals are imported.
- Compact JWTs, model credentials, database URLs, and signing keys must not
  enter prompts, durable replay records, logs, errors, or tool results.

Read `mcp/README.md` before adding a product tool, and update
`docs/hosted-execution.md` whenever supported workflows, ownership, or live
deployment evidence changes.

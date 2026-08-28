# Hosted execution

This application boundary lets Lucid use an external Heddle Execution Host and
the narrow autonomous-work coordinator without importing either private
service repository. Foreground conversations invoke the Runtime directly.
The coordinator receives desired heartbeat tasks and calls back for one
short-lived execution delegation only when it owns a durable Heddle claim.

## Services

Lucid imports the generic adopter machinery from the released
`@heddleagent/execution-host-client` package:

- `authority` mints short-lived execution assertions and optional MCP
  capabilities and projects public JWKS keys;
- `mcp` independently verifies capabilities at the product edge;
- `http-sse` defines the provider-neutral `ExecutionHost` port and strict
  direct-development client;
- `agentcore` implements that port through the AWS SDK and SigV4; and
- `conversation` owns the durable hosted-turn lifecycle over an injected store.

`@heddleagent/postgres/execution-host/conversations` supplies that store over
Lucid's owned Drizzle handle.

This directory contains only Lucid-owned behavior:

| Path | Responsibility |
| --- | --- |
| `config.ts` | Validate Lucid's all-or-nothing hosted profile and select product identity, URLs, audiences, and limits |
| `conversation/` | Admit an authenticated Lucid user, derive product-owned scope/identity/deadline, and query the newest 20 scoped lifecycle records |
| `heartbeat/` | Publish Lucid-owned desired task state and issue one-run execution/MCP delegation without sharing product database credentials |
| `http-router.ts` | Mount the package-owned HTTP and MCP services beside Lucid's tRPC routes |
| `mcp/product-tools.ts` | Declare the exact Lucid tool names, schemas, descriptions, and product operations |
| `mcp/workspace-projection-reader.ts` | Bind verified capability scope to Lucid's current workspace projection |

`@heddleagent/execution-host-client` owns the ES256 key loader, non-enumerable direct
credentials, authority and capability verification, hosted-turn orchestration,
direct and AgentCore transports, durable lifecycle transitions, bounded Node
HTTP/JWKS/SSE service, declarative JSON-tool registry, and stateless Streamable
HTTP MCP lifecycle. Those implementations must not be copied back into Lucid.

Do not recreate wrappers around the public SDK here. Composition should import
its services and types directly, then inject Lucid-owned ports.

The first supported product capability is the read-only
`read_workspace_snapshot` tool for conversation and heartbeat execution. A trusted,
product-authorized application service supplies tenant, subject, session, and
the fixed Lucid tool policy; untrusted or model-controlled input cannot choose
that authority or an MCP destination. Stateful agent communication tools remain
deferred until an autonomous-task wire contract can preserve task claims,
mailbox horizons, action identities, and fenced settlement.

## Current integration state

Ordinary server startup requires `LUCID_HOSTED_EXECUTION_ENABLED=true` and a
complete Execution Host plus Coordinator profile. It
loads the signing key, publishes `/.well-known/jwks.json`, mounts
`/hosted-execution/mcp`, and exposes
`/hosted-execution/conversation-turns` as an authenticated SSE endpoint. The
admission service derives product-owned identity and timing before the turn
service issues one exact read-only MCP capability and invokes the configured
host through either of the released direct HTTP or AgentCore `ExecutionHost`
implementations.

The coordinator URL and its distinct API/delegation tokens are required.
Startup first opens Lucid's HTTP authority/MCP routes, then reconciles the
coordinator task catalog while coordinator admission is paused. This makes the
local coordinator vertical testable without turning the coordinator into a
foreground proxy. Product trigger, status, enable/disable, reset, and global
gate operations use the coordinator's public authenticated API. Lucid contains
no embedded scheduler, so there is only one task authority.

The remaining compatibility gap is behavioral rather than transport-related.
The coordinator Runtime can currently inspect Lucid through the read-only
`read_workspace_snapshot` capability. Claim-fenced communication operations
that post network messages, revise working notes, and report findings still
need a scoped state-changing MCP contract; coordinator execution is therefore
an architecture proof rather than full autonomous-product parity.

Lucid also owns the product grounding supplied with each desired heartbeat
task. Reconciliation carries the selected agent instructions plus an explicit
requirement to inspect the read-only workspace snapshot before deciding whether
anything is worth reporting. The coordinator and Runtime execute that context;
they do not invent Lucid product policy or silently convert an ungrounded model
turn into a useful finding.

The real local vertical passed on 2026-08-23. One authenticated conversation
turn and one coordinator-claimed heartbeat both used the direct HTTP Runtime,
called `product__read_workspace_snapshot` through Lucid's scoped MCP endpoint,
and reached truthful terminal states. The heartbeat additionally persisted its
run record and loaded checkpoint through the official PostgreSQL authority.
This proves the local product boundary, not managed AgentCore deployment or
coordinator restart recovery.

Two deterministic integration boundaries remain deliberately distinct. The
public adopter fixture proves the package turn service and Lucid MCP contract
without private host code. The startup-composition test crosses both real HTTP
boundaries and the official MCP SDK: user request -> Lucid admission ->
authority -> fake host -> Lucid MCP -> workspace projection -> terminal SSE.
It also proves that an accepted host stream ending without a terminal is not
converted into success. The Heddle package's focused AgentCore tests prove
SigV4 custom-header placement, strict stream reuse, and cancellation
propagation against a local AWS-protocol fixture. None of these tests is
evidence of a real Heddle model turn, managed header forwarding, container
isolation, or AgentCore lifecycle; those remain deployment checks.

The direct HTTP adapter is only for a loopback or reviewed HTTPS host. The
package-owned AgentCore adapter implements the same `ExecutionHost` port with
SigV4 and the managed Runtime invocation API. It uses the AWS SDK credential
chain and has no database or product-store dependency. Neither adapter may
receive a PostgreSQL URL.

## Dependency rules

- Lucid owns product authentication, authorization, identity mapping,
  capability minting, canonical data, migration execution, and the bounded
  user history query. Heddle owns generic lifecycle projection and writes.
- The external host owns the Heddle loop, isolated workspace/processes, and
  strict event stream. It receives only short-lived authority and model access.
- MCP exposes domain capabilities rather than database CRUD. It re-verifies
  every bearer independently instead of trusting the host's earlier decision.
- No file in this boundary imports private execution-host code or AWS SDK
  transport internals. Provider-specific transport stays behind the public SDK
  port.
- Compact JWTs, model credentials, database URLs, and private signing keys must
  not enter prompts, result projections, logs, errors, files, or durable replay
  records.

Read `mcp/README.md` before adding a product tool. Update
`conversation/README.md` before changing the hosted turn's application
responsibility. Update
`docs/hosted-execution.md` whenever supported workflows, trust ownership, or
deployment evidence changes.

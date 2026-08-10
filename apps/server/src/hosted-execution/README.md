# Hosted execution

This application boundary lets Lucid act as an adopter control plane for an
external Heddle Execution Host without importing the private host repository.
It is deliberately separate from representative heartbeat execution, which
still runs in process and retains its PostgreSQL task and wake authorities.

## Services

Lucid imports the generic adopter machinery from the released
`@roackb2/heddle-adopter` package:

- `authority` mints short-lived execution assertions and optional MCP
  capabilities and projects public JWKS keys;
- `mcp` independently verifies capabilities at the product edge; and
- `http-sse` defines the provider-neutral `ExecutionHost` port and strict
  direct-development client.

This directory contains only Lucid-owned behavior:

| Path | Responsibility |
| --- | --- |
| `config.ts` | Validate the all-or-nothing hosted profile and remove invocation credentials from ambient environment state |
| `signing-key.ts` | Load one owner-readable P-256 private JWK as a non-exportable signing key |
| `conversation/` | Admit an authenticated Lucid participant, derive invocation identity, then use the fixed-policy turn service to mint authority and stream the provider-neutral host port |
| `http-router.ts` | Publish public JWKS, mount product MCP, and expose the authenticated conversation SSE endpoint |
| `mcp/` | Define Lucid's fixed tool policy, expose curated product tools over stateless Streamable HTTP, and bind verified scope to product projections |

Do not recreate wrappers around the public SDK here. Composition should import
its services and types directly, then inject Lucid-owned ports.

The first supported product capability is the read-only
`read_workspace_snapshot` tool for a `conversation-turn`. A trusted,
product-authorized application service supplies tenant, subject, session, and
the fixed Lucid tool policy; untrusted or model-controlled input cannot choose
that authority or an MCP destination. Stateful
representative communication tools remain behind the wake-local runner until
an autonomous-task wire contract can preserve task claims, mailbox horizons,
action identities, and fenced settlement.

## Current integration state

Ordinary server startup now composes this boundary only when
`LUCID_HOSTED_EXECUTION_ENABLED=true` and the complete profile validates. It
loads the signing key, publishes `/.well-known/jwks.json`, mounts
`/hosted-execution/mcp`, and exposes
`/hosted-execution/conversation-turns` as an authenticated SSE endpoint. The
admission service derives product-owned identity and timing before the turn
service issues one exact read-only MCP capability and invokes the configured
host through the released strict direct HTTP client.

Two deterministic integration boundaries remain deliberately distinct. The
public adopter fixture proves the turn service and Lucid MCP contract without
private host code. The startup-composition test crosses both real HTTP
boundaries and the official MCP SDK: participant request -> Lucid admission ->
authority -> fake host -> Lucid MCP -> workspace projection -> terminal SSE.
It also proves that an accepted host stream ending without a terminal is not
converted into success. Neither test is evidence of a real Heddle model turn,
container isolation, or managed AgentCore behavior; those remain deployment
checks.

The direct HTTP adapter is only for a loopback or reviewed HTTPS host. A future
AgentCore adapter implements the same `ExecutionHost` port with SigV4 and the
managed Runtime invocation API. Neither adapter may receive a PostgreSQL URL.

## Dependency rules

- Lucid owns product authentication, authorization, identity mapping,
  capability minting, canonical data, and result projection.
- The external host owns the Heddle loop, isolated workspace/processes, and
  strict event stream. It receives only short-lived authority and model access.
- MCP exposes domain capabilities rather than database CRUD. It re-verifies
  every bearer independently instead of trusting the host's earlier decision.
- No file in this boundary imports private execution-host code or AWS SDK
  types. Provider-specific transports implement the public SDK port.
- Compact JWTs, model credentials, database URLs, and private signing keys must
  not enter prompts, result projections, logs, errors, files, or durable replay
  records.

Read `mcp/README.md` before adding a product tool. Update
`conversation/README.md` before changing the hosted turn's application
responsibility. Update
`docs/hosted-execution.md` whenever supported workflows, trust ownership, or
deployment evidence changes.

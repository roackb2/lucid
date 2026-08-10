# Hosted execution

This application boundary lets Lucid act as an adopter control plane for an
external Heddle Execution Host without importing the private host repository.
It is deliberately separate from representative heartbeat execution, which
still runs in process and retains its PostgreSQL task and wake authorities.

## Services

| Path | Responsibility |
| --- | --- |
| `authority/` | Mint one short-lived execution assertion and one narrower MCP capability from product-authorized scope, and project public JWKS verification keys |
| `mcp/` | Independently verify the MCP capability and expose curated Lucid product tools over stateless Streamable HTTP |
| `host/` | Define Lucid's provider-neutral outbound execution port and validate the private host's direct-development HTTP/SSE contract |

The first supported product capability is the read-only
`read_workspace_snapshot` tool for a `conversation-turn`. A trusted,
product-authorized application service supplies tenant, subject, session, and
the fixed Lucid tool policy; untrusted or model-controlled input cannot choose
that authority or an MCP destination. Stateful
representative communication tools remain behind the wake-local runner until
an autonomous-task wire contract can preserve task claims, mailbox horizons,
action identities, and fenced settlement.

## Current integration state

The three boundaries and their focused conformance tests are implemented, but
ordinary Lucid server startup does not compose or expose them yet. In
particular, this slice does not load a deployment signing key, publish the JWKS
route, mount the MCP route, expose a participant conversation endpoint, or
invoke AgentCore. That wiring must land as one separately testable composition
so a partially configured credential path cannot appear enabled.

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
  types. Provider-specific transports implement the Lucid-owned port.
- Compact JWTs, model credentials, database URLs, and private signing keys must
  not enter prompts, result projections, logs, errors, files, or durable replay
  records.

Read each service-level README before changing its contract. Update
`docs/hosted-execution.md` whenever supported workflows, trust ownership, or
deployment evidence changes.

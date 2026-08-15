# Hosted product MCP

This service is Lucid's authenticated reverse boundary for the Heddle Execution
Host. It exposes product capabilities, not database CRUD, and independently
verifies the short-lived adopter-signed MCP bearer on every stateless request.

## Current capability

`read_workspace_snapshot` is the first honest conversation-turn capability. It
returns a user-scoped projection derived from Lucid's product UI state
and accepts no identity arguments. Its model-facing background-check fields are
deliberately explicit: `userChecksEnabled` is the user's durable
task preference, while `operatorDispatchEnabled` is the service-wide operator
gate. The raw workspace persistence field is omitted so a healthy
operator-paused state cannot appear contradictory. Tenant, subject, product
session, Runtime session, and invocation scope come only from the verified
capability.

The existing agent communication tools are intentionally absent.
They depend on a claimed wake, fixed event horizon, agent identity, action
budget, provenance checks, and idempotent mutation state. Exposing them as
ordinary stateless functions would weaken those invariants. They can move here
only after Lucid has a durable invocation-scoped port for that wake authority.

## Code boundary

The MCP endpoint has two deliberately separate layers. The Execution Host sees
only the tools registered by the product layer; HTTP and MCP lifecycle methods
are endpoint internals, not agent tools.

| Layer | Owner | Responsibility | Visible to the model |
| --- | --- | --- | --- |
| Generic MCP edge | `@heddleagent/execution-host-client/mcp/node` | Bearer extraction and redaction, capability verification, bounded JSON parsing, Streamable HTTP transport lifecycle, cancellation, safe protocol errors, and shutdown cleanup | No |
| Generic JSON tool registry | `@heddleagent/execution-host-client/mcp/node` | Capability admission, per-call lifetime checks, cancellation composition, safe failures, and JSON result projection | No |
| Lucid tool definitions | `product-tools.ts` | Exact tool names, descriptions, schemas, annotations, failure messages, and product operations | Yes |
| Lucid tool contract | `types.ts` | Fixed supported-tool union and product-owned projection ports | Only the registered tool schema |
| Lucid projection adapter | `workspace-projection-reader.ts` | Bind verified capability scope to that user's projection in the shared network | No |

`NodeStreamableHttpMcpService.handle()` and `.close()` are package-owned server
entrypoints. `createLucidProductToolset()` is Lucid's plug-in boundary: each
`defineNodeMcpJsonTool()` entry inside it is an actual capability made
available to the Execution Host. Currently that is only
`read_workspace_snapshot`. Helper methods inside the package service are MCP
server internals and are never model-visible tools.

`@heddleagent/execution-host-client/mcp` supplies the generic verifier for the dedicated
`heddle-mcp-capability+jwt` signature, issuer, audience, age, deployment
binding, and Lucid's fixed supported-tool set using JWKS.

## Security and maintenance rules

- Route this service only at the configured MCP path and only over HTTPS outside
  loopback development.
- Never log or persist the bearer. Signing keys stay in Lucid's authority
  service; the MCP edge receives only verification configuration and scrubs
  the bearer from both normalized and raw request headers before verification.
- Keep tool schemas free of tenant, user, session, invocation, agent, or wake
  selectors. Authorization comes from signed claims.
- Add a tool name to `LUCID_PRODUCT_MCP_TOOLS` only with an equally explicit
  registration and handler in `product-tools.ts`, a least-privilege input
  schema, and a product-owned port.
- Do not recreate package-owned HTTP parsing, bearer handling, capability
  lifetime checks, JSON result projection, or SDK transport cleanup in Lucid.
  Keep only product schemas, descriptions, and operations in
  `product-tools.ts`.
- `UserWorkspaceProjectionReader` derives the user solely from
  the verified capability subject. Keep tenant and product-session binding in
  deployment configuration; never accept any of those selectors as tool input.
- The Execution Host's allowlist is defense in depth. This endpoint must always
  verify and enforce the capability itself.

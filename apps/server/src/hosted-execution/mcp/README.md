# Hosted product MCP

This service is Lucid's authenticated reverse boundary for the Heddle Execution
Host. It exposes product capabilities, not database CRUD, and independently
verifies the short-lived adopter-signed MCP bearer on every stateless request.

## Current capability

`read_workspace_snapshot` is the first honest conversation-turn capability. It
returns the same participant-scoped projection used by Lucid's product UI and
accepts no identity arguments. Tenant, subject, product session, Runtime
session, and invocation scope come only from the verified capability.

The existing representative communication tools are intentionally absent.
They depend on a claimed wake, fixed event horizon, agent identity, action
budget, provenance checks, and idempotent mutation state. Exposing them as
ordinary stateless functions would weaken those invariants. They can move here
only after Lucid has a durable invocation-scoped port for that wake authority.

## Shape

- `capability-verifier.ts` verifies the dedicated
  `heddle-mcp-capability+jwt` signature, issuer, audience, age, deployment
  binding, and exact fixed tool allowlist using `jose` and JWKS.
- `service.ts` owns a stateless official-SDK Streamable HTTP server, bounded
  request parsing, safe errors, cancellation propagation, per-operation expiry
  checks, and SDK resource cleanup.
- `types.ts` defines verified invocation scope and the product projection port.
- `workspace-projection-reader.ts` binds the current singleton pilot workspace
  to one configured tenant, subject, and product-session identity.

## Security and maintenance rules

- Route this service only at the configured MCP path and only over HTTPS outside
  loopback development.
- Never log or persist the bearer. Signing keys stay in Lucid's authority
  service; the MCP edge receives only verification configuration and scrubs
  the bearer from both normalized and raw request headers before verification.
- Keep tool schemas free of tenant, user, session, invocation, agent, or wake
  selectors. Authorization comes from signed claims.
- Add a tool name to `LUCID_PRODUCT_MCP_TOOLS` only with an equally explicit
  registration, least-privilege input schema, and product-owned port.
- Do not use `SingleWorkspaceProjectionReader` for a multi-tenant deployment.
  Replace it with a projection store that resolves workspace identity from the
  verified scope and proves cross-tenant denial.
- The Execution Host's allowlist is defense in depth. This endpoint must always
  verify and enforce the capability itself.

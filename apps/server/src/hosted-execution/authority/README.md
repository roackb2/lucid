# Hosted execution authority

This service is Lucid's product-owned credential boundary for one hosted agent
invocation. It converts identity already authenticated and authorized by Lucid
into two short-lived, asymmetric credentials understood by the external Heddle
Execution Host.

## Owns

- the Lucid-owned `ExecutionAuthority` port and versioned authority types;
- a v1 `heddle-execution+jwt` assertion for starting one
  `conversation-turn` invocation;
- a separate v1 `heddle-mcp-capability+jwt` credential for the exact Lucid MCP
  server and raw tool aliases authorized for that invocation;
- ES256 signing through the mature `jose` implementation; and
- a stable public JWKS projection containing no private key material.

Execution and MCP credentials have distinct audiences and JWT IDs. Both bind
the adopter, tenant, authenticated subject, product session, Runtime session,
invocation, and workflow. The MCP credential additionally binds the fixed MCP
server and a small exact tool allowlist. Model-controlled input must never
choose any of these identity values.

`IssuedExecutionAuthority` keeps compact JWTs in private fields and exposes
them only through explicit accessors. JSON serialization includes
credential-free metadata, not bearer credentials. That metadata still contains
tenant, subject, session, and invocation identifiers, so structured logging
must follow product privacy and data-minimization policy. Callers must avoid
copying either credential into durable invocation results, traces, prompts,
filesystem state, child-process environments, or error messages.

## Composition requirements

Deployment composition must provide:

- an HTTPS issuer URL;
- one deployment-owned adopter ID;
- distinct execution-host and Lucid-MCP audiences;
- a fixed Lucid MCP server ID;
- execution and MCP lifetimes accepted by the deployed host;
- an ES256 private key loaded from deployment secret material;
- its matching public P-256 verification key; and
- a stable key ID.

`JoseExecutionAuthority.create()` proves that the supplied public and private
keys match before the service can mint credentials. The private key must not
enter source control, ordinary environment dumps,
Terraform state, logs, or the Execution Host. Rotation is additive: publish old
and new public keys while outstanding credentials can still exist, sign new
credentials with the new key ID, and remove the old public key only after its
last possible expiry. The current class projects one active key; a future key
ring adapter can implement the same port when rotation is exercised.

The HTTP adapter should expose `publicJwks()` at an unauthenticated, cacheable
HTTPS endpoint. That route publishes public verification material only. The
router and server composition are deliberately outside this service.

## Does not own

- request authentication or product authorization;
- tenant, subject, product-session, Runtime-session, or invocation creation;
- durable invocation uniqueness, replay prevention, cancellation, or results;
- MCP transport, tool argument policy, or product database access;
- AgentCore SigV4 invocation; or
- private-key loading and deployment-secret management.

The external host currently supports only `conversation-turn`; representative
heartbeat execution must not reuse this workflow label until a supported
autonomous-task wire contract exists.

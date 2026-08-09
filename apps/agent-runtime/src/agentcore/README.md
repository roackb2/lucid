# AgentCore HTTP adapter

This is the inbound adapter for AWS AgentCore Runtime's custom-container HTTP
contract and the matching local development client.

## Owns

- `/ping` and `/invocations` HTTP behavior;
- provider and local-only headers, Zod wire schemas, and safe API errors;
- local verifier authentication and sensitive-header redaction;
- ordered SSE framing, keepalives, disconnect propagation, and backpressure;
- translation from validated requests into `RuntimeSessionService` calls.

`types.ts` contains only transport contracts and the narrow configuration and
logger interfaces required by this adapter. It imports runtime-session values
but runtime-session code never imports this folder.

AgentCore's `Healthy` and `HealthyBusy` values are projected here from the
service's provider-neutral `idle` and `executing` states. AWS vocabulary must
not become application policy.

## Does not own

- tenant authorization or the authority to choose scope;
- session admission, deadlines, cancellation policy, or durable idempotency;
- Heddle engine/tool construction;
- PostgreSQL, Lucid domain operations, or deployment lifecycle.

Add a provider header, wire-version change, or streaming behavior here. Keep
product and session policy behind the injected service boundary. A second
transport should be a sibling adapter rather than conditionals in this one.

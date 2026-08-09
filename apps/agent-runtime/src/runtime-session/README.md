# Runtime session service

This is the application-service boundary for one process-bound hosted Heddle
session. It coordinates admission and lifecycle without knowing how HTTP is
served or how Heddle constructs a concrete engine.

## Owns

- immutable binding of runtime session, adopter, tenant, user, and conversation;
- one-active-turn admission and startup reservation;
- invocation deadlines, caller cancellation, and shutdown;
- bounded warm-process duplicate suppression; and
- provider-neutral idle/executing transitions.

`invocationId` is correlation plus suppression for the 128 most recently
completed turns. This service does not provide durable idempotency.

## Port and types

- `types.ts` contains transport-independent session values and results.
- `executor.ts` is the service-owned outbound `AgentTurnExecutor` port. Keep
  this port narrow; a concrete execution engine belongs in an adapter.
- `service.ts` depends only on that port and its local policy collaborators.
- `scope-binding.ts` and `status.ts` own focused session policies rather than
  transport or execution-engine concerns.

The service-owned stream contract contains only ordered activity and terminal
shapes. The Heddle adapter satisfies it structurally; Heddle types do not leak
into this application boundary.

## Does not own

- AgentCore headers, JSON validation, SSE framing, or ingress authentication;
- Heddle engine construction, model/tool policy, or provider configuration;
- product identity, authorization, PostgreSQL, task claims, or durable retry;
- deployment configuration or process signal handling.

Add admission, binding, cancellation, or session-lifecycle policy here. Add a
new execution technology by implementing `AgentTurnExecutor` in another
adapter; do not import that adapter back into this service.

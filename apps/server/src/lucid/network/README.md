# Participant network service

This slice owns trusted participant ingress, participant lifecycle, private
participant input, development diagnostics, and coordination with derived
representative tasks.

## Shape

- `service.ts` coordinates ingress and lifecycle changes with heartbeat task
  reconciliation.
- `store.ts` defines the participant-network storage port.
- `postgres-store.ts` implements registration, lifecycle, mailbox-floor, and
  diagnostics queries with Drizzle.
- `participant-visibility.ts` removes trusted-ingress identity and private
  context from product projections shared with the workspace slice.

Registration creates the participant, representative, initial mailbox floor,
and audit event in one transaction. Disable, resume, and retirement update the
participant, representative claim state, mailbox eligibility, and audit event
atomically. Stable registration and input idempotency keys are final database
concurrency authorities.

This slice does not expose private context through diagnostics and does not own
agent communication policy, model execution, or Heddle task persistence.

# User network service

This slice owns trusted user ingress, provider-subject identity
bindings, user lifecycle, private user input, development
diagnostics, and coordination with derived agent tasks.

## Shape

- `service.ts` coordinates ingress and lifecycle changes with heartbeat task
  reconciliation.
- `store.ts` defines the user-network and provider-identity storage ports.
- `postgres-store.ts` implements registration, lifecycle, mailbox-floor, and
  diagnostics queries with Drizzle.
- `user-visibility.ts` removes trusted-ingress identity and private
  context from product projections shared with the workspace slice.

Registration creates the user, agent, initial mailbox floor,
and audit event in one transaction. Disable, resume, and retirement update the
user, agent claim state, mailbox eligibility, and audit event
atomically. Stable registration and input idempotency keys are final database
concurrency authorities.

Authenticated enrollment binds the exact, case-sensitive `(issuer, subject)`
claims from an already verified provider token to one Lucid user. It
atomically creates the human user, agent, join mailbox floor,
identity binding, and join event. A retry returns the existing principal and
does not treat provider profile claims as a Lucid profile update. Provider
subjects and private context never enter events or product projections, and
email is never used as identity. One user has one provider binding in
this foundation; linking several providers is a separate account-recovery
policy, not implicit enrollment behavior. Authentication and token verification
remain at the HTTP edge; this slice accepts only their verified stable claims.

This slice does not expose private context through diagnostics and does not own
agent communication policy, model execution, or Heddle task persistence.

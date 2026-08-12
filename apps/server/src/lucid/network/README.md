# Participant network service

This slice owns trusted participant ingress, provider-subject identity
bindings, participant lifecycle, private participant input, development
diagnostics, and coordination with derived representative tasks.

## Shape

- `service.ts` coordinates ingress and lifecycle changes with heartbeat task
  reconciliation.
- `store.ts` defines the participant-network and provider-identity storage ports.
- `postgres-store.ts` implements registration, lifecycle, mailbox-floor, and
  diagnostics queries with Drizzle.
- `participant-visibility.ts` removes trusted-ingress identity and private
  context from product projections shared with the workspace slice.

Registration creates the participant, representative, initial mailbox floor,
and audit event in one transaction. Disable, resume, and retirement update the
participant, representative claim state, mailbox eligibility, and audit event
atomically. Stable registration and input idempotency keys are final database
concurrency authorities.

Authenticated enrollment binds the exact, case-sensitive `(issuer, subject)`
claims from an already verified provider token to one Lucid participant. It
atomically creates the human participant, representative, join mailbox floor,
identity binding, and join event. A retry returns the existing principal and
does not treat provider profile claims as a Lucid profile update. Provider
subjects and private context never enter events or product projections, and
email is never used as identity. One participant has one provider binding in
this foundation; linking several providers is a separate account-recovery
policy, not implicit enrollment behavior. Authentication and token verification
remain at the HTTP edge; this slice accepts only their verified stable claims.

This slice does not expose private context through diagnostics and does not own
agent communication policy, model execution, or Heddle task persistence.

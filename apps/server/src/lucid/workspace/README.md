# Discovery workspace service

This slice owns the local user's product commands and scoped read model:
saved interest, manual checks, findings, feedback, direct guidance, working
context, request progress, guidance follow-through, and the personal Agent's
bounded product-readable Activity history.

## Shape

- `service.ts` coordinates user commands with heartbeat triggers.
- `store.ts` defines the primary workspace store and the secondary
  `AgentWorkingContextReader` projection port consumed by wake
  orchestration.
- `postgres-store.ts` implements that port with workspace-owned Drizzle queries
  and projections.
- `agent-activity.ts` collapses durable events into one user-facing outcome per
  Agent wake and overlays only an unsettled current task state. Raw event text,
  task identifiers, and traces do not cross this boundary.
- `workspace-identity.ts` owns the stable identity of the current single
  product workspace.
- `service.test.ts` exercises the service against disposable PostgreSQL.

The PostgreSQL adapter may read all Lucid product tables when building the
user-scoped projection, but it must never return the global directory,
unrelated events, registration keys, or private context. Event horizons make
working context retry-stable. Feedback and guidance remain user facts;
the agent's later working-note revision is a separate event.
Legacy `finding_reported` rows marked with `metadata.noMatch` are quiet
completion facts rather than findings, so the PostgreSQL query excludes them
before applying the bounded finding window.
Agent Activity is likewise a bounded read model rather than an execution log:
the store scans only relevant events authored by the current user's Agent, and
the service may add the current running or attention state from Heddle without
exposing Heddle task vocabulary.
`recordCheckRequest` fixes the persisted kind to `check_requested`; the raw
event insert remains private to the adapter.

This slice does not own user registration/lifecycle, Heddle task state,
wake claim settlement, or communication-tool authorization.

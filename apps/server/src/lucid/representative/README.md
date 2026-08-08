# Representative wake service

This slice adapts Lucid participant/mailbox state to durable Heddle heartbeat
tasks. It owns global dispatch state, task reconciliation, fixed-horizon wake
claims, claim-fenced settlement, recovery, recipient routing, and shutdown.

## Shape

- `heartbeat-service.ts` coordinates Lucid wake semantics with Heddle tasks.
- `store.ts` defines the representative wake store.
- `postgres-store.ts` implements global state, claim, cursor, recovery, and
  settlement transactions.
- `mailbox-policy.ts` defines participant-authored event kinds visible to a
  representative.
- `heddle-runner.ts` runs one claimed context through Heddle.

Selection, horizon assignment, representative ownership, wake numbering, and
the wake-start event commit together. Completion advances the cursor only when
the caller still owns the exact claim token and horizon. Failure and
interruption retain unread work for a retry; lease recovery releases only the
matching interrupted execution.
`recordWakeCompletion` fixes the persisted kind to `agent_wake_completed`; the
raw event insert is not part of the wake port.

The heartbeat service receives its wake store plus the workspace-owned
`RepresentativeWorkingContextReader` secondary projection port, then assembles
the complete wake after the claim commits. The wake adapter never imports or
calls another concrete PostgreSQL adapter. Heddle continues to own task
scheduling, run requests, credentials, checkpoints, cancellation, and model
execution.

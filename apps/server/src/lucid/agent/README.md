# Lucid agent work service

This slice owns Lucid's durable work around one Coordinator execution. The
separate Heddle Coordinator is the sole scheduler and owns heartbeat task
definitions, cadence, due selection, Heddle claims, checkpoints, recovery, and
run settlement.

## Shape

- `work-service.ts` owns the product claim, fixed current-world horizon,
  optional mailbox input, scoped tool dispatch, required-effect validation,
  cursor advancement, product settlement, and downstream recipient triggers.
- `heartbeat-control.ts` defines product controls implemented by the
  Coordinator-backed adapter.
- `heartbeat-task-identity.ts` maps Lucid agents to stable Coordinator task IDs.
- `store.ts` defines the agent-work persistence port.
- `postgres-store.ts` implements product claims, cursors, recovery, effect
  validation, and settlement transactions through Drizzle.
- `mailbox-policy.ts` defines the event kinds visible to an agent.
- `communication/` owns the model-visible read and write policy for a claimed
  work horizon.

`AgentWorkClaim` is the public product vocabulary. Existing `AgentWake*` names
and `active_wake_*` columns are internal persistence details retained to avoid
an unrelated data migration; they are not a second scheduling authority.

## Execution lifecycle

1. The Coordinator chooses when a Heddle task attempt runs and supplies its
   claim-fenced `executionId`.
2. `AgentWorkService.claimWork()` atomically claims the corresponding Lucid
   agent and freezes the visible event horizon. A saved Interest is required
   only for a scheduled check with no unread input; new mailbox events remain
   independently actionable.
3. Heddle mints execution and heartbeat-only MCP authority for that exact
   execution.
4. Each MCP call resolves the active product claim from the verified user and
   `executionId`; the Runtime can read that claim's bounded working context,
   while tool arguments cannot select another user, agent, claim, or horizon.
5. `completeWork()` verifies mandatory durable product effects, including an
   explicit no-finding disposition for an empty-mailbox check, records the
   completion, advances the cursor only under the same execution fence, and
   asks the Coordinator to trigger affected recipient tasks.
6. Failure or interruption retains unread product work for a later
   Coordinator attempt.

The product service never polls time, calculates due tasks, acquires a Heddle
task lease, runs a model, or writes Heddle heartbeat tables. The Coordinator
never opens Lucid tables or decides whether Lucid's required product effects
exist.

Selection, horizon assignment, product ownership, work numbering, and the
work-start event commit together. Each model-requested mutation locks the agent
row and validates the work ID, execution ID, and work number in the same
transaction as its effect. Completion advances the cursor only when the caller
still owns the exact execution ID and horizon. Durable action keys use the
retry-stable work ID, so a replacement execution can reuse an already
committed effect without accepting a stale writer.

This split deliberately models a schedule as a durable opportunity to inspect
the current product world, not as a frozen Lucid command payload. Heddle decides
when the opportunity is due and makes its execution reliable. Lucid decides at
prepare time whether a current Interest exists, freezes the product horizon,
and owns the resulting Finding or no-finding Activity.

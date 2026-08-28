# Agent wake service

This slice owns Lucid user/mailbox state and the product-side wake contract.
The separate Heddle Coordinator owns durable heartbeat tasks, scheduling,
claims, recovery, checkpoints, and run settlement.

## Shape

- `heartbeat-control.ts` defines the product operations implemented by the
  coordinator-backed adapter.
- `heartbeat-task-identity.ts` maps Lucid agents to stable coordinator task IDs.
- `store.ts` defines the agent wake store.
- `postgres-store.ts` implements global state, claim, cursor, recovery, and
  settlement transactions.
- `mailbox-policy.ts` defines user-authored event kinds visible to a
  agent.

Selection, horizon assignment, agent ownership, wake numbering, and
the wake-start event commit together. Completion advances the cursor only when
the caller still owns the exact claim token and horizon. Failure and
interruption retain unread work for a retry; lease recovery releases only the
matching interrupted execution.
`recordWakeCompletion` fixes the persisted kind to `agent_wake_completed`; the
raw event insert is not part of the wake port.

Lucid no longer composes a scheduler or opens Heddle heartbeat tables. Product
lifecycle changes reconcile tasks through
`hosted-execution/heartbeat/agent-heartbeat-service.ts`, while one claimed run
returns scoped execution and MCP authority through the delegation endpoint.
State-changing communication and finding tools remain product-owned and must
cross that scoped MCP boundary before autonomous behavior reaches parity.

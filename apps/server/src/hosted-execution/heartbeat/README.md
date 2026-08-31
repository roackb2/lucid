# Hosted heartbeat execution lifecycle

This boundary connects Lucid product work to the separate Heddle Coordinator
without making either service depend on the other's database.

At server startup, Lucid projects its current users, agents, and workspace into
Heddle's desired-task vocabulary. Every task is assigned to Lucid's one opaque
background admission group. The public Execution Host client owns the
authenticated Coordinator calls, namespace pause/delete/upsert/resume ordering,
stale task replacement, input validation, and failure behavior. Retired users
are omitted, active users are enabled, and disabled users remain represented
but disabled. Catalog reconciliation always reopens the provider namespace;
Lucid's durable product gate independently closes or prepares its group.
Failed catalog reconciliation leaves the provider namespace paused and fails
startup.

Group resume is a durable cross-service transition. The Coordinator calls
`LucidBackgroundChecksAdmissionLifecycle.prepareResume()` with its stable
transition ID. Lucid commits its fresh mailbox boundary through
`prepareBackgroundChecksResume()` and returns `ready` only after that commit.
A running wake returns `retry`, leaving the group in provider-owned
`preparing`; a disabled product gate or foreign group returns `blocked`.
Snapshots report dispatch enabled only when the product gate is enabled, the
provider namespace is running, and the durable group phase is `ready`.

Every Lucid catalog, namespace, group-admission, and operator mutation runs
under one transaction-scoped PostgreSQL advisory lock. The lock spans the full
Coordinator control sequence so two API replicas cannot interleave catalog or
admission transitions during a rolling deployment. Both advisory-lock
acquisition and the remote Coordinator sequence have explicit timeouts; every
Coordinator call in one sequence receives the same bounded abort signal. A
process or database-session failure releases the advisory lock automatically.

Lock ordering is intentionally one-way. The advisory-lock transaction never
locks Lucid workspace rows. `prepareResume()` never acquires the advisory lock;
it may lock the workspace row through another pool connection while the
Coordinator is preparing the group. No Lucid path may acquire the workspace
row first and then request the advisory lock. This separation prevents an
inverse lock order while allowing the provider callback to durably prepare the
product boundary. The production pool must retain at least two connections so
the advisory-lock holder and resume callback can make progress independently.

For each claimed Heddle execution, the Coordinator calls Lucid twice:

1. `prepare` maps the task to a Lucid agent and asks `AgentWorkService` to claim
   one fixed product work horizon. An empty mailbox plus no saved Interest skips
   the model; mailbox input remains independently actionable, and a saved
   Interest makes an empty mailbox a current-world check. Claimed work returns
   only product scope and the exact heartbeat MCP tool allowlist. Provider
   recovery and replacement claim occur atomically while the workspace and
   agent rows are locked. A stale interrupted-execution ID returns no claim,
   while replay of the current execution returns the existing claim even if an
   operator paused admission after that execution began. Any new or transferred
   claim rechecks the product gate under the same transaction.
2. `settle` maps the narrow terminal execution result back to the same agent
   and execution fence. Lucid validates and commits product effects, asks for a
   retry, or accepts failure/interruption without consuming unread input.

Heddle owns Runtime-session identity, deadlines, execution/MCP authority
issuance, the lifecycle wire contract, bearer authentication, request bounds,
safe errors, and shutdown. The Coordinator sends only a persisted Heddle task
ID and its claim-fenced execution ID. It receives no user session, signing key,
Lucid database credential, or authority to query product tables. Its model
credential comes from the Coordinator deployment's secret store.

The implementations in this folder are:

- `desired-task-catalog.ts`: product state to desired Heddle tasks;
- `admission-lifecycle.ts`: provider resume transition to Lucid's idempotent
  fresh-mailbox preparation;
- `execution-lifecycle.ts`: task-to-agent mapping plus product-work preparation
  and settlement; and
- `agent-heartbeat-service.ts`: Lucid controls backed by the public
  Coordinator task API. It contains product projection and preference rules,
  not scheduling, claims, retries, or HTTP mechanics.

The two directions use distinct secrets:

- `LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN` authenticates Lucid's task and
  control calls to the Coordinator;
- `LUCID_HOSTED_HEARTBEAT_EXECUTION_TOKEN` authenticates the Coordinator's work
  preparation and settlement calls to Lucid.

Lucid has no embedded scheduler or direct Heddle heartbeat-table authority.
Its durable `AgentWorkClaim` is application data for one Coordinator attempt,
not another clock, queue, or due-task selector.

The desired task is therefore not a serialized snapshot of work to replay at
each interval. It expresses an ongoing assignment and cadence. Each due Heddle
execution asks Lucid to prepare against current product state, after which
Lucid either skips before model work because there is no Interest or claims one
bounded Interest check with optional mailbox input.

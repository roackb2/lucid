# PostgreSQL Heddle heartbeat task authority

This boundary implements Heddle's public `HeartbeatTargetedTaskStore` for
request-routed hosted workers. It persists framework-owned task state in the
PostgreSQL `heddle` schema while Lucid's participants, mailbox, findings, and
other product state remain in the separate `lucid` schema.

## Owns

- namespace-scoped task, checkpoint, and run-record persistence;
- exact task lookup without a global scan;
- row-locked run requests, claims, settlement, and recovery;
- denormalized execution fencing columns and configurable execution leases;
- rejection of late settlement after recovery or a newer claim;
- Heddle-projected create, update, enable, resume, trigger, delete, reconcile,
  and task/run view operations under the same database locks as execution;
- the checked-in PostgreSQL schema migration and real two-pool conformance
  suite.

Heddle's public `HeartbeatTaskStateProjector` owns every lifecycle transition.
The PostgreSQL adapter always projects from the latest row inside the same
transaction that writes it, so an execution cannot erase a newer run request
or operator update.

## Does not own

- participant identity, authorization, mailbox semantics, or agent findings;
- queue delivery, worker retries, visibility timeouts, or dispatch policy;
- authorization decisions, tenant quotas, or global Lucid pause policy;
- model execution or Heddle runtime state outside the task-store contract;
- schema migration during ordinary server startup.

Those concerns belong to Lucid's product/application composition or Heddle's
public runtime services. Operator mutations delegate every rule to the public
`HeartbeatTaskControlPolicy`, and task/run responses delegate to
`HeartbeatTaskViewProjector`; the adapter adds only atomic persistence.

## Persistence model

`heddle.heartbeat_tasks` stores one Heddle task JSON document and its latest
checkpoint. `namespace + task_id` is the authority key. Enabled state, status,
next-run time, execution ID, execution owner, and lease expiry are denormalized
only for atomic targeting and recovery. A database check requires every
running row to have a complete execution identity and lease, and every
non-running row to have none.

The database `namespace` isolates one hosted service or test fixture. Heddle's
`reconcileTasks({ namespace, ... })` uses a different concept: that argument is
a task-ID prefix inside the already isolated database namespace.

`heddle.heartbeat_run_records` stores immutable task snapshots and execution
outcomes. Execution IDs are unique within a namespace. Run records deliberately
do not have a foreign key to the current task row: Heddle's optional history
contract permits recording an immutable historical snapshot without first
creating a current task.

Every existing-task mutation uses `SELECT ... FOR UPDATE`. Competing claims
therefore serialize on one row, while different task IDs remain independent.
Create and namespace reconciliation additionally use a namespace-scoped
transaction advisory lock before locking catalog rows, so two API processes
cannot create the same generated ID or reconcile conflicting memberships.
Completion, failure, cancellation, skip, retry, and block verify both
execution ID and owner before writing. Checkpoint, successful task settlement,
and its run record commit in one transaction.

## Lease and recovery policy

`executionLeaseMs` is required when constructing
`PostgresHeartbeatTaskStore`. The host must set it longer than its maximum
bounded worker attempt. Heddle's current targeted-store contract does not have
a lease-renewal callback, so choosing a lease shorter than a legitimate worker
run would allow premature recovery.

Ordinary duplicate delivery never recovers or steals work; its atomic claim
returns `busy`. `recoverInterruptedTasks` recovers only rows whose persisted
lease has expired, locks them with `SKIP LOCKED`, and applies Heddle's canonical
recovery projection. Recovery is idempotent and every late writer remains
fenced afterward. The adapter does not run a hidden timer: the dispatcher or
operator control plane must invoke a bounded recovery pass after leases can
expire. A one-time startup pass made before expiry is not sufficient.

## Migration and certification

The standard checked-in PostgreSQL migration creates both the `lucid` and
`heddle` schemas. Generate and apply it as a deployment step:

```bash
yarn server:db:generate
LUCID_DATABASE_URL='postgresql://...' yarn server:db:migrate
```

Certify the adapter against a dedicated disposable PostgreSQL database:

```bash
LUCID_POSTGRES_TEST_URL='postgresql:///lucid_test' \
  yarn workspace @lucid/server vitest run \
  src/runtime/heartbeat/postgres/task-store.integration.test.ts
```

The suite uses independent connection pools and opaque random namespaces. It
validates shared task/checkpoint state, exact lookup, due-claim contention,
coalesced requests, claim-fenced settlement, lease recovery, stale-write
rejection, persisted run history, conflicting creation, atomic controls, safe
deletion, namespace reconciliation, projected views, and update/claim races.
Cleanup deletes only rows belonging to the scenario namespace; it never
creates or destroys the PostgreSQL database.

The adapter intentionally omits `subscribeToRunRequests`. Durable run-request
state is authoritative, and the hosted dispatcher owns low-latency delivery.
Long-lived scheduler deployments must retain a correctness poll fallback.

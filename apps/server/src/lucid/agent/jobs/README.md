# Agent jobs

This slice owns Lucid's durable definition of the work performed by a
representative Agent. A job describes product intent and schedule policy; it is
not a permanent Publisher or Consumer identity.

The first closed job kinds are:

- `interest-discovery`, which continues the existing user-owned Interest
  workflow; and
- `information-network-publishing`, which may turn job-owned publishing
  preferences into a public, source-backed Network Post.

## Ownership boundary

Lucid owns job identity, enablement, publishing direction, explicit run intent,
and the current product-side execution fence. Heddle owns the durable clock,
task claims, Runtime execution, and run history. Runtime and product-tool names
are deliberately not persisted here: the hosted lifecycle maps each closed job
kind to a code-owned, fail-closed capability policy.

`AgentJobService` is the application boundary. `AgentJobStore` names the
transactions it requires, and `PostgresAgentJobStore` owns their PostgreSQL
implementation. Other services depend on these ports rather than importing the
adapter.

The migration backfills one `interest-discovery` job per existing Agent, using
the Agent ID as the job ID so deployed task IDs remain stable. Agents created
after migrations must pass through `ensureInterestDiscoveryJob`; it is an
idempotent, deliberately narrow initializer rather than a general job-creation
API. Interest cadence remains owned by `LUCID_HEARTBEAT_INTERVAL_MS`: the SQL
migration seeds the application default because it cannot read process
configuration, then startup synchronizes the configured cadence before task
reconciliation. Repeated initialization preserves enablement, instructions,
and every other durable job field.

## Manual run lifecycle

`requestRunOnce` commits intent before the Coordinator is notified. At most one
request may be `requested` or `claimed` for a job, so repeated clicks coalesce.
A manual job can remain enabled in the Coordinator: a timer tick with no
pending request is rejected by Lucid before model execution.

New work is admitted only while Lucid's global background-work gate is open.
An exact interrupted claim may still transfer while paused so it can settle and
release its durable fence.

The run-request ID is the retry-stable work identity. `currentExecutionId` and
the Agent's `activeWakeClaimToken` rotate together when an exact interrupted
attempt is recovered. Settlement and interruption require both the job ID and
current execution token, so stale attempts cannot release or overwrite a newer
claim.

`runCount` and `lastRunAt` advance when fresh intent is first admitted. A
same-execution replay or exact interrupted-execution transfer retains those
values, so recovery does not appear as another product run.

An interruption returns an unpublished request to `requested`. A terminal
failure or a successful run that produced no Post consumes the request with a
truthful outcome; it does not silently request another paid execution.

## Agent-level serialization

Jobs share their representative Agent's existing active-work fields. The
adapter binds `activeJobId`, the stable request ID, and current execution token
in the same transaction. Consequently one Agent runs at most one Lucid job at
a time even if it owns several jobs. This is intentional for the controlled
pilot and can later be replaced by a separate job-claim relation without
changing product job identity.

Publishing preferences are private job input. Public Profile and Post
projections must not expose instructions, source guidance, or other private
policy text.

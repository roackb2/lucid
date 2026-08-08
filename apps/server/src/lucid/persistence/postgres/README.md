# Lucid PostgreSQL adapter

This directory owns Lucid's concrete PostgreSQL product adapter. Repository
ports stay beside the workspace, participant-network, representative-wake, and
agent-communication services that consume them. The shared adapter implements
all four because their durable invariants span the same product transaction
and append-only event history.

## Responsibilities

| File | Responsibility |
| --- | --- |
| `repository.ts` | Implements the service-owned ports with PostgreSQL transactions, row locks, read projections, and fenced wake recovery |
| `schema.ts` | Declares product tables and constraints in the `lucid` schema |
| `repository.integration.test.ts` | Runs the full adapter contract plus real multi-connection contention and reconnect checks |
| `repository-contract.test-support.ts` | Defines storage-independent behavior required of a complete Lucid adapter |
| `test-context.ts` | Adds Lucid initialization and destructive product reset to the neutral PostgreSQL test fixture |

The services receive different structural views of the adapter through
`composition/postgres-persistence.ts`. PostgreSQL driver, query-builder, and
transaction types do not leak into services, the Heddle runner, or tRPC. Do
not replace these ports with table-shaped CRUD repositories: participant
lifecycle, mailbox floors, event visibility, wake claims, and participant read
models deliberately cross table boundaries.

PostgreSQL now preserves atomic wake claims, monotonic event sequences, unique
idempotency keys, fixed horizons, attempt-level settlement fencing, and cursor
semantics across API processes. A retry keeps its semantic wake ID so tool
effects remain idempotent, but rotates `active_wake_claim_token`; completion,
failure, and interruption reject a stale token.
Ordinary product-repository initialization intentionally does not reset Lucid
wake claims because another process may still own them. Heddle lease recovery
supplies the interrupted execution ID to Lucid's fenced recovery operation, so
it can release only the matching product wake claim.

## PostgreSQL operational boundary

PostgreSQL uses the standard `lucid` schema for product state. Heddle task,
run-request, checkpoint, lease, and run-history state uses the separate
`heddle` schema through Heddle's released targeted-store contract and public
state/control projectors. Lucid does not copy Heddle's private file-store model
or use a filtered local store as a distributed lock.

The schema-neutral `PostgresDatabase` in
`../../../infrastructure/postgres/database.ts` defaults to `prepare: false`,
which is compatible with Supavisor transaction pooling. Use a direct
PostgreSQL connection for migrations and a pooled application connection at
runtime. Both URLs are secrets: pass them through environment configuration
and never log them.

Generate and apply checked-in PostgreSQL migrations with:

```bash
yarn server:db:generate
LUCID_DATABASE_URL='postgresql://...' yarn server:db:migrate
```

Runtime startup must not generate schemas or silently run shared-database
migrations. Apply migrations as a bounded deployment step before starting new
workers.

`LUCID_DATABASE_URL` is required. The composition uses both schemas through one
owned pool, an explicit Heddle namespace, and a lease longer than the bounded
worker attempt; see
`../../../runtime/heartbeat/postgres/README.md`. There is no runtime backend
selector or fallback database.

The full adapter contract requires a disposable real PostgreSQL database:

```bash
LUCID_POSTGRES_TEST_URL='postgresql:///lucid_test' yarn test
```

The product suite resets only the `lucid` product tables inside that database;
the heartbeat suite deletes only its opaque test namespaces. Together they
validate shared repository behavior, two-pool wake and task contention,
cross-process idempotency, lease recovery and fencing, non-stealing
initialization, and persistence after every client connection closes. The URL
is mandatory for server tests and never falls back to the runtime URL. Test
files run serially because they share fixed schema names.

## Data ownership

- `discovery_workspaces` identifies one local network generation, its
  monotonic wake number, and the internal global scheduler master state.
- `participants` stores the human or explicit synthetic subject represented,
  including a stable nullable registration key, lifecycle status,
  approved-context timestamp, and private background visible only to its own
  agent.
- `representative_agents` stores execution status, delivery cursor, mailbox
  floor, and the active wake's durable ID, number, and fixed event horizon.
- `discovery_events` is the append-only product and mailbox history. It has a
  nullable unique idempotency key for retry-safe agent side effects and a
  nullable `reply_to_sequence` for conversation routing. Content provenance is
  recorded separately in `metadata.sourceEventIds`.

The representative working note is also stored as an immutable discovery
event (`representative_note_updated`) rather than a mutable profile column.
The latest event is the current projection; older revisions remain inspectable.
Each revision records the claimed source horizon and uses one wake-stable
idempotency key. Queries for agent execution are bounded by event sequence so a
retry cannot observe its own post-horizon writes as new starting context.

The participant-facing guidance follow-through view is another read model, not
stored learning state. It selects the latest direct guidance or finding
feedback on the current assignment, the prior note or source finding, the
latest later working-note revision whose claimed horizon includes that
guidance, the latest manual check carrying its sequence, the shared request
replying to that check, and any finding whose reply thread includes that
request. Missing steps remain missing; the adapter never infers successful
understanding or usefulness.

The participant-facing request-progress view is also derived state. A response
whose event sequence is beyond the representative's durable cursor is pending
review. Once every delivered response is behind that cursor, the adapter checks
whether a participant-scoped finding cites the same request thread. The result
is either a reported finding or a completed review without one. The completion
timestamp comes from the persisted wake whose fixed horizon covered the latest
response; no confidence, relevance, or model-authored completion field is
stored.

Recent network-request history is a bounded read model over the same immutable
events, not a new table. For the latest `interest_saved` event, the adapter
orders later `check_requested` triggers, resolves the first persisted shared
request for each trigger, and derives its reply/finding outcome. It returns at
most five earlier published cycles, newest first. Guidance appears only when
its sequence was explicitly carried by that check. Scheduled wakes that did
not publish, unrelated traffic, and requests from older interests are omitted.

Direct guidance is an immutable `guidance_saved` event. It preserves the raw
participant instruction and references the note visible when it was entered;
the representative produces a separate `representative_note_updated` event.
This separation keeps participant intent distinct from the agent's
interpretation and requires no schema migration because event kind is stored as
validated text.

A participant answers "whose context and intent does this agent represent?"
A saved interest answers "what does the local user want the agent to notice
now?" and remains a private event rather than a participant field.

The mailbox floor is distinct from the delivery cursor. The cursor records
successfully processed mail; the floor enforces that a newly joined or resumed
participant cannot request messages from before its current eligibility
boundary. Renewed participant consent replaces `private_context` and
`context_consent_at` atomically with a text-free audit event. Retiring a
participant scrubs `private_context` but keeps its row and representative
identity for append-only historical attribution.

Neither adapter encrypts `private_context` at the application layer. The field is private because
ordinary product/diagnostic projections and agent visibility exclude it from
every non-owner, not because the underlying storage is cryptographically protected.
Trusted ingress may replace it through the participant-network port; it is never
part of the participant-scoped workspace snapshot.

## Relations

```text
discovery_workspaces 1 ── * participants
participants         1 ── 1 representative_agents
discovery_workspaces 1 ── * representative_agents
discovery_workspaces 1 ── * discovery_events

representative_agents.id   ──> logical Heddle task ID
discovery_events actor/target/reply ──> delivery and conversation references
discovery_events metadata source IDs  ──> content provenance references
```

Workspace and participant ownership use foreign keys. Event actor, recipient,
reply, and provenance identifiers remain append-only logical references
validated by the repository adapter. A reply determines which request should
receive a response; a source determines which earlier content was repeated or
used. Keeping them separate prevents delivery paths from being presented as
independent corroboration.

`participants.registration_key` is unique when present. The stable local user
uses `local-user`; dynamic callers provide their own idempotent namespace. The
internal UUID remains the mailbox and relation identity.

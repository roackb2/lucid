# Shared Lucid PostgreSQL model

This directory owns only the product schema, policy-free record codecs, and the
disposable real-PostgreSQL fixture shared by adapter tests. Concrete stores and
their Drizzle queries live beside the workspace, user-network,
agent-wake, agent-communication, and hosted-conversation services that own
those use cases.
This directory must never grow back into a central product repository.

## Responsibilities

| File | Responsibility |
| --- | --- |
| `schema.ts` | Declares product tables and constraints in the `lucid` schema |
| `records.ts` | Decodes and normalizes PostgreSQL records without owning queries or domain policy |
| `test-context.ts` | Constructs the five named stores over the disposable PostgreSQL fixture |

The services receive narrow store ports through
`composition/postgres-persistence.ts`. PostgreSQL driver, query-builder, and
transaction types do not leak into services, the Heddle runner, or tRPC. Do
not replace these ports with table-shaped CRUD stores: user lifecycle,
mailbox floors, event visibility, wake claims, and user read models
deliberately cross table boundaries within their owning service-local adapter.

The cross-store behavioral and contention suite lives at
`../../../composition/postgres-persistence.integration.test.ts`. Service tests
remain beside their services. Tests address the owning stores by name rather
than reconstructing a central product repository. See
[`../../../../../../docs/coding-conventions.md`](../../../../../../docs/coding-conventions.md)
for the required Hexagonal Architecture and test shape.

PostgreSQL now preserves atomic wake claims, monotonic event sequences, unique
idempotency keys, fixed horizons, attempt-level settlement fencing, and cursor
semantics across API processes. A retry keeps its semantic wake ID so tool
effects remain idempotent, but rotates `active_wake_claim_token`; completion,
failure, and interruption reject a stale token.
Ordinary product-store initialization intentionally does not reset Lucid
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

A newly initialized workspace starts with background checks disabled. This is
the cost-safe deployment default; an authenticated operator must explicitly
resume agent work. The migration changes only the database default
and does not overwrite the preference of an existing workspace.

The full cross-store contract requires a disposable real PostgreSQL database:

```bash
LUCID_POSTGRES_TEST_URL='postgresql:///lucid_test' yarn test
```

The product suite resets only the `lucid` product tables inside that database;
the heartbeat suite deletes only its opaque test namespaces. Together they
validate shared store behavior, two-pool wake and task contention,
cross-process idempotency, lease recovery and fencing, non-stealing
initialization, and persistence after every client connection closes. The URL
is mandatory for server tests and never falls back to the runtime URL. Test
files run serially because they share fixed schema names.

## Data ownership

- `discovery_workspaces` identifies one local network generation, its
  monotonic wake number, and the internal global scheduler master state.
- `users` stores the human or explicit synthetic subject represented,
  including a stable nullable registration key, lifecycle status,
  approved-context timestamp, and private background visible only to its own
  agent.
- `agents` stores execution status, delivery cursor, mailbox
  floor, and the active wake's durable ID, number, and fixed event horizon.
- `discovery_events` is the append-only product and mailbox history. It has a
  nullable unique idempotency key for retry-safe agent side effects and a
  nullable `reply_to_sequence` for conversation routing. Content provenance is
  recorded separately in `metadata.sourceEventIds`.
- `hosted_conversation_turns` is the field-bounded user-facing projection of
  direct hosted questions. The product query exposes the newest 20 per user.
  It stores public terminal Markdown and lifecycle status, not execution
  activity, credentials, traces, hidden reasoning, or tool data.

The agent working note is also stored as an immutable discovery
event (`agent_note_updated`) rather than a mutable profile column.
The latest event is the current projection; older revisions remain inspectable.
Each revision records the claimed source horizon and uses one wake-stable
idempotency key. Queries for agent execution are bounded by event sequence so a
retry cannot observe its own post-horizon writes as new starting context.

The user-facing guidance follow-through view is another read model, not
stored learning state. It selects the latest direct guidance or finding
feedback on the current assignment, the prior note or source finding, the
latest later working-note revision whose claimed horizon includes that
guidance, the latest manual check carrying its sequence, the shared request
replying to that check, and any finding whose reply thread includes that
request. Missing steps remain missing; the workspace store never infers
successful understanding or usefulness.

The user-facing request-progress view is also derived state. A response
whose event sequence is beyond the agent's durable cursor is pending
review. Once every delivered response is behind that cursor, the workspace
store checks whether a user-scoped finding cites the same request thread.
The result is either a reported finding or a completed review without one. The
completion timestamp comes from the persisted wake whose fixed horizon covered
the latest response; no confidence, relevance, or model-authored completion
field is stored.

Recent network-request history is a bounded read model over the same immutable
events, not a new table. For the latest `interest_saved` event, the workspace
store orders later `check_requested` triggers, resolves the first persisted
shared request for each trigger, and derives its reply/finding outcome. It
returns at most five earlier published cycles, newest first. Guidance appears
only when its sequence was explicitly carried by that check. Scheduled wakes
that did not publish, unrelated traffic, and requests from older interests are
omitted.

Direct guidance is an immutable `guidance_saved` event. It preserves the raw
user instruction and references the note visible when it was entered;
the agent produces a separate `agent_note_updated` event.
This separation keeps user intent distinct from the agent's
interpretation and requires no schema migration because event kind is stored as
validated text.

A user answers "whose context and intent does this agent represent?"
A saved interest answers "what does the local user want the agent to notice
now?" and remains a private event rather than a user field.

The mailbox floor is distinct from the delivery cursor. The cursor records
successfully processed mail; the floor enforces that a newly joined or resumed
user cannot request messages from before its current eligibility
boundary. Renewed user consent replaces `private_context` and
`context_consent_at` atomically with a text-free audit event. Retiring a
user scrubs `private_context` but keeps its row and agent
identity for append-only historical attribution.

No Lucid product store encrypts `private_context` at the application layer. The
field is private because ordinary product/diagnostic projections and agent
visibility exclude it from every non-owner, not because the underlying storage
is cryptographically protected. Trusted ingress may replace it through the
user-network port; it is never part of the user-scoped workspace
snapshot.

## Relations

```text
discovery_workspaces 1 ── * users
users         1 ── 1 agents
discovery_workspaces 1 ── * agents
discovery_workspaces 1 ── * discovery_events
discovery_workspaces 1 ── * hosted_conversation_turns
users                 1 ── * hosted_conversation_turns

agents.id   ──> logical Heddle task ID
discovery_events actor/target/reply ──> delivery and conversation references
discovery_events metadata source IDs  ──> content provenance references
```

Workspace and user ownership use foreign keys. Event actor, recipient,
reply, and provenance identifiers remain append-only logical references
validated by the owning store adapter. A reply determines which request should
receive a response; a source determines which earlier content was repeated or
used. Keeping them separate prevents delivery paths from being presented as
independent corroboration.

`users.registration_key` is unique when present. The stable local user
uses `local-user`; dynamic callers provide their own idempotent namespace. The
internal UUID remains the mailbox and relation identity.

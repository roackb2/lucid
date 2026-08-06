# Lucid SQLite infrastructure

This directory owns Lucid's concrete single-process SQLite setup. It is
infrastructure, not the delegated-discovery domain.

## Responsibilities

| File | Responsibility |
| --- | --- |
| `sqlite-database.ts` | Opens and closes SQLite, applies durability pragmas, and runs migrations |
| `sqlite-discovery-repository.ts` | Implements the async `DiscoveryRepository` port with SQLite and Drizzle |
| `schema.ts` | Declares persisted tables, indexes, and database constraints |

`LucidSqliteDatabase` is deliberately not named a service or repository. It
owns the lifetime and configuration of one SQLite resource. Domain
repositories own data access and transactional behavior.

The port is asynchronous even though `better-sqlite3` performs synchronous
local I/O. A PostgreSQL adapter can therefore use a conventional async driver
without changing `DiscoveryWorkspaceService`,
`RepresentativeAgentHeartbeatService`,
`HeddleRepresentativeAgentRunner`, or tRPC.

Replacing the adapter is not the same as making Lucid distributed. A remote
adapter must preserve atomic wake claims, monotonic event sequences, unique
idempotency keys, and cursor semantics. Multi-host scheduling additionally
requires leased task ownership outside the current file-backed Heddle
scheduler.

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

SQLite does not encrypt `private_context` at rest. The field is private because
ordinary product/diagnostic projections and agent visibility exclude it from
every non-owner, not because the database file is cryptographically protected.
Trusted ingress may replace it through the repository contract; it is never
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

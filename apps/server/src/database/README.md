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

- `discovery_workspaces` identifies one local workspace generation, its
  monotonic wake number, and the durable global background-check preference.
- `participants` stores the human or explicit synthetic subject represented,
  including lifecycle status, approved-context timestamp, and private
  background visible only to its own agent.
- `representative_agents` stores execution status, delivery cursor, mailbox
  floor, and the active wake's durable ID, number, and fixed event horizon.
- `discovery_events` is the append-only product and mailbox history. It has a
  nullable unique idempotency key for retry-safe agent side effects.

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
ordinary repository projections and agent visibility exclude it from every
non-owner, not because the database file is cryptographically protected. A
dedicated localhost operator query may retrieve one assisted participant's
text for explicit review and is not part of the workspace snapshot.

## Relations

```text
discovery_workspaces 1 ── * participants
participants         1 ── 1 representative_agents
discovery_workspaces 1 ── * representative_agents
discovery_workspaces 1 ── * discovery_events

representative_agents.id   ──> logical Heddle task ID
discovery_events actor/target/source ──> delivery and causal references
```

Workspace and participant ownership use foreign keys. Event actor, recipient,
and causal identifiers remain append-only logical references validated by the
repository adapter.

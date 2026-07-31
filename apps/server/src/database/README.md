# Lucid SQLite infrastructure

This directory owns Lucid's concrete single-process SQLite setup. It is
infrastructure, not the delegated-discovery domain.

## Responsibilities

| File | Responsibility |
| --- | --- |
| `sqlite-database.ts` | Opens and closes SQLite, creates the parent directory, applies durability pragmas, exposes the Drizzle handle, and runs migrations |
| `schema.ts` | Declares the persisted tables, indexes, and database-level constraints |

`LucidSqliteDatabase` is deliberately not named a service or repository. It
owns the lifetime and configuration of one SQLite resource. Domain
repositories own data access and behavior; currently that responsibility
belongs to `../lucid/discovery-event-repository.ts`.

## Data ownership

- `discovery_workspaces` identifies one local product workspace and its current
  generation.
- `participants` stores the people or explicit synthetic fixtures represented
  in the workspace, including private background available only to their own
  agent.
- `representative_agents` stores the execution identity and durable delivery
  cursor for the agent assigned to each participant.
- `discovery_events` is the append-only product and communication history.
  Saved interests, messages, findings, feedback, lifecycle events, and errors
  are event kinds.

A participant is not a saved search or interest. The participant answers
"whose context and intent does this agent represent?" A saved interest answers
"what does the local user want the agent to notice now?" and is currently a
private `interest_saved` event. This keeps changing user input in the event
history instead of overwriting the participant's stable private context.

Do not add a first-class interest table until the product needs independently
addressable interest lifecycle such as multiple active interests, scheduling,
pause/resume, or per-interest delivery state.

## Relations

```text
discovery_workspaces 1 ── * participants
participants         1 ── 1 representative_agents
discovery_workspaces 1 ── * representative_agents
discovery_workspaces 1 ── * discovery_events

representative_agents.conversation_id ──> Heddle session storage
discovery_events actor/target/source     ──> logical delivery and causality
```

The schema uses foreign keys for workspace and participant ownership.
Event actor, recipient, and source identifiers remain logical references in
the append-only ledger and are validated by `DiscoveryEventRepository`.

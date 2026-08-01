# Lucid delegated-discovery domain

This directory owns delegated discovery for one local user across
representative agents. It is separate from tRPC transport and from SQLite's
concrete lifecycle.

## File and service responsibilities

| File | Responsibility |
| --- | --- |
| `discovery-workspace-service.ts` | Coordinates user actions across repository and heartbeat boundaries |
| `representative-agent-heartbeat-service.ts` | Reconciles one Heddle task per agent, claims mailbox wakes, and owns scheduler lifecycle |
| `heddle-representative-agent-runner.ts` | Executes one claimed wake with a Heddle checkpoint and Lucid tools |
| `discovery-repository.ts` | Defines the async storage-independent domain port |
| `agent-communication-tools.ts` | Validates bounded mailbox and finding operations |
| `agent-prompts.ts` | Builds representative identity and readable wake prompts |
| `default-participants.ts` | Defines the local user and explicit simulated fixtures |
| `discovery-types.ts` | Defines persisted records and API projections |
| `discovery-repository.test.ts` | Verifies visibility, claims, idempotency, and recovery |
| `agent-communication.test.ts` | Verifies prompts, tool policy, sources, and action budgets |
| `representative-agent-heartbeat-service.test.ts` | Verifies task routing, pause, restart, run-now, and empty wakes |

Names should state an engineering responsibility. `Wake` is used only for one
claimed heartbeat execution; `task`, `mailbox`, `event`, `finding`, and
`participant` retain their ordinary infrastructure meanings.

## Domain records

| Record | Meaning |
| --- | --- |
| `DiscoveryWorkspace` | One local product workspace and reset generation |
| `Participant` | The human or explicit synthetic subject whose private context an agent represents |
| `Agent` | The executable representative, status, unread cursor, and optional active wake |
| `DiscoveryEvent` | Append-only input, communication, result, feedback, and lifecycle history |

The current schema enforces one representative per participant. Interests
remain events. Introduce a first-class interest entity only when the product
needs multiple independently scheduled or paused interests.

## Ownership boundary

Lucid owns:

- participant and representative identity;
- mailbox visibility and append-only events;
- private interest and feedback delivery;
- atomic wake claims with a fixed unread-event horizon;
- the two-action budget for each wake;
- one representative contribution per causal thread across later wakes;
- finding validation against visible peer-authored messages;
- causal projections of what the user agent shared;
- durable cursors and action idempotency keys.

Heddle owns:

- durable task schedules, checkpoints, and run records;
- due-task selection and the local scheduler loop;
- model and tool execution;
- heartbeat decisions, retry state, and provider authentication.

`DiscoveryRepository` never reads Heddle files.
`HeddleRepresentativeAgentRunner` never decides visibility or cursor
advancement. `RepresentativeAgentHeartbeatService` is the integration boundary
that coordinates both without merging their persistence models.

## Mailbox and heartbeat lifecycle

1. A user action appends an ordinary-language event. Saving an interest and
   feedback targets the user's representative.
2. The recipient's Heddle task is moved to due state. Every task also retains
   its normal periodic schedule.
3. Heddle selects the task. Lucid atomically claims visible events after the
   agent's cursor and freezes the highest visible sequence as this wake's
   horizon.
4. The runner receives participant context, those events, its prior Heddle
   checkpoint, and only Lucid communication tools.
5. Communication actions append events with keys
   `<wake-id>:action:<slot>`. A retry of the same wake cannot duplicate an
   already persisted action.
6. A successful Heddle result appends one completion event and advances the
   cursor to the original horizon. Events created during execution remain
   unread for their own recipients.
7. Agents with newly visible mail are accelerated. This produces interaction
   without a hard-coded user/source/user route.

An empty scheduled task does not claim a wake or call the model. It saves a
lightweight Heddle idle result and returns to its interval.

`Run now` appends a private `check_requested` event containing the current
interest and accelerates unread agents. The user representative must treat the
event as a new causal thread and issue a fresh minimal request even when the
interest text is unchanged. It uses the same lifecycle.

## Messages and findings

Agents do not invoke one another's Heddle runtime. They communicate by appending
serialized mailbox events:

- `post_shared_message` reaches every other representative;
- `send_direct_message` reaches one representative and the operator;
- `report_finding` is available only to the user's representative and must
  cite at least one visible peer message;
- `finish_without_action` records an internal outcome but never fabricates a
  user-facing no-match finding.

Shared messages may wake other sources, but they cannot produce an unbounded
reply loop: a representative may take up to two communication actions in its
first wake for a causal thread, then later wakes in that same thread can only
read or finish without action. A new interest, explicit check request, or
feedback event starts a new thread.

`source_event_ids` and `parentSequence` preserve causal delivery. They do not
certify truth or usefulness.

## Recovery and lifecycle

Failed, interrupted, or escalated wakes keep their cursor and active wake
fields. A retry reuses the same wake ID, number, event horizon, and action
slots. Repository startup releases stale agent `running` status. Heartbeat
startup changes stale Heddle tasks from `running` to `waiting` and makes them
immediately due.

Pause and reset first abort active model work, then wait until Heddle has
finished writing its outer task state. Only then are task files disabled or
deleted. Shutdown aborts the scheduler and waits for the same ordering before
SQLite closes.

The file-backed Heddle scheduler is a single-host primitive without distributed
leases. A hosted multi-replica version needs a durable queue or workflow
executor; a PostgreSQL repository adapter alone is insufficient.

## Simulated participants

The music maker and product researcher are explicit local fixtures. Their
private context is hidden from the user's representative but is never presented
as a real person, external source, or product validation.

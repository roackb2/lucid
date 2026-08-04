# Lucid delegated-discovery domain

This directory owns delegated discovery for one local user across
representative agents. It is separate from tRPC transport and from SQLite's
concrete lifecycle.

## File and service responsibilities

| File | Responsibility |
| --- | --- |
| `discovery-workspace-service.ts` | Coordinates user actions across repository and heartbeat boundaries |
| `representative-agent-heartbeat-service.ts` | Reconciles one Heddle task per agent, claims mailbox wakes, and owns scheduler lifecycle |
| `heddle-representative-agent-runner.ts` | Builds one claimed wake's prompt and tools, then delegates execution through Heddle's context |
| `discovery-repository.ts` | Defines the async storage-independent domain port |
| `agent-communication-tools.ts` | Validates bounded mailbox and finding operations |
| `agent-prompts.ts` | Builds representative identity and readable wake prompts |
| `assisted-participant-profile.ts` | Builds the maintained agent profile for operator-assisted real participants |
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
- participant consent, explicit context review/replacement,
  active/disabled/retired lifecycle, and context removal;
- mailbox visibility and append-only events;
- private interest and feedback delivery;
- atomic wake claims with a fixed unread-event horizon;
- the two-action budget for each wake;
- one representative contribution per causal thread across later wakes;
- finding validation against visible peer-authored messages;
- causal projections of what the user agent shared;
- durable cursors, mailbox eligibility floors, and action idempotency keys.

Heddle owns:

- durable task schedules, checkpoints, and run records;
- due-task selection, bounded concurrency, and the local scheduler lifecycle;
- model and tool execution through `HeartbeatExecutionContext.runAgent()`;
- credentials, unattended approvals, cancellation, checkpoint continuation,
  heartbeat decisions, and retry state;
- durable, coalesced prompt-run requests and non-agent skipped outcomes.

`DiscoveryRepository` never reads Heddle files.
`HeddleRepresentativeAgentRunner` never decides visibility or cursor
advancement. `RepresentativeAgentHeartbeatService` is the integration boundary
that coordinates both without merging their persistence models.

## Mailbox and heartbeat lifecycle

1. A user action appends an ordinary-language event. Saving an interest and
   feedback targets the user's representative.
2. Lucid requests a durable task run. Heddle coalesces repeated requests made
   while the recipient is busy into one follow-up generation. Every task also
   retains its normal periodic schedule.
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

An empty scheduled task does not claim a wake or call the model. Lucid returns
`context.skip()`, so Heddle records a lightweight non-agent run without
fabricating a model checkpoint.

`Run now` appends a private `check_requested` event containing the current
interest and accelerates unread agents. The user representative must treat the
event as a new causal thread and issue a fresh minimal request even when the
interest text is unchanged. It uses the same lifecycle.

## Assisted participant lifecycle

The operator can add one real participant using ordinary-language context only
after confirming that the person knowingly approved its use in this local
experiment. Lucid creates the participant, representative agent, and Heddle
task through the same repository and heartbeat path as the built-in fixtures.
No account, invitation, or second runtime is involved.

The normal discovery snapshot never projects private context. A dedicated
local-operator query returns one assisted participant's text only while the
explicit review dialog is open. Replacing it requires renewed consent, records
a `participant_context_updated` audit event without the text, and settles any
active model run before the new context becomes authoritative. Withdrawing the
participant uses the existing irreversible retirement path to stop their task
and scrub the text.

Each representative has both a processed-message cursor and a mailbox floor.
The floor is the earliest event the participant is eligible to read, even if a
model tool asks for an older sequence. It starts at the join boundary and moves
forward when a participant is re-enabled, so neither pre-join nor paused-period
messages can be recovered by requesting `after_sequence: 0`.

- `active` participants receive new mail and have an enabled task when global
  background checks are enabled;
- `disabled` participants have no active wake, an off task, and receive no mail;
- re-enabling advances the mailbox floor before scheduling future work;
- `retired` participants lose private context permanently and their task is
  deleted, while identity and prior non-sensitive event attribution remain.

When an assisted real source and simulated fixtures are active together, the
product exposes one domain command that cancels and pauses every fixture task.
Heddle settles only those representatives, so real sources keep running while
Lucid prevents later findings from silently mixing in synthetic messages. The
global background-check preference does not change.

Repository participant status and the workspace's global background-check
setting are authoritative. Task reconciliation is idempotent and repairs the
file-backed Heddle task set without treating a live task as a restart artifact.

## Messages and findings

Agents do not invoke one another's Heddle runtime. They communicate by appending
serialized mailbox events:

- `post_shared_message` reaches every other representative;
- `send_direct_message` reaches one representative and the operator;
- `report_finding` is available only to the user's representative, must cite at
  least one visible peer message, and describes a possible connection without
  declaring it useful, validated, or a successful match;
- `finish_without_action` records an internal outcome but never fabricates a
  user-facing no-match finding.

Shared messages may wake other sources, but they cannot produce an unbounded
reply loop: a representative may take up to two communication actions in its
first wake for a causal thread, then later wakes in that same thread can only
read or finish without action. A new interest, explicit check request, or
feedback event starts a new thread.

`source_event_ids` and `parentSequence` preserve causal delivery. They do not
certify truth or usefulness. The UI labels each source as assisted real,
simulated, or mixed and leaves the value judgment to user feedback.

## Recovery and lifecycle

Failed, interrupted, or escalated wakes keep their cursor and active wake
fields. A retry reuses the same wake ID, number, event horizon, and action
slots. Repository startup releases stale agent `running` status. Heddle's
claim-fenced recovery API changes stale tasks from `running` to `waiting` and
makes them immediately due before Lucid reconciles current task configuration.

Global pause, reset, and shutdown use the awaitable Heddle scheduler handle to
cancel active model work and wait for claim-fenced outer task settlement before
changing SQLite or closing it. Participant disable, context replacement, and
retirement use Heddle 5.8 task-scoped cancellation instead: queued admission is
invalidated, a locally owned execution is aborted, and claim-fenced settlement
finishes before Lucid changes participant state. A `not-owned` or `not-found`
result blocks that domain mutation because another execution could still retain
old private context. Unrelated representatives remain admitted and running.

Lucid constructs one `FileHeartbeatTaskService` and supplies that exact store to
the scheduler. The same instance therefore owns task creation, recovery, run
requests, claims, cancellation classification, and settlement. `stateRoot`
remains separate runtime configuration for Heddle's agent checkpoints and
credentials.

Independent representatives may execute concurrently, bounded by
`LUCID_HEARTBEAT_MAX_CONCURRENCY` (default `3`). Each individual wake still
limits tool concurrency to one because its action budget and causal writes are
ordered.

The file-backed Heddle scheduler is a single-host primitive without distributed
leases. A hosted multi-replica version needs a durable queue or workflow
executor; a PostgreSQL repository adapter alone is insufficient.

## Simulated participants

The music maker and product researcher are explicit local fixtures. Their
private context is hidden from the user's representative but is never presented
as a real person, external source, or product validation.

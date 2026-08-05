# Lucid delegated-discovery domain

This directory owns participant identity, mailboxes, findings, and the bridge
to durable representative execution. It is separate from tRPC transport,
SQLite's concrete lifecycle, the React product projection, and development
simulation scenarios.

## Service boundaries

| File | Responsibility |
| --- | --- |
| `discovery-workspace-service.ts` | Coordinates the local participant's saved interest, run requests, feedback, durable listening preference, and scoped snapshot |
| `participant-network-service.ts` | Coordinates trusted participant registration/input, lifecycle, Heddle task reconciliation, reset, and development diagnostics |
| `representative-agent-heartbeat-service.ts` | Reconciles one Heddle task per representative, claims mailbox wakes, accelerates unread agents, and owns scheduler lifecycle |
| `heddle-representative-agent-runner.ts` | Builds one claimed wake's prompt/tools and delegates execution through Heddle's context |
| `discovery-repository.ts` | Defines the asynchronous storage-independent domain port |
| `agent-communication-tools.ts` | Enforces visible sources, fixed horizons, encountered-peer addressing, action budgets, and idempotent communication/working-note writes |
| `agent-prompts.ts` | Builds generic representative identity plus bounded longitudinal wake context |
| `representative-profile.ts` | Builds the generic representative profile for dynamically registered participants |
| `local-participant.ts` | Defines only the stable local participant and representative identity |
| `discovery-types.ts` | Defines persisted records, scoped product views, and development diagnostics |

Names describe engineering responsibilities. `Wake` means one claimed
heartbeat execution; `task`, `mailbox`, `event`, `finding`, and `participant`
retain their ordinary infrastructure meanings.

## Product view versus network operations

`DiscoveryWorkspaceService.snapshot()` is the user-facing projection. It
contains only:

- the local participant and representative;
- that participant's current interest, private working note, and findings;
- source attribution attached to those findings;
- that representative's Heddle task status.

It never returns the global participant list, agent list, event log, private
context, registration keys, or unrelated task state.

`ParticipantNetworkService.diagnostics()` is a world-wide developer
projection. The tRPC layer exposes it only through the loopback-only
`development` router. This is a local trust boundary, not a substitute for
authentication in a deployed service.

## Domain records

| Record | Meaning |
| --- | --- |
| `DiscoveryWorkspace` | One local network generation and global scheduler master state |
| `Participant` | A human or explicit synthetic principal with stable registration identity and private context |
| `Agent` | The executable representative, delivery cursor, and optional active wake |
| `DiscoveryEvent` | Append-only principal input, communication, result, feedback, and lifecycle history |
| `RepresentativeWorkingContext` | Bounded principal input, prior findings/feedback, and the latest derived working note at one event horizon |

Every participant has one representative. Every representative can receive its
principal's changing private input and report findings to that same principal.
The current web app shows only the local participant, but the storage and
execution model is symmetric.

## Ownership

Lucid owns:

- participant/representative identity and registration idempotency;
- human context consent and participant lifecycle;
- private principal input and mailbox visibility;
- atomic wake claims with one fixed unread-event horizon;
- mailbox floors for join and lifecycle boundaries;
- a two-action budget per wake;
- one representative contribution per principal-initiated causal thread;
- direct addressing only to active peers encountered through visible delivery;
- findings backed by visible peer-authored messages;
- participant-scoped findings, feedback, and source attribution;
- participant-scoped longitudinal context and a replaceable ordinary-language
  working note derived from immutable history;
- durable cursors and event/action idempotency keys.

Heddle owns:

- durable task schedules, enabled state, checkpoints, and run records;
- due-task selection, coalesced run requests, and bounded concurrency;
- model/tool execution through `HeartbeatExecutionContext.runAgent()`;
- credentials, unattended approvals, cancellation, and retry state;
- claim-fenced task settlement and interrupted-task recovery;
- non-agent skipped outcomes for empty scheduled mailboxes.

The development simulator owns scenario characters and input timing. No domain
module imports simulator scenarios.

## Registration and private input

Network ingress uses a caller-provided `registrationKey`. Reusing the same key
with the same kind, name, and private context returns the original participant;
reusing it with a conflicting profile fails. Participant identity,
representative identity, join mailbox floor, and a text-free audit event are
created in one SQLite transaction.

Human registration and later context replacement require explicit approval.
Synthetic registration is explicitly labelled and requires no fictional
consent. Private context is excluded from normal product and diagnostic
projections.

`saveParticipantInput()` appends a private `participant_input` addressed only
to that participant's representative before requesting a Heddle run. If the
process fails after persistence but before the run request, the unread mailbox
remains recoverable by startup or a later trigger.

## Mailbox and heartbeat lifecycle

1. Principal input or peer communication is appended durably.
2. Lucid requests the recipient's Heddle task. Requests while busy coalesce
   into a follow-up generation.
3. Heddle selects the task. Lucid atomically claims currently visible unread
   events and freezes the highest sequence as the wake horizon.
4. The runner receives private context, claimed events, bounded prior
   findings/feedback, the latest working note, Heddle continuation, and only
   Lucid communication tools.
5. Communication writes use `<wake-id>:action:<slot>`, so a retry cannot
   duplicate a committed side effect.
6. Successful execution appends completion and advances the cursor only to the
   original horizon. Later mail remains unread.
7. Newly addressed representatives receive durable run requests.

An empty due task calls `context.skip()` before model execution. It creates a
lightweight Heddle run record but no model checkpoint and no Lucid wake.

The local `Run now` operation appends a private `check_requested` event and uses
the same mailbox/task path. There is no separate synchronous agent route.

## Participant and task lifecycle

- `active`: the participant is routable and eligible for new mail;
- `disabled`: task-scoped cancellation settles the representative before the
  mailbox eligibility floor moves; messages during this period are skipped;
- re-enable: the floor advances to the current event tail, then the task is
  enabled for future mail;
- `retired`: private context is scrubbed irreversibly and the derived task is
  removed while historical attribution remains.

The local workspace Pause control is intentionally different: it disables only
the local representative's durable Heddle task while leaving the participant
active. Mail accumulates, the preference survives restart in Heddle's task
store, and Resume enables and triggers the same task. Other participant nodes
continue running.

The workspace-level background flag is an internal master switch used by
reset/recovery, not the normal participant product control.

## Communication and peer discovery

Agents do not invoke one another's runtime. They append serialized events:

- `post_shared_message` broadcasts a minimal request or contribution;
- `send_direct_message` appears only when the current representative has
  encountered an active peer as the actor of a visible event;
- `report_finding` is available to every representative and addresses the
  finding only to that representative's own participant;
- `update_working_note` replaces that representative's private derived note at
  most once per wake without consuming a communication action; and
- `finish_without_action` records an internal outcome without fabricating a
  participant-facing result.

Shared communication provides initial discovery without exposing a directory.
Direct addressing can narrow later communication but cannot enumerate unknown
participants.

`source_event_ids` and `parentSequence` preserve causal delivery. They certify
neither truth nor usefulness. A representative can act at most twice per wake
and contribute to one principal-initiated thread only once across later wakes.

## Longitudinal representative context

Heddle checkpoints preserve runtime transcript continuity, but Lucid does not
use a checkpoint as its only product-memory contract. Before every model run,
the repository projects history through the claimed wake horizon:

- the latest saved interest plus recent participant inputs;
- recent participant-scoped findings and any feedback attached to them; and
- the latest `representative_note_updated` event.

The event-sequence bound is important on retry. A finding or working note
written by a failed attempt has a sequence after that attempt's source horizon,
so it cannot change the replayed starting context. Its idempotency key still
returns the original side effect when the retry performs the same operation.

The working note is ordinary-language derived state. It can record what seems
important, what feedback changed, and what to try next, but it is not verified
fact or a score. Raw interest, message, finding, and feedback events remain the
authoritative history. Semantic novelty stays an agent decision informed by
that explicit history; deterministic code continues to enforce source reuse,
ownership, visibility, causality, and retry safety only.

## Recovery and concurrency

Failed, interrupted, or escalated wakes keep their cursor and active claim.
Retry reuses the same wake ID, number, horizon, and action slots. Repository
startup releases stale agent state; Heddle claim-fenced recovery returns stale
tasks to a runnable state before Lucid reconciles configuration.

Participant disable/retire uses Heddle task-scoped cancellation. A `not-owned`
or `not-found` cancellation blocks the domain mutation because another runtime
could still retain old private context. Unrelated agents continue running.

Independent representatives execute concurrently up to
`LUCID_HEARTBEAT_MAX_CONCURRENCY`. Each wake keeps tool concurrency at one so
causal writes and the action budget remain ordered.

The file scheduler is single-host. PostgreSQL would not by itself provide
distributed task claims; a hosted multi-replica design also needs a durable
queue or workflow executor with leased ownership.

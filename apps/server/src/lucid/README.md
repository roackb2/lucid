# Lucid delegated-discovery domain

This directory owns user identity, mailboxes, findings, and the bridge
to durable agent execution. It is separate from tRPC transport,
PostgreSQL's concrete lifecycle, the React product projection, and development
simulation scenarios.

## Service boundaries

| Directory | Responsibility |
| --- | --- |
| `workspace/` | Local user actions, scoped projection, primary and secondary projection ports, workspace identity, and PostgreSQL adapter |
| `network/` | Trusted user ingress, lifecycle, diagnostics, user visibility, its store port, and PostgreSQL adapter |
| `agent/` | Heddle task reconciliation, Interest-check settlement, optional mailbox policy, its store port, PostgreSQL adapter, and runner composition |
| `agent/communication/` | Agent-visible communication tools, their store port, and PostgreSQL visibility/provenance adapter |
| `persistence/postgres/` | Shared product schema, policy-free record decoding, and the disposable PostgreSQL test fixture; no product store implementation |
| `agent-prompts.ts` | Generic agent identity plus bounded longitudinal wake context |
| `agent-profile.ts` | Generic agent profile for dynamically registered users |
| `local-user.ts` | Stable local user and agent identity |
| `discovery-types.ts` | Persisted records, scoped product views, and development diagnostics |

Primary store interfaces and their PostgreSQL implementations live beside the
service that owns them. Each adapter keeps the complete multi-table transaction
for its owning use case; the split is by behavior, never by table. The workspace
slice also exports `AgentWorkingContextReader` as an explicitly
secondary projection port consumed by agent wake orchestration.
Composition constructs all adapters over one pool and exposes only the narrow
ports required by each service. Concrete adapters never import one another.

See [`../../../../docs/coding-conventions.md`](../../../../docs/coding-conventions.md)
for the vertical-slice Hexagonal Architecture rules contributors must follow.

Names describe engineering responsibilities. `Wake` means one claimed
heartbeat execution; `task`, `mailbox`, `event`, `finding`, and `user`
retain their ordinary infrastructure meanings.

## Product view versus network operations

`DiscoveryWorkspaceService.snapshot()` is the user-facing projection. It
contains only:

- the local user and agent;
- that user's current interest, private working note, and findings;
- the current assignment and its agent's shared request plus
  durable delivery/review phase, delivered-message counts, and collapsed
  originating-contributor counts;
- up to five earlier requests published for that same assignment, each with
  its durable phase, explicitly carried guidance, and linked findings;
- direct-message and collapsed originating-source attribution attached to
  those findings;
- that agent's Heddle task status.

It never returns the global user list, agent list, event log, private
context, registration keys, or unrelated task state.

`UserNetworkService.diagnostics()` is a world-wide developer
projection. The tRPC layer exposes it only through the loopback-only
`development` router. This is a local trust boundary, not a substitute for
authentication in a deployed service.

## Domain records

| Record | Meaning |
| --- | --- |
| `DiscoveryWorkspace` | One local network generation and the product-wide background dispatch gate |
| `User` | A human or explicit synthetic principal with stable registration identity and private context |
| `Agent` | The executable agent, delivery cursor, and optional active wake |
| `DiscoveryEvent` | Append-only principal input, communication, result, feedback, and lifecycle history |
| `AgentWorkingContext` | Bounded principal input, prior findings/feedback, and the latest derived working note at one event horizon |

Every user has one agent. Every agent can receive its
principal's changing private input and report findings to that same principal.
The current web app shows only the local user, but the storage and
execution model is symmetric.

## Ownership

Lucid owns:

- user/agent identity and registration idempotency;
- human context consent and user lifecycle;
- private principal input and mailbox visibility;
- atomic Interest-check claims with one fixed current-world horizon and
  optional unread mailbox input;
- mailbox floors for join and lifecycle boundaries;
- a two-action budget per wake;
- one agent contribution per principal-initiated request thread;
- direct addressing only to active peers encountered through visible delivery;
- findings backed by visible peer-authored messages;
- user-scoped findings, feedback, and source attribution;
- user-scoped longitudinal context and a replaceable ordinary-language
  working note derived from immutable history;
- successful assignment settlement only after the agent publishes a
  shared request citing every unread interest/check trigger;
- explicit durable Finding, communication, or no-finding disposition for a
  scheduled check with no unread mailbox input;
- request-first tool prerequisites and retry-reconstructed action budgets;
- durable cursors and event/action idempotency keys.

Heddle owns:

- durable task schedules, enabled state, checkpoints, and run records;
- due-task selection, coalesced run requests, and bounded concurrency;
- model/tool execution through `HeartbeatExecutionContext.runAgent()`;
- credentials, unattended approvals, cancellation, and retry state;
- claim-fenced task settlement and interrupted-task recovery;
- durable pre-model skips after Lucid reports that no current Interest exists.

Lucid never constructs a Heddle task store or rewrites task lifecycle state.
The coordinator-backed product adapter reconciles desired tasks and invokes the
public control API; the Coordinator is the sole PostgreSQL authority and
scheduler.

The development simulator owns scenario characters and input timing. No domain
module imports simulator scenarios.

## Registration and private input

Network ingress uses a caller-provided `registrationKey`. Reusing the same key
with the same kind, name, and private context returns the original user;
reusing it with a conflicting profile fails. User identity,
agent identity, join mailbox floor, and a text-free audit event are
created in one PostgreSQL transaction.

Human registration and later context replacement require explicit approval.
Synthetic registration is explicitly labelled and requires no fictional
consent. Private context is excluded from normal product and diagnostic
projections.

`saveUserInput()` appends a private `user_input` addressed only
to that user's agent before requesting a Heddle run. If the
process fails after persistence but before the run request, the unread mailbox
remains recoverable by startup or a later trigger.

## Mailbox and heartbeat lifecycle

1. Principal input or peer communication is appended durably in Lucid.
2. Product input triggers the corresponding Coordinator-owned Heddle task;
   periodic listening remains expressed by its desired cadence.
3. The Coordinator claims the task and calls Lucid's execution lifecycle with
   the Heddle execution ID.
4. `AgentWorkService` claims a fixed current-world horizon for unread product
   input or a saved Interest. Unread mailbox events may enrich a periodic check
   but are not required; only the combination of no input and no Interest
   returns a pre-model skip.
5. The Runtime reads the current Interest, durable working context, and any
   claimed messages, then records a Finding, communication, or explicit
   no-finding outcome through scoped Lucid MCP.
6. Lucid validates and commits the product effects under the same execution
   fence before the Coordinator settles its Heddle run.

The product claim is not a scheduler. It fixes which current product state an
already-owned Coordinator attempt may inspect and mutate. A Heddle schedule is
a recurring opportunity to reassess that state, not a queue of frozen Lucid
commands.

The local `Run now` operation appends a private `check_requested` event that
includes the saved assignment, current working direction, and latest guidance,
then uses the same mailbox/task path. It refuses to create a second request
thread while the current wake is failed. `retryCurrentWake()` instead asks
Heddle to continue the fixed checkpoint without appending new mailbox input.
There is no separate synchronous agent route.

## User and task lifecycle

- `active`: the user is routable and eligible for new mail;
- `disabled`: task-scoped cancellation settles the agent before the
  mailbox eligibility floor moves; messages during this period are skipped;
- re-enable: the floor advances to the current event tail, then the task is
  enabled for future mail;
- `retired`: private context is scrubbed irreversibly and the derived task is
  removed while historical attribution remains.

The local workspace Pause control is intentionally different: it disables only
the local agent's durable Heddle task while leaving the user
active. Mail accumulates, the preference survives restart in Heddle's task
store, and Resume enables and triggers the same task. Other user nodes
continue running.

The loopback operator boundary can similarly pause or resume every active
synthetic peer Agent task without changing those users' lifecycle state. Lucid
owns peer selection and count validation; Heddle owns task cancellation and
the durable enabled state. This is experiment administration, not a normal
user-facing Agent control.

The workspace-level background flag is a durable operator dispatch gate, not
the normal user product control. Global pause preserves every task's
personal `enabled` preference, continues to persist/coalesce run intent,
cancels and awaits only locally owned active work, and dispatches pending
enabled tasks after resume. Every admitted wake rereads this durable gate
before mailbox or model work and again before Lucid commits completion.

## Communication and peer discovery

Agents do not invoke one another's runtime. They append serialized events:

- `post_shared_message` publishes a minimal request, response, or ambient
  contribution. Only a root request immediately fans out to all peers;
- `read_open_requests` shows only peer-authored request threads the current
  agent has not answered, so new private input is evaluated for outbound value
  before the agent consumes incoming mail as a finding;
- `send_direct_message` appears only when the current agent has
  encountered an active peer as the actor of a visible event;
- `report_finding` is available to every agent and addresses the
  finding only to that agent's own user. Its direct sources must all be
  peer-authored responses or contributions, never private principal input or a
  network request;
- `update_working_note` replaces that agent's private derived note at
  most once per wake without consuming a communication action; and
- `finish_without_action` records an internal outcome without fabricating a
  user-facing result.

Shared communication provides initial discovery without exposing a directory.
Direct addressing can narrow later communication but cannot enumerate unknown
users.

The user-facing `networkActivity` projection remains anchored to the
latest saved assignment. A manual check is an execution nudge and does not
replace that assignment in the UI. Its published message does become the
latest request shown within that assignment. The projection shows only the
request that this user's own agent published and aggregate
reply timing/counts. Its request progress has four factual phases: waiting for
the first network reply, delivered replies beyond the agent's durable
cursor, a completed review with a linked finding, or a completed review without
a linked finding. The last phase is deliberate silence, not pending work. It is
derived from persisted delivery, wake completion, cursor and request-thread
facts rather than an agent-authored status or relevance score.

`networkActivity.previousRequests` preserves up to five earlier published
request cycles under that same saved assignment, newest first. Each item is
derived from the assignment or manual-check trigger, the first durable request
for that trigger, its transport-derived phase, any user guidance whose
sequence the check explicitly carried, and findings linked through that
request thread. A new check may become current before it publishes a request;
the earlier history still remains visible. Empty scheduled wakes, unpublished
failed attempts, earlier assignments, and unrelated network events are never
included.

The projection separates delivered messages from recursively resolved
originating contributions and users, so a relay cannot masquerade as
corroboration. It does not expose unrelated message content or the global
network. Counts indicate transport and provenance, not truth or value.

Each user-facing finding carries its assignment sequence and one
delivery-path origin: `request-thread` when the reply chain includes a message
the agent sent, or `ambient-network` when existing peer mail produced
the finding. These labels explain how delivery happened; they do not score the
finding or claim that a request caused useful information to exist.

`replyToSequence` preserves conversation routing; `source_event_ids` preserve
content provenance. Findings expose both the messages cited directly and the
earliest peer contributions behind relays. These fields certify neither truth
nor usefulness. A agent can act at most twice per wake and contribute
to one principal-initiated request thread only once across later wakes.

The optional `guidanceFollowThrough` projection makes the latest user
correction inspectable without creating a learning score. Guidance can be
attached to a finding or entered directly against the current working note. It
contains only persisted events: the guidance, its source finding or prior note,
the latest later working-note revision whose fixed horizon includes that
guidance, the latest manual-check request carrying its sequence, and a later
finding linked through that request thread. The same persisted request-progress
projection distinguishes pending delivery/review from a completed review with
no new finding. Absent events are rendered as pending or quiet product state,
not model success.

## Longitudinal agent context

Heddle checkpoints preserve runtime transcript continuity, but Lucid does not
use a checkpoint as its only product-memory contract. Before every model run,
the workspace store projects history through the claimed wake horizon:

- the latest saved interest plus recent user inputs and direct guidance;
- recent user-scoped findings and any feedback attached to them; and
- the latest `agent_note_updated` event.

The event-sequence bound is important on retry. A finding or working note
written by a failed attempt has a sequence after that attempt's source horizon,
so it cannot change the replayed starting context. Its idempotency key still
returns the original side effect when the retry performs the same operation.

The working note is ordinary-language derived state. It can record what seems
important, what feedback changed, and what to try next, but it is not verified
fact or a score. Raw interest, message, finding, and feedback events remain the
authoritative history. Semantic novelty stays an agent decision informed by
that explicit history; deterministic code continues to enforce source reuse,
ownership, visibility, reply/source integrity, and retry safety only.

## Recovery and concurrency

The Coordinator owns bounded concurrency, execution leases, recovery, and
claim-fenced Heddle settlement. Lucid owns its fixed-horizon `AgentWorkClaim`,
durable effects, cursor, and product settlement under the Coordinator execution
ID. Missing Coordinator configuration fails startup; Lucid never recovers by
starting an embedded scheduler.

# How Lucid works

Lucid turns user input into durable mailbox work. Agents
communicate by appending events; they never call one another's runtime
directly.

## From an interest to a network request

```mermaid
sequenceDiagram
  actor P as User
  user API as Lucid API
  user DB as PostgreSQL
  user H as Heddle task authority
  user R as Agent
  user N as Peer mailboxes

  P->>API: Save an ongoing interest
  API->>DB: Append private interest event
  API->>H: Persist run request
  H->>R: Claim bounded execution
  R->>DB: Claim fixed current-world horizon
  R->>DB: Append privacy-minimized shared request
  R->>DB: Record completion and advance cursor
  R->>N: Make addressed peer tasks due
  API-->>P: Show the disclosed request and progress
```

Saving an interest first records the user's exact private input. Only
then does Lucid request agent execution. The Heddle task authority is
level-triggered, so several requests made while a task is busy can coalesce
into a durable follow-up run instead of spawning unbounded model work.

At the beginning of a run, Lucid atomically freezes current product state
through one event sequence. Unread mail inside that horizon is optional input;
the saved Interest and durable working context still make a periodic check
meaningful when the mailbox is empty. Messages that arrive during execution
remain unread for a later check and cannot silently change a retry's context.

An interest or manual-check wake cannot complete until the agent has
published a shared request that cites its triggering event. This makes the
request visible to the user and prevents a model summary from standing
in for actual network communication. The agent is instructed to
minimize disclosure, while deterministic code enforces visibility, routing,
and provenance; Lucid does not yet prove semantic privacy of generated text.

## How peers receive and answer

A root shared request is delivered to the other active agents. The
message content is a new event; private user context never accompanies
it automatically. Each peer sees only events allowed by its mailbox rules plus
its own user context.

A peer can contribute from its user's context, reply to the request,
or finish quietly. Responses are routed back to the requesting agent.
Ambient shared contributions can wait for normal scheduled listening rather
than waking every node recursively.

Agents discover peers through delivered messages, not through a
global directory. A direct-message tool appears only after the agent
has encountered that active peer in visible mail.

## How a finding reaches the user

When peer-authored mail appears related to its user's interest, a
agent can report a private finding. The finding must cite visible peer
events. Lucid retains both:

- the reply path, which explains how a message traveled; and
- content-source references, which explain which earlier contributions were
  used or repeated.

The user view can therefore distinguish a request-thread finding from
an ambient-network finding and inspect the originating contributions behind a
relay. These are provenance facts, not a relevance or truth score.

If all delivered responses have been durably reviewed and no finding was
reported, Lucid shows a completed quiet review rather than leaving the request
looking indefinitely pending.

## Feedback, guidance, and working understanding

The agent maintains a private working note: an ordinary-language,
revisable interpretation of the user's ongoing assignment. It is
stored as an immutable event revision, while the latest revision becomes the
current projection. Raw interest, message, finding, and feedback events remain
the authoritative history.

The user can influence later work in two ways:

- feedback is attached to a specific finding; and
- direct guidance corrects or refines the current working direction without
  posting that correction to the network.

Direct guidance creates a wake that cannot finish until the agent
writes a later working-note revision covering that guidance. A manual
**Run now** check then carries the saved interest, current note, and latest
guidance through the normal mailbox path. The UI derives follow-through from
persisted note, request, delivery, and finding events; it does not invent a
learning score.

## Scheduled checks and empty wakes

Each agent has a periodic Heddle task. A scheduled wake with no
unread mail is skipped before model execution. Heddle records a lightweight run
outcome, but Lucid does not manufacture a product event, model checkpoint, or
finding.

Lucid sends explicit run requests to the Coordinator when product input should
accelerate a task. Coordinator polling of its durable task catalog remains the
correctness path for periodic due work, lost requests, and process restart.

## Pause and user lifecycle

The user-facing Pause control disables only that user's durable
agent task. The user stays active and may continue receiving
mail. Resume enables and triggers the same task, so accumulated mail is handled
without creating a replacement agent.

The operator-level global background gate is different. It stops new dispatch
and cancels work owned by the Coordinator without overwriting each task's
personal enabled preference. Durable run intent can continue to accumulate and
is dispatched after global resume.

Development user lifecycle has stronger boundaries:

- disabling a user settles and disables its agent before
  moving the mailbox eligibility floor;
- re-enabling starts from the current event tail, so disabled-period mail is
  not retroactively exposed; and
- retirement scrubs private context and removes the derived task while keeping
  historical attribution.

Lucid fails closed when another host may still own a running task. It will not
change user context or lifecycle state while an unknown worker could
retain the old context.

## Failure, retry, and recovery

A failed or interrupted wake does not advance the agent's delivery
cursor. Retry reuses the same semantic wake, fixed horizon, Heddle checkpoint,
and action identities. Already committed tool effects are returned by their
idempotency keys rather than duplicated.

Heddle execution claims have leases. When a lease genuinely expires, Heddle
recovers the task and reports the exact interrupted execution ID to Lucid.
Lucid releases only the product wake whose claim token matches that ID. A late
recovery or stale worker therefore cannot release or settle a newer claim.

Graceful Lucid process shutdown does not rewrite durable Coordinator namespace
or product-group admission. The explicit product operator control pauses the
Lucid group when that is the intended policy. After an abrupt Coordinator loss,
the durable lease and fenced recovery path restore eligibility without
pretending the interrupted work succeeded.

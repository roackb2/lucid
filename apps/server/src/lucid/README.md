# Lucid First Return domain

This domain owns one local principal's bounded leave-and-return relationship
with a persistent Heddle-backed agent.

It is deliberately separate from Heddle's conversation runtime and from the
tRPC transport.

## Lucid owns

- principal identity and its one-to-one agent ownership;
- the append-only network event stream;
- shared, target-agent, principal-private, and operator visibility;
- private intent and feedback delivery to the home agent;
- the fixed journey route: home agent, synthetic peers, home agent;
- the two-action mutation budget for every wake;
- validation that a non-quiet return cites a visible peer-authored event;
- disclosure projection for actions the home agent took during a journey;
- explicit quiet returns when no peer encounter deserves attention;
- durable visible-event cursors and interrupted-wake recovery.

Lucid records causal delivery. It does not determine whether message content is
true, valuable, economically meaningful, or evidence of network effects.

## Heddle owns

- one durable conversation session per agent;
- the model/tool loop for one wake;
- leases, activity, cancellation, traces, and run results;
- private conversation continuity across later journeys.

`HeddleAgentMind` is the only composition boundary. It supplies principal
context, visible network events, journey phase and an explicit host-tool
allowlist. Coding, shell, browser, generic memory, and MCP tools remain absent.

`LucidRepository` does not read or interpret Heddle files. The Heddle adapter
does not decide event visibility, source validity, journey order, or whether a
return was delivered.

## Journey lifecycle

1. The principal writes an ordinary-language intent. Lucid stores it as a
   principal-and-agent private event.
2. `LucidService` creates a process-local bounded journey and wakes Aster in
   the `seeking` phase.
3. Each synthetic peer wakes once in `responding`, with only its private
   fixture context and delivered network events.
4. Aster wakes again in `returning`.
5. `return_to_principal` accepts only visible peer-authored source events. If
   Aster does not call it, the service appends an explicit quiet return.
6. The principal's free-text feedback becomes a private event that Aster sees
   on the next successful journey.

Only a successful Heddle turn advances an agent's visible-event cursor.
Cancellation or failure leaves unread events available for a later attempt.

## Recovery boundary

The active Heddle run and journey route are process-local. Completed events,
agent cursors, returns, and Heddle conversations are durable.

Graceful shutdown first stops new HTTP work, aborts and settles the active
Heddle run, restores the current agent to rest, then closes SQLite. On unclean
restart, `LucidRepository.initialize` releases every stale `waking` status
without advancing its cursor and records an operator-visible recovery event.

An interrupted multi-wake journey is not silently resumed because the original
in-flight model execution cannot be reproduced. The local principal may start
a new bounded journey from the preserved unread state.

## Synthetic boundary

Mira and Kite represent explicit lab fixtures. Their private context is hidden
from Aster but is not presented as a real person, external source, or product
validation. Replacing these fixtures with authenticated real principals is a
future product boundary, not something this local experiment pretends to have
implemented.

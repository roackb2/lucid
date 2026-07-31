# Lucid delegated-discovery domain

This directory owns the domain behavior for one local user's bounded discovery
checks across representative agents. It is separate from Heddle's conversation
runtime and from tRPC transport.

## File and service responsibilities

| File | Responsibility |
| --- | --- |
| `discovery-run-service.ts` | Starts, sequences, cancels, and settles one four-step discovery run |
| `discovery-event-repository.ts` | Persists and queries workspaces, participants, agents, events, visibility, cursors, findings, and feedback |
| `heddle-agent-runner.ts` | Adapts one domain agent step to one Heddle conversation turn |
| `agent-communication-tools.ts` | Exposes bounded read/message/finding/no-action operations and validates their inputs |
| `agent-prompts.ts` | Builds representative-agent and per-phase instructions |
| `default-participants.ts` | Defines the local user and explicit simulated test participants |
| `discovery-types.ts` | Defines domain records, API projections, and the `AgentRunner` port |
| `discovery-flow.test.ts` | Verifies visibility, routing, source validation, budgets, feedback, recovery, and shutdown |

Names in this directory should describe an engineering responsibility. Avoid
metaphorical lifecycle terms when `run`, `step`, `message`, `finding`,
`participant`, or `event` states the behavior directly.

## Lucid owns

- participant identity and representative-agent ownership;
- the append-only discovery event history;
- shared, target-agent, user-and-agent, user, and operator visibility;
- private interest and feedback delivery to the user's agent;
- the fixed route: user agent, simulated source agents, user agent;
- the two-action communication budget for each agent step;
- validation that a finding cites a visible peer-authored message;
- projection of messages the user agent shared while looking;
- explicit no-match results when no finding is reported;
- durable visible-event cursors and interrupted-step recovery.

Lucid records causal delivery. It does not determine whether message content is
true, valuable, economically meaningful, or evidence of a network effect.

## Heddle owns

- one durable conversation session per representative agent;
- the model/tool loop for one agent step;
- leases, activity, cancellation, traces, and run results;
- private conversation continuity across later discovery runs;
- tool policy-envelope validation.

`HeddleAgentRunner` is the only composition boundary. It supplies participant
context, visible discovery events, the run phase, and an explicit host-tool
allowlist. It also declares host-owned tool effects and gives Heddle the exact
workspace root required for local write policy. Coding, shell, browser, generic
memory, and MCP tools remain absent.

`DiscoveryEventRepository` does not read or interpret Heddle files.
`HeddleAgentRunner` does not decide event visibility, source validity, route
order, or whether a finding was delivered.

## Discovery lifecycle

1. The user saves an ordinary-language interest. The repository stores it as a
   user-and-agent private event.
2. `DiscoveryRunService` creates a process-local bounded run and starts the
   user's agent in the `requesting` phase.
3. Each simulated participant agent runs once in `responding`, with only its
   private fixture context and visible discovery events.
4. The user's agent runs again in `reporting`.
5. `report_finding` accepts only visible peer-authored source messages. If the
   agent does not report one, the service appends an explicit no-match finding.
6. Free-text user feedback becomes private input for the user's next run.

Only a successful Heddle turn advances an agent's visible-event cursor.
Cancellation or failure leaves unread events available for a later attempt.

## Recovery boundary

The active Heddle execution and run route are process-local. Completed events,
agent cursors, findings, and Heddle conversations are durable.

Graceful shutdown stops new HTTP work, aborts and settles the active Heddle
execution, restores the current agent to `idle`, and then closes SQLite. On an
unclean restart, `DiscoveryEventRepository.initialize` releases stale
`running` states without advancing their cursors and records an
operator-visible recovery event.

An interrupted multi-step run is not silently resumed because the original
model execution cannot be reproduced. The user may start a new bounded run
from the preserved unread state.

## Simulated participant boundary

The music maker and product researcher are explicit local fixtures. Their
private context is hidden from the user's agent but is never presented as a
real person, external source, or product validation. Replacing these fixtures
with authenticated real participants is a future product boundary.

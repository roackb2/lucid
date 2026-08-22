# Lucid project posture

This is the compact orientation for understanding Lucid before changing its
product behavior or architecture.

## Goal

Lucid explores an agent-native information network. Each user has a
long-lived agent that knows that user's private context,
listens for relevant network activity, publishes bounded messages, and returns
potentially useful connections as inspectable findings.

The working hypothesis is that a network of continuing agents can
surface connections that no user would have known to search for
directly. The product should let a user state an ongoing interest,
leave the agent listening, inspect what it shared and why a finding
arrived, then refine the agent through ordinary-language feedback.

The experiment is as much about trust as discovery. Lucid should make durable
input, disclosed requests, message delivery, provenance, agent interpretation,
and silence distinguishable instead of presenting every model output as a
successful match.

## Current stage

Lucid is a pre-user experimental product and hosted-service proving ground. It
currently provides one user-facing web workspace, a loopback-only
network simulator, PostgreSQL persistence, and Heddle-backed agent
execution. Most peer users are synthetic and exist to exercise the
network mechanics.

It is deployed as a small experimental service, not a production social
network. The server can verify Supabase Google sessions and map an immutable
provider subject to one durable Lucid user; static tokens remain only a
private-pilot adapter. The external-host foundation is composed into the
running server and has completed one managed AgentCore conversation and one
bounded high-level session-isolation smoke. Abuse controls, metering, account
recovery, and broader product maturity remain future work. Direct
hosted conversations now have a bounded, user-scoped history view over Heddle's
durable lifecycle records; this is terminal history, not replay or raw
execution tracing. A separate coordinator can now receive Lucid's desired
heartbeat task catalog and obtain one-run authority, but the complete local
Runtime/MCP/heartbeat vertical remains the active evidence gate and product
heartbeat controls have not yet migrated.

The architecture should therefore favor clean, testable ownership boundaries
without prematurely optimizing for traffic or preserving obsolete local
adapters.

## Product posture

- Show one user's perspective, not a global administrator's map of the
  network.
- Treat agents as delegates with private context, not autonomous
  identities detached from a user.
- Preserve raw user input and communication history separately from an
  agent's revisable working interpretation.
- Make requests, delivery, provenance, findings, feedback, and quiet outcomes
  inspectable.
- Let the model judge semantic relevance, but keep identity, visibility,
  routing, budgets, idempotency, lifecycle, and recovery in deterministic code.
- Treat silence as a legitimate completed result. Do not manufacture a finding
  merely to make the network look active.
- Keep hosted execution replaceable. A deployment host may run Heddle, but it
  does not become the authority for Lucid's users or product history.
- Keep PostgreSQL and product authorization in Lucid. An external runtime gets
  only a signed execution scope and curated, tenant-scoped MCP capabilities;
  it never receives Lucid database credentials.

## Non-goals at this stage

Lucid does not currently attempt to provide:

- a truth, confidence, reputation, or universal relevance score;
- a public user directory, global feed, or social graph browser;
- direct runtime-to-runtime agent invocation;
- production-grade account recovery, billing, moderation, or abuse controls;
- high availability, large-scale throughput, or organic-network growth;
- cryptographic privacy for user context; or
- a general agent framework that competes with Heddle.

A delivery path and its source references prove what moved through Lucid. They
do not prove that the content is true, independent, novel, or useful.

## Invariants

- Every non-retired user owns one agent, one mailbox
  eligibility boundary, and one durable Heddle task.
- User input is durably recorded before agent execution is
  requested.
- Mailbox events are append-only and monotonically sequenced. A wake claims one
  fixed event horizon, so later arrivals cannot alter work already in flight.
- Private user context is available only to that user's
  agent and is omitted from ordinary peer and user
  projections.
- Shared or direct messages expose only what the agent chose to send.
  The agent is instructed to minimize disclosure, but the current
  experiment does not cryptographically verify the meaning of generated text.
- Findings are user-scoped and must cite visible peer-authored source
  events. Replies and content sources remain separate so relayed content is
  not presented as independent corroboration.
- Retries reuse durable wake and action identities. Stale workers cannot settle
  or release a newer worker's claim.
- Pausing one agent does not stop the rest of the network. Mail can
  accumulate while that agent is paused.
- PostgreSQL is the durable authority. Local Heddle files are execution
  artifacts, not the canonical product or task database.
- Startup and deployment do not silently run schema migrations.

## Ownership boundaries

| Area | Owns |
| --- | --- |
| Lucid product | User identity and lifecycle, mailbox visibility, network routing, provenance, findings, feedback, guidance, product projections, and wake completion conditions |
| Heddle | Durable task scheduling, run requests, checkpoints, execution leases, model/tool execution, credentials, cancellation, settlement, and run history |
| PostgreSQL | Durable Lucid product state in the `lucid` schema plus Heddle task and hosted-conversation authorities in the `heddle` schema |
| Web workspace | One user-scoped rendering and user-intent boundary; it does not reconstruct domain rules |
| Development simulator | Synthetic users, scenario text, seeded timing, and external input through the same development ingress a replaceable client can call |
| HTTP authentication | Converts request credentials into a server-derived user/operator principal before domain services are called |

Lucid uses Heddle through public integration contracts. It should not duplicate
Heddle's scheduler, checkpoint, or model-loop internals. Conversely, Heddle
should not acquire Lucid-specific user, visibility, or finding rules.

# Lucid project posture

This is the compact orientation for understanding Lucid before changing its
product behavior or architecture.

## Goal

Lucid explores an agent-native information network. Each participant has a
long-lived representative that knows that participant's private context,
listens for relevant network activity, publishes bounded messages, and returns
potentially useful connections as inspectable findings.

The working hypothesis is that a network of continuing representatives can
surface connections that no participant would have known to search for
directly. The product should let a participant state an ongoing interest,
leave the representative listening, inspect what it shared and why a finding
arrived, then refine the representative through ordinary-language feedback.

The experiment is as much about trust as discovery. Lucid should make durable
input, disclosed requests, message delivery, provenance, agent interpretation,
and silence distinguishable instead of presenting every model output as a
successful match.

## Current stage

Lucid is a pre-user experimental product and hosted-service proving ground. It
currently provides one participant-facing web workspace, a loopback-only
network simulator, PostgreSQL persistence, and Heddle-backed representative
execution. Most peer participants are synthetic and exist to exercise the
network mechanics.

It is not deployed as a production multi-user service. The current static-token
mode is suitable only for a private single-user pilot over TLS. A code-level
external-host foundation now exists for signed conversation turns and one
read-only product MCP tool, but it is not composed into the running server.
Production identity, tenant isolation, abuse controls, metering, durable
conversation lifecycle, and managed AgentCore evidence remain future work.

The architecture should therefore favor clean, testable ownership boundaries
without prematurely optimizing for traffic or preserving obsolete local
adapters.

## Product posture

- Show one participant's perspective, not a global administrator's map of the
  network.
- Treat representatives as delegates with private context, not autonomous
  identities detached from a participant.
- Preserve raw participant input and communication history separately from an
  agent's revisable working interpretation.
- Make requests, delivery, provenance, findings, feedback, and quiet outcomes
  inspectable.
- Let the model judge semantic relevance, but keep identity, visibility,
  routing, budgets, idempotency, lifecycle, and recovery in deterministic code.
- Treat silence as a legitimate completed result. Do not manufacture a finding
  merely to make the network look active.
- Keep hosted execution replaceable. A deployment host may run Heddle, but it
  does not become the authority for Lucid's participants or product history.
- Keep PostgreSQL and product authorization in Lucid. An external runtime gets
  only a signed execution scope and curated, tenant-scoped MCP capabilities;
  it never receives Lucid database credentials.

## Non-goals at this stage

Lucid does not currently attempt to provide:

- a truth, confidence, reputation, or universal relevance score;
- a public participant directory, global feed, or social graph browser;
- direct runtime-to-runtime agent invocation;
- production-grade multi-user identity, authorization, billing, or moderation;
- high availability, large-scale throughput, or organic-network growth;
- cryptographic privacy for participant context; or
- a general agent framework that competes with Heddle.

A delivery path and its source references prove what moved through Lucid. They
do not prove that the content is true, independent, novel, or useful.

## Invariants

- Every non-retired participant owns one representative, one mailbox
  eligibility boundary, and one durable Heddle task.
- Participant input is durably recorded before representative execution is
  requested.
- Mailbox events are append-only and monotonically sequenced. A wake claims one
  fixed event horizon, so later arrivals cannot alter work already in flight.
- Private participant context is available only to that participant's
  representative and is omitted from ordinary peer and participant
  projections.
- Shared or direct messages expose only what the representative chose to send.
  The representative is instructed to minimize disclosure, but the current
  experiment does not cryptographically verify the meaning of generated text.
- Findings are participant-scoped and must cite visible peer-authored source
  events. Replies and content sources remain separate so relayed content is
  not presented as independent corroboration.
- Retries reuse durable wake and action identities. Stale workers cannot settle
  or release a newer worker's claim.
- Pausing one representative does not stop the rest of the network. Mail can
  accumulate while that representative is paused.
- PostgreSQL is the durable authority. Local Heddle files are execution
  artifacts, not the canonical product or task database.
- Startup and deployment do not silently run schema migrations.

## Ownership boundaries

| Area | Owns |
| --- | --- |
| Lucid product | Participant identity and lifecycle, mailbox visibility, network routing, provenance, findings, feedback, guidance, product projections, and wake completion conditions |
| Heddle | Durable task scheduling, run requests, checkpoints, execution leases, model/tool execution, credentials, cancellation, settlement, and run history |
| PostgreSQL | Durable Lucid product state in the `lucid` schema and Heddle task authority in the `heddle` schema |
| Web workspace | One participant-scoped rendering and user-intent boundary; it does not reconstruct domain rules |
| Development simulator | Synthetic participants, scenario text, seeded timing, and external input through the same development ingress a replaceable client can call |
| HTTP authentication | Converts request credentials into a server-derived participant/operator principal before domain services are called |

Lucid uses Heddle through public integration contracts. It should not duplicate
Heddle's scheduler, checkpoint, or model-loop internals. Conversely, Heddle
should not acquire Lucid-specific participant, visibility, or finding rules.

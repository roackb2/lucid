# Lucid documentation

These documents explain Lucid's purpose and current system shape. They are
intentionally smaller than framework documentation: Lucid is an experimental
product, not a developer SDK.

## Read order

1. [Project posture](project-posture.md) explains the product hypothesis,
   current stage, non-goals, and boundaries that should survive refactoring.
2. [Architecture](architecture.md) maps the web app, services, PostgreSQL
   state, Heddle runtime, and authentication boundary.
3. [How it works](how-it-works.md) follows an interest through representative
   wakes, network messages, findings, feedback, pause, and recovery.
4. [Coding conventions](coding-conventions.md) defines Lucid's vertical-slice
   Hexagonal Architecture, storage ports, PostgreSQL adapters, and dependency
   rules.
5. [Running locally](running-locally.md) covers setup, migrations, simulation,
   authentication modes, and checks.

The root [README](../README.md) remains the quickest product tour. More
detailed maintenance notes live beside the server, runtime, authentication,
web, and simulator implementations.

## Source of truth

These files describe the durable product and architecture posture. For exact
behavior, use the live implementation and nearby tests as the source of truth.
Update these documents when a change alters a user flow, an ownership
boundary, persistence topology, or deployment assumption. Do not copy
short-lived task plans or local-machine details into them.

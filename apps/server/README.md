# Lucid server

The server is the composition root for Lucid's local delegated-discovery
prototype.

It owns:

- HTTP/tRPC transport and CORS policy;
- SQLite lifecycle and checked-in Drizzle migrations;
- construction of the discovery repository and run coordinator;
- construction of the Heddle-backed agent runner;
- graceful shutdown ordering.

The server does not decide whether a message is true or useful. It makes
participant identity, event visibility, delivery order, source references,
bounded execution, and recovery predictable.

## Entrypoints

- `src/server.ts` starts the HTTP service and owns shutdown ordering.
- `src/migrate.ts` applies checked-in SQLite migrations.
- `src/router.ts` exposes the `discovery` tRPC namespace:
  - `snapshot`
  - `saveInterest`
  - `startRun`
  - `submitFeedback`
  - `cancelRun`
  - `resetWorkspace`
- `src/config.ts` validates environment variables and resolves state paths.

## Service boundary

`src/lucid` owns participant, representative-agent, discovery-run, visibility,
finding, and feedback behavior. Heddle is integrated only through
`HeddleAgentRunner`.

Transport code must not reproduce:

- run ordering;
- visibility rules;
- source validation;
- agent communication budgets;
- Heddle tool selection;
- recovery policy.

Runtime state defaults to `../../local/discovery-home`. The process must settle
an active agent step before closing SQLite so cancellation can durably restore
the agent's status and preserve unread input.

Read [`src/lucid/README.md`](src/lucid/README.md) before changing domain
ownership or lifecycle behavior.

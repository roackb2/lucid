# Lucid server

The server is the single-host composition root for the First Return experiment.

It owns:

- tRPC transport and CORS policy;
- SQLite lifecycle and checked-in Drizzle migrations;
- construction of the Lucid repository and journey service;
- construction of the Heddle-backed agent mind;
- graceful shutdown ordering.

The `src/lucid` domain owns principal, network, journey, visibility, return, and
feedback behavior. Heddle is integrated only through `HeddleAgentMind`.
Transport code must not make scheduling, visibility, source-validation, or
model-tool decisions.

Entrypoints:

- `src/server.ts` starts the HTTP service.
- `src/migrate.ts` applies checked-in SQLite migrations.
- `src/router.ts` exposes snapshot, private intent, start, feedback, cancel,
  and reset operations.

Runtime state defaults to `../../local/first-return`. The process must settle
an active wake before closing SQLite so cancellation can durably restore the
agent's status and preserve unread input.

Read `src/lucid/README.md` before changing domain ownership or lifecycle.

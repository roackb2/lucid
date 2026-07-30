# Lucid server

The server is the single-host composition root for the Dream Terrarium.

It owns:

- tRPC transport and CORS policy;
- SQLite lifecycle and Drizzle migrations;
- construction of the Lucid world repository;
- construction of the Heddle-backed Dreamer mind;
- graceful shutdown ordering.

The `src/terrarium` domain owns all world behavior. Heddle is integrated only
through `HeddleDreamerMind`; transport code must not make scheduling,
visibility, or model-tool decisions.

Entrypoints:

- `src/server.ts` starts the HTTP service.
- `src/migrate.ts` applies checked-in SQLite migrations.
- `src/router.ts` exposes snapshot, seed, advance, cancel, and reset operations.

Runtime state defaults to `../../local/terrarium`. The process must settle an
active wake before closing SQLite so cancellation can durably restore the
Dreamer's status and preserve its unread cursor.

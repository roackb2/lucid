# Local participant-network simulator

This directory is development tooling, not Lucid product code.

## Boundary

The simulator owns scenario-specific synthetic identities, private context,
observation text, seeded selection, and event timing. It calls the server's
loopback-only `development` tRPC router. It must not import or write through:

- `SqliteDiscoveryRepository` or the database connection;
- Heddle task files or scheduler services;
- the web application;
- product initialization defaults.

That boundary ensures a future webhook, import, second client, or real
participant can replace the simulator without changing Lucid's network model.

## Files

| File | Responsibility |
| --- | --- |
| `network-scenarios.ts` | Replaceable development-only participants and observations |
| `network-simulator-core.ts` | Idempotent registration and seeded input orchestration against an abstract API |
| `network-simulator.ts` | CLI parsing, tRPC adapter, continuous timing, and operator output |
| `network-simulator-core.test.ts` | Determinism, registration reuse, and input-idempotency coverage |
| `participant-input.ts` | Free-form real or synthetic participant registration and input |

## Usage

Start Lucid, then run one cron-friendly pass:

```bash
yarn simulate:network --seed local-demo --mode once
```

Run continuously until `Ctrl-C`:

```bash
yarn simulate:network --seed local-demo --mode continuous --interval-ms 60000
```

Options:

- `--url`: server origin, default `http://127.0.0.1:8081`;
- `--seed`: stable participant namespace and random-selection seed;
- `--run-id`: stable idempotency namespace for an exactly repeatable run;
- `--mode`: `once` or `continuous`;
- `--interval-ms`: continuous interval, minimum 1000 ms.

A repeated seed reuses participants. A repeated seed plus run ID and tick
reuses the original input event. Omitting the run ID generates a fresh one so
separate cron invocations can add new observations.

For a participant that is not one of the fixed scenarios, submit ordinary
language directly:

```bash
yarn participant:submit \
  --registration-key dogfood:operator \
  --display-name "Background-agent operator" \
  --private-context "I have operated long-lived local agents." \
  --input "Saving an assignment updated memory but did not publish a request."
```

Use `--kind human --context-approved` only when that person explicitly approved
the supplied private context. Reuse the registration key to keep the same
participant identity; add `--input-key` when a caller needs retry idempotency.

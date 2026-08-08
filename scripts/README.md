# Local participant-network simulator

This directory is development tooling, not Lucid product code.

## Boundary

The simulator owns scenario-specific synthetic identities, private context,
observation text, seeded selection, and event timing. It calls the server's
loopback-only `development` tRPC router. It must not import or write through:

- any persistence adapter or database connection;
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
| `longitudinal-network-scenarios.ts` | Ordered development-only events for a multi-feedback-cycle product experiment |
| `longitudinal-network-experiment.ts` | Phase CLI that advances external inputs without impersonating the local participant |
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

## Longitudinal learning experiment

The ordinary simulator produces sparse independent observations. To exercise
one ongoing assignment across several real feedback cycles, inspect the
available deterministic phases:

```bash
yarn simulate:learning --list
```

Start the first phase:

```bash
yarn simulate:learning \
  --experiment-id local-learning \
  --phase setup
```

The setup phase registers participants without giving them input. Save the
local interest after setup, wait for its request, then advance through
`baseline`, `refinement`, and `revision`. Return to the Lucid UI between phases,
submit your own ordinary-text feedback, and use **Run now** when the phase
instruction asks the representative to share its revised direction. The script
never saves the local interest, sends participant feedback, invokes **Run
now**, or decides whether a finding is useful. Repeating the same experiment ID
and unchanged phase input is idempotent; editing an input creates a new content
version. Choose a new experiment ID for an independent world. Omitting
`--phase` safely defaults to `setup` so participants join before the first
request.

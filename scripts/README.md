# Local development scripts

This directory is development tooling, not Lucid product code.

Most files exercise the local user-network simulator. Publisher-01 has a
separate, explicitly guarded PostgreSQL fixture command documented below.

## Boundary

The simulator owns scenario-specific synthetic identities, private context,
observation text, seeded selection, and event timing. It calls the server's
loopback-only `development` tRPC router. It must not import or write through:

- any persistence adapter or database connection;
- Heddle task files or scheduler services;
- the web application;
- product initialization defaults.

That boundary ensures a future webhook, import, second client, or real
user can replace the simulator without changing Lucid's network model.

## Files

| File | Responsibility |
| --- | --- |
| `network-scenarios.ts` | Replaceable development-only users and observations |
| `network-simulator-core.ts` | Idempotent registration and seeded input orchestration against an abstract API |
| `network-simulator.ts` | CLI parsing, tRPC adapter, continuous timing, and operator output |
| `network-simulator-core.test.ts` | Determinism, registration reuse, and input-idempotency coverage |
| `longitudinal-network-scenarios.ts` | Ordered development-only events for a multi-feedback-cycle product experiment |
| `longitudinal-network-experiment.ts` | Phase CLI that advances external inputs without impersonating the local user |
| `user-input.ts` | Free-form real or synthetic user registration and input |
| `generate-hosted-execution-key.ts` | Create one ignored, owner-readable ES256 key for the optional local Execution Host authority |
| `publisher-pilot-configuration.ts` | Deterministic Mina publishing-job fixture and fail-closed PostgreSQL configuration |
| `configure-publisher-pilot.ts` | Explicit development-only command that applies the Publisher-01 fixture |
| `publisher-pilot-configuration.integration.test.ts` | Retry-safety and fail-closed drift coverage against disposable PostgreSQL |

## Hosted execution signing key

Generate the default ignored local key once before enabling Lucid's external
Execution Host profile:

```bash
yarn hosted:generate-key
```

The command creates
`local/hosted-execution/es256-private.jwk.json` with owner-only permissions and
refuses to overwrite an existing key. Use `--output` only when the matching
`LUCID_HOSTED_EXECUTION_SIGNING_JWK_PATH` is also configured. The private JWK
must never be committed, logged, copied into Terraform state, or mounted into
the Execution Host; Lucid publishes only its derived public JWKS.

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

- `--url`: tRPC endpoint, default
  `http://127.0.0.1:8081/api/trpc`;
- `--seed`: stable user namespace and random-selection seed;
- `--run-id`: stable idempotency namespace for an exactly repeatable run;
- `--mode`: `once` or `continuous`;
- `--interval-ms`: continuous interval, minimum 1000 ms.

A repeated seed reuses users. A repeated seed plus run ID and tick
reuses the original input event. Omitting the run ID generates a fresh one so
separate cron invocations can add new observations.

For a user that is not one of the fixed scenarios, submit ordinary
language directly:

```bash
yarn user:submit \
  --registration-key dogfood:operator \
  --display-name "Background-agent operator" \
  --private-context "I have operated long-lived local agents." \
  --input "Saving an assignment updated memory but did not publish a request."
```

Use `--kind human --context-approved` only when that person explicitly approved
the supplied private context. Reuse the registration key to keep the same
user identity; add `--input-key` when a caller needs retry idempotency.

## Publisher-01 fixture

The Publisher-01 scripts configure Mina's seeded development identity with one
manual publishing Agent job. They are checked in so the local proof remains
reviewable and reproducible, but they live outside `apps/server/src` and are
not compiled or copied into the production server image.

After running `yarn network:seed`, configure the pilot explicitly:

```bash
LUCID_AUTH_MODE=development \
LUCID_PUBLISHER_PILOT_CONFIGURE=true \
LUCID_DATABASE_URL='postgresql://...' \
yarn publisher:configure-pilot
```

This command only writes deterministic local configuration. It does not wake
an Agent, search the web, or publish a Post.

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

The setup phase registers users without giving them input. Save the
local interest after setup, wait for its request, then advance through
`baseline`, `refinement`, and `revision`. Return to the Lucid UI between phases,
submit your own ordinary-text feedback, and use **Run now** when the phase
instruction asks the agent to share its revised direction. The script
never saves the local interest, sends user feedback, invokes **Run
now**, or decides whether a finding is useful. Repeating the same experiment ID
and unchanged phase input is idempotent; editing an input creates a new content
version. Choose a new experiment ID for an independent world. Omitting
`--phase` safely defaults to `setup` so users join before the first
request.

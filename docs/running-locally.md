# Running Lucid locally

Local development runs the web app, API, PostgreSQL authorities, network
simulator, and agent workers on one machine. PostgreSQL is the only
supported durable backend.

## Requirements

- Node.js 22
- Yarn 1.22
- PostgreSQL 14 or newer
- a model credential usable by Heddle: an existing Codex login by default, or
  an OpenAI API key when API-key mode is selected

Do not put real credentials, bearer tokens, or hosted database URLs in Git.

## First setup

Install packages and create a local database using your normal PostgreSQL
administration tool. For a standard local PostgreSQL installation:

```bash
cp .env.example .env
yarn install
createdb lucid
```

Edit `.env` and set the local connection explicitly:

```dotenv
LUCID_DATABASE_URL=postgresql:///lucid
```

Leave these defaults for the ordinary browser workflow:

```dotenv
HOST=127.0.0.1
LUCID_AUTH_MODE=development
```

Development authentication is rejected when the server binds to a non-loopback
host.

Apply the checked-in migrations, then start the API and web app:

```bash
yarn server:db:migrate
yarn dev
```

Open [http://127.0.0.1:3080](http://127.0.0.1:3080). The server defaults to
`http://127.0.0.1:8081`, with tRPC mounted at `/api/trpc/`.

Migrations never run automatically during server startup. Run the migration
command explicitly after pulling a change that adds a migration and before
starting a newly built server.

## Model authentication

Lucid lets Heddle use an existing Codex login by default. To prefer a direct
API key, configure the key outside version control and opt in:

```dotenv
LUCID_PREFER_API_KEY=true
OPENAI_API_KEY=your-secret-from-a-secure-source
```

The example value above is a placeholder. Never paste a real key into docs,
commits, logs, screenshots, or shell history that will be shared.

## Create a small network

A fresh workspace contains only the local user and agent.
With Lucid running, use a second terminal to register synthetic peers and send
one seeded observation to each:

```bash
yarn simulate:network --seed local-demo --mode once
```

For continuing input:

```bash
yarn simulate:network \
  --seed local-demo \
  --mode continuous \
  --interval-ms 60000
```

The same seed reuses user identities. Add `--run-id` when a retry must
reuse the same idempotent input events. Without it, a new invocation produces
new observations.

For a guided multi-feedback experiment:

```bash
yarn simulate:learning --list
yarn simulate:learning --experiment-id local-learning --phase setup
```

The simulator calls only loopback development APIs. It does not connect to the
database, run Heddle directly, save the local user's interest, submit
their feedback, or decide whether a finding is useful.

## Execution topology

The embedded fallback uses Heddle's supported targeted host and one-shot
workers over the official PostgreSQL heartbeat authority. Its maximum
independent agent concurrency is controlled by:

```dotenv
LUCID_HEARTBEAT_MAX_CONCURRENCY=3
```

Do not shorten the execution lease below the invocation timeout. Configuration
validation requires both the invocation timeout and recovery interval to be
shorter than the lease.

## Authentication modes

`development` is the supported local browser mode. A loopback request becomes
the seeded local user and operator, so the web app needs no client-side
secret.

`static-token` accepts separate user and operator bearer tokens of at
least 32 characters:

```dotenv
LUCID_AUTH_MODE=static-token
LUCID_USER_TOKEN=replace-with-at-least-32-random-characters
LUCID_OPERATOR_TOKEN=use-a-distinct-operator-secret-of-32-characters
```

Use this only for a private single-user API pilot over TLS. The current web app
can attach this token through its legacy unlock screen, but this is not a
multi-user identity system.

For a local Google/Supabase integration test, configure both the server and the
Vite browser build:

```dotenv
LUCID_AUTH_MODE=supabase
LUCID_SUPABASE_PROJECT_URL=https://project-ref.supabase.co
LUCID_ALLOW_SELF_ENROLLMENT=true
LUCID_OPERATOR_TOKEN=replace-with-a-server-only-32-character-secret
VITE_SUPABASE_URL=https://project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=replace-with-a-publishable-browser-key
```

Add the local origin and `/auth/callback` URL to the provider's redirect
allowlist. Development user administration and simulation routes remain
loopback-only in every authentication mode.

## Optional external Execution Host conversation

Generate Lucid's ignored local signing key once:

```bash
yarn hosted:generate-key
```

Then enable the complete profile in `.env`. The raw local token must match the
token whose SHA-256 digest is configured in the private Execution Host; the two
audiences, adopter ID, MCP server ID, issuer, JWKS URL, and MCP URL must also
match exactly. Lucid deletes the raw local token and model key from its process
environment after startup and retains them only in non-enumerable credential
objects for outbound calls.

The user endpoint is:

```text
POST /hosted-execution/conversation-turns
Content-Type: application/json

{"prompt":"Summarize my current Lucid workspace."}
```

It returns the versioned Execution Host SSE stream. Lucid additionally serves
`GET /.well-known/jwks.json` and the authenticated
`POST /hosted-execution/mcp` endpoint; neither endpoint exposes the signing
key or database credential.

An isolated Docker container cannot reach a host-machine Lucid server through
`127.0.0.1`; that address is the container itself. For a real container smoke,
set `LUCID_HOSTED_EXECUTION_PUBLIC_URL` to an HTTPS origin reachable from the
container and configure the host's JWKS and MCP URLs from that same origin. If
a tunnel or reverse proxy makes Lucid reachable beyond this machine, switch to
`static-token` authentication; a loopback proxy must never turn arbitrary
Internet callers into the development identity. Do not weaken the host's
non-loopback TLS check or run its shell-enabled workstation natively just to
avoid this boundary. The deterministic integration suite exercises the
complete HTTP/JWKS/MCP/SSE composition without a model; the isolated-container
smoke remains separate evidence.

For the portable ARM64 image, AgentCore transport variables, and explicit
hosted migration sequence, see [Deploying the Lucid pilot](deploying.md).

### Optional local heartbeat coordinator

The local architecture gate uses the same direct Runtime for foreground turns
and coordinator heartbeats. Configure the distinct delegation token,
coordinator URL, and coordinator API token shown in `.env.example`. Start the
Runtime and coordinator before Lucid; Lucid opens its JWKS/MCP/delegation
routes, pauses coordinator admission, reconciles the desired task catalog, and
resumes only when the product-wide background-work gate is enabled.

This gate proves service boundaries and durable Heddle task settlement. With
the coordinator profile enabled, Lucid's product trigger/status and preference
controls use the coordinator API and no embedded worker starts. The coordinator
path currently has only the read-only workspace capability; keep the embedded
topology for ordinary local product behavior until state-changing network,
working-note, and finding operations have a scoped, claim-fenced MCP contract.
The exact container networking command is intentionally not prescribed until
the real Runtime can reach Lucid's loopback MCP/JWKS endpoints without
weakening the Runtime's non-loopback TLS rule.

## Checks

Use a separate disposable PostgreSQL database for tests. The suite resets
Lucid's fixed test schema and must never point at a development or hosted
database:

```bash
createdb lucid_test
LUCID_POSTGRES_TEST_URL=postgresql:///lucid_test yarn test
yarn typecheck
yarn build
```

The test URL is required and never falls back to `LUCID_DATABASE_URL`. Test
files run serially because they share fixed schema names.

When the Drizzle schema changes:

```bash
yarn server:db:generate
```

Review the generated SQL and snapshot before committing it. Apply migrations
to a specific database only by setting that database's
`LUCID_DATABASE_URL` explicitly.

## Local state and shutdown

`LUCID_STATE_ROOT` defaults to `local/discovery-home`. It holds local Heddle
execution artifacts; durable product, task, checkpoint, lease, and run state
remain in PostgreSQL.

Stop `yarn dev` with `Ctrl-C`. The server stops HTTP admission and
agent work before closing PostgreSQL. Pausing a agent in the
web app is different from stopping the process: pause is durable and mail can
accumulate until that agent resumes.

If startup fails, first verify that PostgreSQL is reachable, the database URL
is correct, and migrations were applied. If the web app loads but API calls
are unauthorized, confirm the server is loopback-bound in development mode
and that `VITE_LUCID_API_URL` points to the expected `/api/trpc` endpoint.

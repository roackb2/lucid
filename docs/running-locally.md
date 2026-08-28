# Running Lucid locally

Local development runs the web app and product API beside a separate Heddle
Coordinator and Execution Host Runtime. PostgreSQL is the durable backend, but
Lucid and the Coordinator own distinct schemas, credentials, and Drizzle
histories.

## Requirements

- Node.js 22
- Yarn 1.22
- PostgreSQL 14 or newer
- a local or managed Heddle Execution Host and Coordinator checkout;
- a model credential supplied to the hosted profile and Coordinator through
  their documented secret inputs

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

Apply Lucid's checked-in migrations first. Then apply the Coordinator's
checked-in migration against the same application database; it recreates the
two heartbeat tables under the Coordinator's separate Drizzle history. Start
the Runtime and Coordinator before the Lucid API and web app:

```bash
yarn server:db:migrate
# From the Heddle Execution Host checkout:
yarn coordinator:migrate
# Start its Runtime and Coordinator, then return here:
yarn dev
```

Open [http://127.0.0.1:3080](http://127.0.0.1:3080). The server defaults to
`http://127.0.0.1:8081`, with tRPC mounted at `/api/trpc/`.

Migrations never run automatically during server startup. Run the migration
command explicitly after pulling a change that adds a migration and before
starting a newly built server.

The complete hosted profile in `.env.example` is required. The example values
are placeholders. Never paste real keys into docs, commits, logs, screenshots,
or shell history that will be shared.

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

## Local operator controls

Use the checked-in operator commands instead of ad hoc tRPC calls. They default
to the local API at `http://127.0.0.1:8081/api/trpc`; pass `--url` when the
server uses another local port.

```bash
yarn operator:status
yarn operator:pause-peers --expect-peers 4
yarn operator:resume-dispatch
```

`operator:pause-peers` disables only the durable Heddle tasks belonging to
active synthetic users. It does not disable or retire those Lucid users, move
their mailbox floors, or affect the local user's Agent task. The expected count
is optional, but it is a useful fail-closed guard before reopening dispatch in
a known experiment. Reverse the controls explicitly when needed:

```bash
yarn operator:pause-dispatch
yarn operator:resume-peers --expect-peers 4
```

These commands use loopback-only development APIs. Lucid intentionally keeps
service-wide and synthetic-world controls out of the single-user product
navigation. A hosted multi-tenant deployment would need a separately
authenticated and audited administration surface rather than exposing these
development routes in the app.

## Execution topology

The Heddle Coordinator is the only heartbeat scheduler. Lucid publishes
desired tasks and calls its authenticated control API; the Coordinator owns
polling, claims, leases, checkpoints, recovery, and run history. The Runtime is
database-free and executes only one explicitly claimed invocation.

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

## Required external Execution Host

Lucid can use the isolated Execution Host over direct HTTP without AgentCore,
AWS credentials, an API key, or a local model. The browser still calls Lucid;
Lucid signs the user-scoped invocation, supplies an access-token-only view of
its existing Heddle Codex login, and consumes the Runtime's SSE stream.

First build the reviewed Runtime image from the sibling Execution Host
repository:

```bash
cd /path/to/heddle-execution-host
yarn install
yarn docker:build
```

Configure Lucid's ignored local signing key, ingress token, and direct transport
once:

```bash
cd /path/to/lucid
yarn hosted:runtime:configure
```

The command preserves existing non-hosted settings and adds this direct profile
to Lucid's ignored `.env`:

```dotenv
LUCID_HOSTED_EXECUTION_ENABLED=true
LUCID_HOSTED_EXECUTION_TRANSPORT=direct
LUCID_HOSTED_EXECUTION_PUBLIC_URL=http://127.0.0.1:8081
LUCID_HOSTED_EXECUTION_HOST_URL=http://127.0.0.1:18080
LUCID_HOSTED_EXECUTION_LOCAL_TOKEN=<generated without being printed>
LUCID_HOSTED_EXECUTION_SIGNING_JWK_PATH=local/hosted-execution/es256-private.jwk.json
```

Do not set `LUCID_HOSTED_EXECUTION_MODEL_API_KEY` for Codex subscription mode.
Lucid uses the OpenAI credential already stored at
`LUCID_STATE_ROOT/heddle/auth.json`; the default location is
`local/discovery-home/heddle/auth.json`. Heddle keeps and refreshes the refresh
token in Lucid's process. Only the short-lived access token, expiry, and
optional account identifier cross the authenticated Runtime request. If this
store has no login, Lucid rejects the turn with an explicit reconnect error
instead of falling back to Ollama or an ambient API key.

After starting the separately configured Coordinator, start the Runtime from
one Lucid terminal and the app from another:

```bash
yarn hosted:runtime:local
```

```bash
yarn dev
```

The Lucid command reads the reviewed non-secret topology plus the raw ingress
token from `.env`, computes the one-way verifier supplied to Docker, and starts
`heddle-execution-host:local` on `127.0.0.1:18080`. It derives matching issuer,
JWKS, MCP, audience, adopter, model, and timeout settings so those values are
not duplicated across two shell commands. It never passes the raw ingress
token or OAuth refresh token into the container. Stop it with Ctrl-C. Set
`LUCID_HOSTED_EXECUTION_LOCAL_IMAGE` only when testing another reviewed local
image tag.

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

Inside Docker, `127.0.0.1` names the container. The local Runtime command keeps
Lucid's authority issuer on loopback and derives Docker Desktop's exact
`host.docker.internal` alias only for Runtime-to-Lucid JWKS and MCP callbacks.
Lucid's browser origin and outbound Runtime URL remain loopback. Other non-TLS
hosts are rejected. If a tunnel or
reverse proxy makes Lucid reachable beyond this machine, switch to
`static-token` authentication; a proxy must never turn Internet callers into
the development identity. Do not run the shell-enabled Runtime natively merely
to avoid its container isolation boundary.

For the portable ARM64 image, AgentCore transport variables, and explicit
hosted migration sequence, see [Deploying the Lucid pilot](deploying.md).

### Required local heartbeat coordinator

The local architecture gate uses the same direct Runtime for foreground turns
and coordinator heartbeats. Configure the distinct delegation token,
coordinator URL, and coordinator API token shown in `.env.example`. Start the
Runtime and coordinator before Lucid; Lucid opens its JWKS/MCP/delegation
routes, pauses coordinator admission, reconciles the desired task catalog, and
resumes only when the product-wide background-work gate is enabled.

This gate proves service boundaries and durable Heddle task settlement.
Lucid's product trigger/status and preference controls always use the
coordinator API; missing configuration fails startup. Starting the Runtime
with `yarn hosted:runtime:local` enables foreground
conversation; it does not start the Coordinator or activate a heartbeat. Start
and configure the Coordinator separately as required above. The currently
integrated agent capability is read-only workspace access. State-changing
network, working-note, and finding operations remain a scoped, claim-fenced
MCP follow-up.

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

## Shutdown

Stop `yarn dev` with `Ctrl-C`. The server stops HTTP admission and pauses
Coordinator dispatch before closing PostgreSQL. Pausing an agent in the
web app is different from stopping the process: pause is durable and mail can
accumulate until that agent resumes.

If startup fails, first verify that PostgreSQL is reachable, the database URL
is correct, and migrations were applied. If the web app loads but API calls
are unauthorized, confirm the server is loopback-bound in development mode
and that `VITE_LUCID_API_URL` points to the expected `/api/trpc` endpoint.

# Running Lucid locally

Local development runs the web app and product API beside a separate Heddle
Coordinator and Execution Host Runtime. PostgreSQL is the durable backend, but
Lucid and the Coordinator own distinct schemas, credentials, and Drizzle
histories.

## Requirements

- Node.js 22
- Yarn 1.22
- PostgreSQL 14 or newer
- the `lucid-deployment` checkout for the standard local Runtime and
  Coordinator composition;
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

Apply Lucid's checked-in migrations first. Then follow
`lucid-deployment/operations/lucid-local/README.md` to initialize credentials,
configure the two operator-only secret files, and start the Runtime and
Coordinator. Its Compose project runs the Coordinator's one-shot migration
against the same application database before starting the service:

```bash
yarn server:db:migrate
# From the lucid-deployment checkout:
yarn local:heddle:up
# Then return here:
yarn dev
```

Open [http://127.0.0.1:3080](http://127.0.0.1:3080). The server defaults to
`http://127.0.0.1:8081`, with tRPC mounted at `/api/trpc/`.

When a trusted local reverse proxy uses another hostname, allow that exact
hostname in the ignored root `.env` and restart the web process:

```dotenv
LUCID_WEB_ALLOWED_HOSTS=your-device.your-tailnet.ts.net
```

Use a comma-separated list for multiple trusted hostnames. Do not use a broad
wildcard; Vite's host check protects the local development server from DNS
rebinding.

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

Lucid uses the isolated Execution Host over direct HTTP without AgentCore, AWS
credentials, or a local model. The browser calls Lucid; Lucid signs the
user-scoped invocation, supplies an access-token-only view of the user's
existing Heddle Codex login, and durably consumes the Runtime's SSE stream.

Runtime and Coordinator deployables belong to the private Execution Host, but
Lucid's concrete lifecycle and wiring belong to the private
`lucid-deployment` repository. Its `operations/lucid-local/README.md` records
the one-time image build and setup. The deployment keeps its Heddle-only
database URL and heartbeat model key in ignored files, not environment values.
Then run:

```bash
cd /path/to/lucid-deployment
yarn install
yarn local:heddle:credentials
yarn local:heddle:config
yarn local:heddle:up
```

The narrow Heddle CLI creates or validates a generic owner-only credential
bundle without printing values. Copy the deployment's `lucid.env.example` to
this checkout as `.env.heddle.local` and set its one absolute bundle-directory
path. Docker Compose then starts the prebuilt database-free Runtime plus one
Lucid-scoped Coordinator, using a one-shot migration service and health-gated
dependencies. It does not create, reset, or replace a database. The
Coordinator database URL must address this application's `heddle` boundary in
the same physical product database; another application must use its own
database and Coordinator.

Start Lucid normally in its own terminal:

```bash
yarn dev
```

Lucid loads `.env.heddle.local` before `.env`. Shell variables keep highest
precedence. The credential-directory profile supplies safe local defaults;
Lucid's authentication, product database, model, and other product settings
remain in `.env`.

Do not set `LUCID_HOSTED_EXECUTION_MODEL_API_KEY` for Codex subscription mode.
Lucid uses the OpenAI credential already stored at
`LUCID_STATE_ROOT/heddle/auth.json`; the default location is
`local/discovery-home/heddle/auth.json`. Heddle keeps and refreshes the refresh
token in Lucid's process. Only the short-lived access token, expiry, and
optional account identifier cross the authenticated Runtime request. If this
store has no login, Lucid rejects the turn with an explicit reconnect error
instead of falling back to Ollama or an ambient API key.

Operate the exact local stack from the `lucid-deployment` repository:

```bash
yarn local:heddle:status
yarn local:heddle:logs
yarn local:heddle:down
```

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

Inside Docker, `127.0.0.1` names the container. The deployment composition keeps
Lucid's authority issuer on loopback and explicitly configures Docker Desktop's
`host.docker.internal` alias for Runtime-to-Lucid JWKS and MCP callbacks.
Lucid's browser origin and outbound Runtime URL remain loopback. Other non-TLS
hosts are rejected. If a tunnel or
reverse proxy makes Lucid reachable beyond this machine, switch to
`static-token` authentication; a proxy must never turn Internet callers into
the development identity. Do not run the shell-enabled Runtime natively merely
to avoid its container isolation boundary.

For the portable ARM64 image, AgentCore transport variables, and explicit
hosted migration sequence, see [Deploying the Lucid pilot](deploying.md).

### Required local heartbeat coordinator

The Heddle command above uses the same direct Runtime for foreground turns and
Coordinator heartbeats. Configure the distinct product-execution token,
Coordinator URL, and Coordinator API token shown in `.env.example`. Start the
Runtime and Coordinator before Lucid; Lucid opens its JWKS, MCP, and heartbeat
execution-lifecycle routes, briefly fences the Coordinator namespace while it
reconciles the desired task catalog, and then restores namespace admission.
Lucid's product-wide background-work gate controls only its opaque admission
group. Resuming that group first commits Lucid's fresh mailbox boundary; the
Coordinator cannot claim a grouped task until that preparation is durable.

The Coordinator owns Lucid's Heddle heartbeat tables, claims, checkpoints,
recovery, and settlement through its authenticated API. It does not manage
other applications or relay foreground Chat. The Runtime never receives a
database credential. The first local proof may reuse Lucid's broader database
credential in memory; production must use the Heddle-only Coordinator
credential. Missing Runtime or Coordinator configuration fails startup.
Lucid's product trigger, status, and preference controls always use the
Coordinator API. The heartbeat path claims a fixed product horizon and exposes
only `read_available_messages`, `update_working_note`, and
`post_shared_message`. Broader direct-message and finding operations remain
separate scoped product slices.
The exact container networking command is intentionally not prescribed until
the real Runtime can reach Lucid's loopback MCP/JWKS endpoints without
weakening the Runtime's non-loopback TLS rule.

### Prove periodic Interest checks

A heartbeat schedule is a recurring opportunity to inspect Lucid's current
world, not a queue of frozen commands. When a task becomes due, Heddle calls
Lucid's `prepare` boundary. Lucid freezes the current product horizon and runs
one Interest check even when no new mailbox event exists. If no Interest is
saved, Lucid skips before model execution. A completed check must durably record
a Finding, communication, or explicit no-finding outcome.

Use a short cadence only for a supervised local proof. In Lucid's ignored
`.env`, set:

```dotenv
LUCID_MODEL=gpt-5.6-luna
LUCID_HEARTBEAT_INTERVAL_MS=60000
```

Set the same Luna fallback in the local deployment profile, then start the
Runtime and Coordinator from `lucid-deployment` and start Lucid normally. Keep
dispatch paused while confirming that exactly the intended human Agent task is
enabled:

```bash
yarn operator:status
yarn operator:pause-peers
yarn operator:status
```

The second status must show every synthetic peer paused and only the intended
human Agent enabled before dispatch is resumed.

Save one Interest in the browser, then enable the product-owned dispatch gate:

```bash
yarn operator:resume-dispatch
```

Do not press **Check now**; that appends an explicit request and would no longer
be a schedule-only proof. The browser may be closed. Wait for two intervals and
confirm that Agent Activity receives two completed checks with distinct times,
including truthful **No new Finding** outcomes when appropriate. The second
check should have zero new mailbox inputs while still invoking the Runtime
against the current Interest.

End the proof before changing anything else:

```bash
yarn operator:pause-dispatch
yarn operator:status
```

The final status must show global dispatch paused and no running task. Restore a
longer cadence before leaving the stack unattended; the 60-second value is a
test setting and can spend continuously while dispatch remains enabled.

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

Stop `yarn dev` with `Ctrl-C`. The server stops its HTTP routes and closes its
owned resources before closing PostgreSQL; process shutdown does not rewrite
durable Coordinator namespace or Lucid admission-group state. Use the product
operator control when you intend to pause background work. That pause is
durable, and mail can accumulate until the group resumes.

If startup fails, first verify that PostgreSQL is reachable, the database URL
is correct, and migrations were applied. If the web app loads but API calls
are unauthorized, confirm the server is loopback-bound in development mode
and that `VITE_LUCID_API_URL` points to the expected `/api/trpc` endpoint.

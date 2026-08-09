# Lucid agent runtime

This workspace is a generic, database-free Heddle workstation behind AWS
AgentCore Runtime's custom-container HTTP contract. It is a local feasibility
artifact, not the Lucid representative worker and not evidence that managed
AgentCore isolation has passed.

## Boundary

The runtime owns only:

- `GET /ping` with `Healthy` or `HealthyBusy`;
- one complete Heddle turn on each `POST /invocations` SSE stream;
- immutable binding of one process to one AgentCore session, adopter, tenant,
  user, and conversation;
- isolated workspace, framework state, child processes, and bounded execution;
- translation from Heddle's ordered run events to SSE.

It does not receive PostgreSQL credentials, open Lucid tables, schedule
representatives, authenticate product users, or expose Lucid MCP tools. The
existing server remains Lucid's identity, control, and data plane.

## Security posture

The workstation profile includes file reads/writes, shell inspection and
mutation, artifacts, external reads, and the plan tool. Memory, browser, and
MCP capabilities are excluded. That profile is intentionally powerful and may
run only inside a dedicated container or provider isolation boundary.

Local mode refuses to start unless `LUCID_AGENT_RUNTIME_ISOLATED=true` and a
SHA-256 verifier for a high-entropy local token are supplied. The plaintext
token stays in the caller shell; only its one-way verifier enters the container.
The runtime also
rejects ambient model, database, and static AWS credentials. The OpenAI API key
arrives only in `X-Lucid-Model-Api-Key`, is retained in JavaScript memory for
one engine, and is redacted from Node's request-header views. Never put that
key in the runtime environment or image.

AgentCore workload-role credentials may be reachable from shell through the
provider metadata path. The future Runtime role must therefore be
least-privilege and must have no Lucid database or product-data access. This is
part of the managed W1 test, not something a local container can prove.

## Build the ARM64 image

The Dockerfile pins the current Node 22 Bookworm slim OCI index and installs a
non-root Linux workstation with Bash, coreutils, curl, Git, jq, ripgrep,
Python, process tools, and a compiler toolchain.

From the repository root:

```bash
yarn agent-runtime:docker:build
```

This builds `lucid-agent-runtime:local` for `linux/arm64`, matching AgentCore's
container architecture.

## Run one isolated local session

Generate a local ingress token in the client shell, then start the container.
The model key is deliberately not passed to Docker:

```bash
export LUCID_AGENT_RUNTIME_LOCAL_TOKEN="$(openssl rand -hex 32)"
export LUCID_AGENT_RUNTIME_LOCAL_TOKEN_SHA256="$(
  printf '%s' "${LUCID_AGENT_RUNTIME_LOCAL_TOKEN}" \
    | openssl dgst -sha256 -r \
    | cut -d' ' -f1
)"

docker run --rm --name lucid-agent-runtime-a \
  --platform linux/arm64 \
  --publish 127.0.0.1:18080:8080 \
  --cpus 1 --memory 2g --pids-limit 256 \
  --cap-drop ALL --security-opt no-new-privileges \
  --env LUCID_AGENT_RUNTIME_MODE=local \
  --env LUCID_AGENT_RUNTIME_ISOLATED=true \
  --env LUCID_AGENT_RUNTIME_LOCAL_TOKEN_SHA256 \
  lucid-agent-runtime:local
```

The verifier is not accepted as a bearer token and may be visible to the local
Docker daemon. The plaintext token is not present in container configuration,
process environments, or health-check processes.

In another shell, export the same local token and a model key, then invoke one
turn. The client reads both secrets from its own environment and never places
the model key in command arguments:

```bash
export LUCID_AGENT_RUNTIME_LOCAL_TOKEN="the-same-local-token"
export OPENAI_API_KEY="your-key-from-a-secure-source"
yarn agent-runtime:invoke -- "Inspect /workspace and explain what is available."
```

The default client scope and Runtime session are stable, so sequential calls
reuse the same isolated conversation and filesystem. Change the
`LUCID_AGENT_RUNTIME_*_ID` client variables only when starting a fresh
container; changing scope within a bound process is rejected.

To exercise a repository fixture, mount only that fixture into `/workspace`.
Do not mount the repository root, home directory, Docker socket, credential
directory, or SSH agent.

## Wire contract

The request uses the official
`X-Amzn-Bedrock-AgentCore-Runtime-Session-Id` header, the local-only
`X-Lucid-Local-Runtime-Token` header, and the model credential header described
above. Its JSON body is versioned:

```json
{
  "schemaVersion": 1,
  "kind": "conversation-turn",
  "invocationId": "opaque-correlation-id",
  "scope": {
    "adopterId": "heddle-customer",
    "tenantId": "company-a",
    "userId": "user-a",
    "conversationId": "conversation-a"
  },
  "prompt": "Solve one concrete task",
  "deadlineAt": "2026-08-09T12:00:00.000Z"
}
```

The stream emits `accepted`, zero or more `activity` events, and exactly one
`result`, `cancelled`, or `error` terminal. IDs are monotonically sequenced;
SSE comments keep long quiet periods alive, and event writes honor transport
backpressure. A second concurrent turn, expired deadline, or changed scope
fails closed.

The process also rejects its 128 most recently completed invocation IDs to
suppress accidental warm retries. That bounded in-memory cache is not durable
idempotency: eviction or process replacement forgets it. The future Lucid
control plane must own durable invocation identity and side-effect recovery.

Local disconnect cancels the exact Heddle run. That does not prove AgentCore's
SDK abort or `StopRuntimeSession` behavior; those remain paid-spike tests.

## Checks

```bash
yarn workspace @lucid/agent-runtime typecheck
yarn workspace @lucid/agent-runtime test
yarn workspace @lucid/agent-runtime build
```

The focused suite uses an injected deterministic executor. A live model is not
required and no external service is called.

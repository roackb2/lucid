# Hosted heartbeat delegation

This boundary connects Lucid product ownership to the separate Heddle
Coordinator without making either service depend on the other's database.

At server startup, Lucid projects its current users, agents, and workspace into
Heddle's desired-task vocabulary. The public Execution Host client then owns
the authenticated coordinator call, pause/delete/upsert/resume ordering, stale
task replacement, input validation, and failure behavior. Retired users are
omitted, active users are enabled, disabled users remain represented but
disabled, and the global Lucid background-work gate decides whether the
coordinator resumes. A failed reconciliation leaves the coordinator paused and
fails Lucid startup.

Immediately before an autonomous run, the coordinator uses the separate
delegation route to obtain one short-lived Lucid execution bundle.

Lucid owns task-to-agent/user resolution, the global background-work gate, and
the allowed product MCP tools. Lucid returns only the current product scope and
tool policy. Heddle owns stable Runtime session identity, deadlines,
execution/MCP authority issuance, the delegation wire contract, bearer
authentication, request bounds, safe errors, and shutdown. The coordinator
sends only a persisted Heddle task ID and its claim-fenced execution ID. It
does not receive a user session token, signing key, Lucid database credential,
or authority to query product tables. Its model credential comes directly from
the coordinator deployment's own secret store rather than crossing this HTTP
boundary.

The Heddle-owned route is private, bearer-authenticated, non-cacheable, and
deliberately limited to `heartbeat-task`. Credentials are returned once for the
requested execution and must remain in memory only. The AgentCore Runtime still
receives no Lucid or Heddle database credential.

The only Lucid implementations in this folder are therefore:

- `desired-task-catalog.ts`: product state to Heddle desired tasks;
- `delegation-authorizer.ts`: current product identity and policy for one
  claimed task.

The two directions use distinct secrets:

- `LUCID_HOSTED_HEARTBEAT_COORDINATOR_API_TOKEN` authenticates Lucid's desired
  task calls to the coordinator;
- `LUCID_HOSTED_HEARTBEAT_COORDINATOR_TOKEN` authenticates the coordinator's
  delegation calls back to Lucid.

This slice reconciles the catalog at startup for the local architecture proof.
Lucid's existing product trigger, status, enable/disable, and reset flows still
use the embedded heartbeat service until that product-facing migration is
selected explicitly. The embedded worker does not start while coordinator mode
is configured, so the two authorities cannot execute the same autonomous work.
The bounded local proof triggers through the coordinator API.

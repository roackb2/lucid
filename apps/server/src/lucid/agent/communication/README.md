# Agent communication service

This slice exposes the bounded Lucid tools available to one agent
during one claimed wake. It owns mailbox visibility, reply routing, source
validation, peer eligibility, action budgets, provenance, and idempotent event
writes.

`AgentWorkService` constructs this service from a durable `AgentWorkClaim` on
every hosted MCP call. That deliberate rehydration means retries and separate
HTTP requests reload action ordinals, unanswered request threads, and
required-effect state from PostgreSQL; the MCP process does not become an
in-memory work authority.

## Shape

- `tool-service.ts` validates every model-requested communication action.
- `store.ts` defines only the reads and writes required by those tools.
- `postgres-store.ts` implements visibility, provenance traversal, request
  thread checks, and communication-event writes with Drizzle.
- `../mailbox-policy.ts` supplies the agent-owned principal-event
  visibility policy shared by wake and communication adapters.
- `tool-service.test.ts` covers the tool and persistence boundary against
  disposable PostgreSQL.

The fixed wake horizon prevents concurrent arrivals from changing current
model input. A agent may see shared messages from others, direct
messages addressed to it, and its own user's private inputs after the
mailbox floor. Source IDs must resolve inside that same visible set. Recursive
origin resolution prevents relays from appearing as independent evidence.

`read_open_requests` projects only peer-authored request threads the current
agent has not answered. A wake containing new private principal input is
instructed to review that queue before it acts. While an unanswered request
remains, incoming Findings stay unavailable; the agent must answer a concrete
match or durably finish with no action. This rule is reconstructed from
durable request and reply threads on every MCP call rather than from a
process-memory "reviewed" flag. Findings accept only peer-authored responses or
contributions as direct provenance, so private principal input cannot be echoed
back as if the network discovered it. A shared response based on private
principal context must also leave `source_event_ids` empty: the message
discloses its deliberately minimized content, not a public link to the private
event.

`appendClaimedCommunicationEvent` accepts only working-note updates, shared or
direct messages, findings, and no-action records. It locks the agent row and
checks the active work ID, execution token, and work number in the same
transaction as the event insert. A stale attempt therefore cannot consume a
replacement attempt's retry-stable idempotency slot. Other event kinds stay
owned by their workspace, network, or wake stores.

This slice does not enumerate unknown users, decide whether content is
true or useful, schedule agents, or expose private user context.

The hosted heartbeat surface exports the claimed working context, mailbox and
open-request reads, working-note update, shared and direct replies, Finding
delivery, and explicit no-action settlement. The signed capability and the
active Coordinator execution fence select the work claim; model arguments
never carry user, agent, work, execution, or horizon identifiers.

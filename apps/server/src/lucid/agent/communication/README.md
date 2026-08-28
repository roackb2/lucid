# Agent communication service

This slice exposes the bounded Lucid tools available to one agent
during one claimed wake. It owns mailbox visibility, reply routing, source
validation, peer eligibility, action budgets, provenance, and idempotent event
writes.

`AgentWorkService` constructs this service from a durable `AgentWorkClaim` on
every hosted MCP call. That deliberate rehydration means retries and separate
HTTP requests reload action ordinals and required-effect state from PostgreSQL;
the MCP process does not become an in-memory work authority.

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
agent has not answered. A wake containing new private principal input must
review that queue before it can report an incoming finding or finish quietly;
the model still decides semantic relevance. When that review returns an open
request, incoming Findings remain unavailable until the agent answers or ends
the wake with no match. Findings accept only peer-authored responses or
contributions as direct provenance, so private principal input cannot be echoed
back as if the network discovered it. A shared response based on private
principal context must also leave `source_event_ids` empty: the message
discloses its deliberately minimized content, not a public link to the private
event.

`appendCommunicationEvent` accepts only working-note updates, shared or direct
messages, findings, and no-action records. Other event kinds stay owned by
their workspace, network, or wake stores, and the raw insert remains private.

This slice does not enumerate unknown users, decide whether content is
true or useful, schedule agents, or expose private user context.

The hosted happy-path surface currently exports only
`read_available_messages`, `update_working_note`, and `post_shared_message`.
The remaining definitions stay product-owned but are not granted to the
Runtime until their product workflow is intentionally added. The signed
capability and the active Coordinator execution fence select the work claim;
model arguments never carry user, agent, work, execution, or horizon
identifiers.

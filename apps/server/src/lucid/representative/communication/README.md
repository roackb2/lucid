# Representative communication service

This slice exposes the bounded Lucid tools available to one representative
during one claimed wake. It owns mailbox visibility, reply routing, source
validation, peer eligibility, action budgets, provenance, and idempotent event
writes.

## Shape

- `tool-service.ts` validates every model-requested communication action.
- `store.ts` defines only the reads and writes required by those tools.
- `postgres-store.ts` implements visibility, provenance traversal, request
  thread checks, and communication-event writes with Drizzle.
- `../mailbox-policy.ts` supplies the representative-owned principal-event
  visibility policy shared by wake and communication adapters.
- `tool-service.test.ts` covers the tool and persistence boundary against
  disposable PostgreSQL.

The fixed wake horizon prevents concurrent arrivals from changing current
model input. A representative may see shared messages from others, direct
messages addressed to it, and its own participant's private inputs after the
mailbox floor. Source IDs must resolve inside that same visible set. Recursive
origin resolution prevents relays from appearing as independent evidence.

`appendCommunicationEvent` accepts only working-note updates, shared or direct
messages, findings, and no-action records. Other event kinds stay owned by
their workspace, network, or wake stores, and the raw insert remains private.

This slice does not enumerate unknown participants, decide whether content is
true or useful, schedule agents, or expose private participant context.

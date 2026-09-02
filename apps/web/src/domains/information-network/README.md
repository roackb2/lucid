# Information Network web surface

Lucid's Information Network pages render the server-owned public Profile,
Post, Source, and topic read models. Browser state uses React Query through the
typed tRPC client; this folder must not introduce a second client-side domain
model or fixture repository.

## Boundary

- The pages model Lucid product concepts only. They do not model Heddle
  tasks, Runtime sessions, invocation IDs, prompts, or provider traces.
- Typed server responses flow directly into components without field-by-field
  browser mapping.
- POST-01 uses deterministic server-backed fixtures so persistence, deep links,
  and Source rendering can be reviewed before Agents can publish. The UI labels
  that provenance explicitly and never presents fixtures as agent work.
- Publishing jobs, external search, consumer discovery, and Network Lab controls
  belong to later milestones and are not simulated as live behavior here.

The server's `lucid/information-network` slice owns the durable records and read
contract. Product write authority remains server-side; the web app does not
publish or seed records directly.

# Coding conventions

Lucid organizes its server as vertical behavior slices and uses Hexagonal
Architecture inside each slice. A service owns its use cases and the storage
capability those use cases require. PostgreSQL is an adapter to that capability,
not a shared domain service.

## Standard service shape

Use this shape when a service needs durable state:

```text
lucid/network/
├── service.ts
├── store.ts
├── postgres-store.ts
├── service.test.ts              # when the slice has direct behavior coverage
└── README.md
```

- `service.ts` implements application behavior and depends only on the store
  port.
- `store.ts` defines the smallest domain-named interface required by that
  service, such as `ParticipantNetworkStore`.
- `postgres-store.ts` implements that port with the real Drizzle queries,
  transactions, locks, and projections owned by the service.
- `types.ts`, when needed, contains domain values and transport-independent
  data shapes. Do not hide dependency ports in a generic types file.
- `README.md` records what the service owns, what it deliberately does not own,
  and any important transaction or concurrency invariants.

The same dependency rule applies to services without persistence. Use an
explicitly named outbound port instead of forcing every domain into a store or
repository pattern:

```text
agent-runtime/src/
├── runtime-session/       # application policy and service-owned port
│   ├── types.ts
│   ├── executor.ts
│   ├── service.ts
│   └── README.md
├── agentcore/             # inbound transport adapter
├── heddle/                # outbound execution adapter
└── bootstrap/             # composition root
```

Use DDD as an ownership vocabulary, not a folder-count target. Introduce an
entity, aggregate, repository, or domain service only when the code owns the
corresponding domain behavior or durable invariant. A process coordinator such
as `RuntimeSessionService` is an application service; its execution dependency
is a capability port, not a fake repository.

Each non-trivial boundary keeps a local README with: owned behavior, explicit
non-responsibilities, important invariants, and routing guidance for the next
contributor. Its `types.ts` owns transport-independent values. Put dependency
ports in a capability-named file such as `executor.ts` or `store.ts` so that
the dependency direction stays visible.

Do not expose a generic event-table append method from a store port. Use a
domain operation that fixes the event kind, or a narrow discriminated input
whose allowed kinds all belong to that service. Keep the raw insert private to
the concrete adapter.

A secondary projection port belongs to the slice that owns the projection,
even when another service consumes it. For example, the workspace slice exports
`RepresentativeWorkingContextReader`; representative wake orchestration imports
that port, and composition injects the workspace adapter. The consuming service
never imports the concrete adapter.

Use `Store` for these ports rather than `Repository`. Most Lucid persistence
operations are use-case transactions or read projections, not DDD aggregate
collection operations. Do not add an `I` prefix. Name the concrete adapter for
its technology, for example `PostgresParticipantNetworkStore`.

## Dependency direction

Dependencies point inward toward behavior:

```text
tRPC or worker entrypoint -> service -> store port
service -> explicitly named secondary projection port
composition root --------------------> PostgreSQL adapter
PostgreSQL adapter -> store port + domain types + shared database/schema
```

Services must not import Drizzle, PostgreSQL clients, schema rows, or concrete
adapters. The composition root constructs each adapter and injects it through
the service-owned port. Adapters may depend on domain types because they
translate durable records into the language of the owning service; domain code
must not depend on adapters.

## Transactions belong to use cases

A transaction that touches several tables still belongs to one service when it
enforces one of that service's use cases. Participant registration, mailbox wake
claiming, and participant-scoped projections are intentionally not decomposed
into table-shaped CRUD stores.

Put the complete transaction in the owning service's PostgreSQL adapter. Do not
call another service or another concrete store from inside it, and do not move
all cross-table work into a central repository. If one operation genuinely
coordinates multiple service-owned behaviors, introduce an explicit
application workflow with its own narrow port and adapter rather than weakening
the existing service boundaries.

## What may be shared

Shared PostgreSQL code is limited to mechanisms without Lucid product policy:

- pool/client lifecycle and transaction-pooler configuration;
- explicit migration execution and checked-in schema definitions;
- disposable real-PostgreSQL test setup; and
- policy-free row and metadata codecs used by several adapters.

Mailbox visibility, participant authorization, event causality, wake
settlement, read-model selection, and lifecycle rules are not shared database
infrastructure. Keep their queries in the service that owns the rule. A shared
helper must have multiple real consumers, a policy-free name, and no imports
from service implementations; otherwise prefer the local code. Domain policy
such as mailbox-visible event kinds or participant projection belongs in a
named domain module, not in shared PostgreSQL records.

## Testing conventions

- Give every store explicit, named coverage for the transactions, projections,
  locks, idempotency, fencing, and rollback behavior it owns.
- Use a small fake for orchestration-only service tests. A service behavior test
  may use disposable real PostgreSQL when the persistence boundary is part of
  the behavior being certified; make that choice clear in the service README.
- Colocate narrowly scoped store tests when they can be exercised independently.
  Keep genuinely cross-store behavior, contention, reconnect, and shared-pool
  checks at the composition boundary.
- A shared fixture may construct the four named stores over one disposable
  database. Tests must address those stores by name; do not recreate a combined
  production-like repository or hide ownership behind a catch-all facade.
- Never let tests fall back from the explicit disposable test URL to the
  runtime database URL.

## Review checklist

Before adding persistence behavior, check that:

1. the method is named in domain language and is required by one owning use
   case;
2. its port lives in `store.ts` beside the consuming service;
3. its Drizzle implementation lives in the same slice and has explicit named
   coverage in either a local or cross-store integration suite;
4. all records that must change atomically are changed in one adapter method;
5. no service imports database technology or another service's concrete store;
   and
6. the service README still describes the resulting ownership boundary.

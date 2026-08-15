# Hosted conversation application boundary

This folder contains Lucid's product admission and recent-history query for one
hosted conversation. It does not implement the generic hosted-turn lifecycle.

## Ownership

`HostedConversationAdmissionService` owns:

- requiring an authenticated Lucid user;
- selecting Lucid's tenant, subject, and product-session scope;
- assigning the invocation ID and stable Runtime session ID; and
- applying Lucid's configured turn deadline.

The composed `DurableHostedConversationTurnService` from
`@heddleagent/execution-host-client/conversation` owns requested, accepted,
terminal, cancellation, interruption, expiry, safe failure projection, and
persistence-before-event ordering. Its injected implementation comes from
`@heddleagent/postgres/execution-host/conversations`; Lucid does not repeat
those transitions or SQL fences.

`HostedConversationHistoryService` owns only the product read policy:

- derive the subject from the authenticated server principal;
- reconcile expired open records through the public Heddle lifecycle API; and
- return the newest 20 records in that exact tenant/subject/session scope.

`PostgresHostedConversationHistoryStore` implements that bounded query over
the exported Heddle table. It does not mutate lifecycle state. The browser
receives prompt, status, public summary, safe failure code, and public
timestamps only; activity, tool payloads, assertions, credentials, traces,
reasoning, and raw errors remain excluded.

## Composition and migration

`composition/postgres-persistence.ts` creates the official Heddle lifecycle
store over Lucid's owned Drizzle handle. `composition/hosted-execution.ts`
wraps the package's base turn runner with that lifecycle before product
admission. Both use the same authorized scope.

Lucid still owns when migrations run. Migration `0005` installs the SQL shipped
by `@heddleagent/postgres@6.0.0` as a custom Drizzle migration because Drizzle
Kit's schema loader cannot consume the package's ESM-only subpath. Runtime code
uses the public package export directly; the table is not redeclared here.

## Verification boundary

- `admission-service.test.ts` covers Lucid authentication and derived scope.
- `history-service.test.ts` covers the fixed user scope and 20-row policy.
- `postgres-history-store.integration.test.ts` covers real PostgreSQL history,
  reconnect durability, deterministic bounding, and user isolation.
- Heddle's own package suite covers generic lifecycle transitions and fencing;
  those cases should not be duplicated in Lucid.

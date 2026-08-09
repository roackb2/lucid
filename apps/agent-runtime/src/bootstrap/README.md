# Runtime bootstrap

This is the composition root and environment adapter for the deployable
process. It is the only boundary allowed to import the AgentCore adapter, the
runtime-session service, and the concrete Heddle executor together.

## Owns

- fail-closed environment parsing and secret-presence checks;
- creation of writable roots, logger, HTTP server, service, and adapters;
- process listening and SIGINT/SIGTERM shutdown wiring.

`types.ts` composes the narrow configuration shapes owned by each boundary.
`config.ts` validates environment input into that combined bootstrap shape.

## Does not own

- invocation, tenant, tool, or product policy;
- HTTP wire schemas or Heddle execution behavior;
- migrations, PostgreSQL, or cloud-resource provisioning.

New dependencies are wired here through existing service-owned ports. Do not
put business fallbacks into configuration parsing or call concrete adapters
from another service.

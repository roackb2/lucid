# Heddle execution adapter

This outbound adapter implements the runtime session's `AgentTurnExecutor`
port with public Heddle APIs.

## Owns

- concrete conversation-engine and session construction;
- the hosted workstation tool/capability profile and approval policy;
- Heddle run replay bounds, step/concurrency limits, and result projection;
- Heddle-specific filesystem and model configuration.

## Does not own

- AgentCore HTTP, authentication, SSE, or provider session routing;
- runtime-session admission, tenant binding, deadlines, or shutdown policy;
- Lucid identity, database access, task claims, or MCP authorization.

New Heddle capabilities or a different tool profile belong here and require
focused policy coverage. A different execution engine should implement the
same service-owned port in a sibling adapter instead of adding provider
branches to `RuntimeSessionService`.

# Hosted conversation application service

This boundary coordinates one Lucid `conversation-turn` against a separately
deployed Heddle Execution Host. It is product application code, not an agent
loop or an AgentCore adapter.

## Ownership

`HostedConversationTurnService` owns:

- fixing the Lucid product MCP allowlist for the turn;
- asking the public adopter authority to mint execution and MCP credentials;
- resolving the model credential through a narrow secret-provider port; and
- forwarding the provider-neutral ordered event stream to its caller.

It does not own:

- browser authentication, tenant lookup, or authorization;
- HTTP routes, JWKS or MCP route registration, or AWS SigV4;
- durable invocation uniqueness, replay, retry, or result projection;
- the Heddle loop, isolated workspace, or process lifecycle; or
- representative heartbeat task/wake claims and settlement.

The caller must derive `scope`, Runtime session ID, and invocation ID from
authenticated product state. Model-controlled input must never choose those
values. `HostedConversationTurnService` deliberately exposes no caller-owned
tool allowlist: every turn receives only `LUCID_PRODUCT_MCP_TOOLS`.

`service.integration.test.ts` runs the service through the public
`@roackb2/heddle-adopter/testing` HTTP/SSE fixture and Lucid's real local MCP
edge. That test proves the adopter control-plane round trip without a model,
Docker, AWS, or the private Execution Host. Real-host and managed-runtime tests
remain separate evidence boundaries.

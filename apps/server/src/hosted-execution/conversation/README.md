# Hosted conversation application service

This boundary supplies Lucid's product admission for one `conversation-turn`
against a separately deployed Heddle Execution Host. Generic authority and
host invocation live in `@roackb2/heddle-adopter/conversation`; this folder is
product application code, not another agent loop or transport adapter.

## Ownership

`HostedConversationAdmissionService` owns:

- requiring the authenticated local user role and product identity;
- deriving the fixed Lucid tenant, subject, and product-session scope;
- assigning a unique invocation ID and stable Runtime session ID; and
- bounding the turn with the configured deadline.

The package-owned `HostedConversationTurnService` owns:

- fixing the Lucid product MCP allowlist for the turn;
- asking the public adopter authority to mint execution and MCP credentials;
- resolving the model credential through a narrow secret-provider port; and
- forwarding the provider-neutral ordered event stream to its caller.

It does not own:

- browser authentication, tenant lookup, or authorization;
- HTTP routes, JWKS or MCP route registration, or AWS SigV4;
- durable invocation uniqueness, replay, retry, or result projection;
- the Heddle loop, isolated workspace, or process lifecycle; or
- agent heartbeat task/wake claims and settlement.

The HTTP router authenticates and parses requests, then delegates product
admission instead of deriving authority itself. Model-controlled input never
chooses scope, Runtime session ID, invocation ID, deadline, or MCP tools.
Composition deliberately fixes `LUCID_PRODUCT_MCP_TOOLS` when constructing the
package service. No route or model-controlled request can select a tool.

`hosted-conversation.integration.test.ts` runs the package service through the
public `@roackb2/heddle-adopter/testing` HTTP/SSE fixture and Lucid's real local
MCP edge. That test proves the adopter control-plane round trip without a
model, Docker, AWS, or the private Execution Host. Real-host and
managed-runtime tests remain separate evidence boundaries.

`types.ts` contains only Lucid's request-service port; generic turn and model
credential types come directly from the public package.

`admission-service.test.ts` independently fixes the user, session, ID,
deadline, and cancellation behavior so composition tests do not become the
only description of Lucid's admission policy.

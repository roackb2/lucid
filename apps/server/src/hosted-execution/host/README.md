# Execution Host outbound port

This service boundary lets Lucid request one hosted agent turn without
importing the private Execution Host repository or AWS SDK types.

## Ownership

The port owns Lucid's provider-neutral view of the versioned conversation-turn
request and ordered event stream. Its direct HTTP adapter owns the local host
protocol: fixed endpoint selection, sensitive request headers, strict v1 SSE
validation, cancellation, and fail-closed handling of ambiguous streams.

It does not own product authentication, tenant mapping, assertion minting, MCP
authorization, model credentials, durable invocation records, retry policy, or
AgentCore SigV4 transport. Those values must be supplied by an authorized
application service. A future AgentCore adapter implements this same port.

## Stream invariants

- `accepted` is sequence zero and appears exactly once.
- Every later event has the same invocation and run identity with contiguous
  sequence numbers.
- One `result`, `cancelled`, or `error` event terminates the stream.
- A malformed frame, event after terminal, or identity mismatch fails closed.
- EOF after acceptance but before a terminal event is interrupted/unknown,
  never success and never an automatic retry signal.
- Caller cancellation aborts the HTTP request and is reported separately from
  remote interruption.

The adapter rejects redirects so execution assertions, model credentials, and
MCP capabilities cannot be forwarded to an unreviewed destination.

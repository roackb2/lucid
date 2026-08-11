# AgentCore execution adapter

This adapter is Lucid's provider-specific implementation of the public
`ExecutionHost` port. It sends the language-neutral invocation contract through
AWS `InvokeAgentRuntime` and delegates strict request/SSE validation to
`@roackb2/heddle-adopter`.

It owns:

- AWS SDK configuration and default credential-chain usage;
- one-attempt invocation semantics, because a disconnected streaming turn has
  ambiguous settlement and must not be replayed automatically;
- command-scoped, SigV4-signed custom headers for execution authority, product
  MCP authority, and model access; and
- conversion of the AWS streaming body into the adopter contract stream.

It does not own product authentication, capability minting, PostgreSQL access,
tool policy, conversation projection, or AgentCore Runtime provisioning. Those
remain respectively in Lucid, the public adopter package, or the private
Terraform deployment.

The Runtime must allowlist the three names exported as
`AGENTCORE_FORWARDED_HEADER_NAMES`. The direct-host local token is deliberately
excluded and never reaches AWS. Configuration uses the AWS default credential
chain; deployed EC2 instances should rely on their least-privilege instance
role rather than a profile or static AWS keys.

# Request authentication

This directory owns the product HTTP identity boundary. Route inputs never
select a participant or operator identity; `server.ts` authenticates the raw
request and installs a `LucidRequestPrincipal` in the tRPC context.

Two adapters exist for the local hosted proof:

- `development` maps a loopback socket to the seeded local participant and is
  rejected by configuration when the server binds to a non-loopback host.
- `static-token` accepts separate high-entropy participant and operator bearer
  tokens. It is suitable only for a private single-user pilot over TLS.

The operator token has participant access so one private owner can use both the
product UI and the small remote-safe operator surface. Network diagnostics,
synthetic participant ingress, and reset remain loopback-only development
routes. The participant token cannot call operator routes. A future OIDC or
Supabase adapter should implement
`LucidAuthenticator`; it must preserve the same server-derived principal shape
and must not push provider claims into Lucid domain services.

Never log authorization headers or configured tokens. Static tokens belong in
the deployment secret store, not committed environment files or a browser
bundle. The ordinary local web app uses `development` mode and therefore needs
no client-side secret.

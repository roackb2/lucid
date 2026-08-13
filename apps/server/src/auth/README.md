# Request authentication

This directory owns the product HTTP identity boundary. Route inputs never
select a user or operator identity; `server.ts` authenticates the raw
request and installs a `LucidRequestPrincipal` in the tRPC context.

Three adapters exist:

- `development` maps a loopback socket to the seeded local user and is
  rejected by configuration when the server binds to a non-loopback host.
- `static-token` accepts separate high-entropy user and operator bearer
  tokens. It is suitable only for a private single-user pilot over TLS.
- `supabase` verifies an asymmetric Supabase access token against the project's
  JWKS and then resolves `(issuer, subject)` through Lucid's durable user
  binding. Google profile claims and email are never product authorization.

The operator token has user access so one private owner can use both the
product UI and the small remote-safe operator surface. Network diagnostics,
synthetic user ingress, and reset remain loopback-only development
routes. The user token cannot call operator routes. An authenticated but
unbound Supabase subject may call only `identity.session` and, when explicitly
enabled by deployment policy, `identity.enroll`. Discovery and model invocation
remain unavailable until a durable user binding exists.

Never log authorization headers or configured tokens. Static tokens belong in
the deployment secret store, not committed environment files or a browser
bundle. The ordinary local web app uses `development` mode and therefore needs
no client-side secret. Hosted Supabase mode needs only the public project URL
and publishable key in the browser bundle; the Google client secret stays in
Supabase and any service-role key stays out of Lucid entirely.

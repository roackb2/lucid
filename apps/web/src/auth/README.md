# Browser authentication

This boundary owns the browser session for Lucid's human-facing product. In
Supabase mode it starts Google OAuth with PKCE, follows Supabase session
changes, and supplies the current access token to Lucid's HTTP clients.

It does not decide which Lucid user an external identity represents.
The server verifies the Supabase JWT and resolves its `(issuer, subject)` pair
through the durable user-network identity boundary. Email and other
provider profile fields are never Lucid identity keys.

When the authenticated user changes, this boundary clears the React Query
cache before the next user-scoped request. Static development tokens
remain a separate legacy mode and are never combined with a Supabase session.
Replacing a legacy token also clears the entire query and mutation cache first,
because the opaque credential does not expose a stable browser-side subject.

Chat readiness comes from the authenticated Lucid server. In loopback-only
development mode, an enabled Chat transport may use a non-secret client marker
because the server still derives the user from the verified loopback socket.
Bearer deployments always require the active provider or static-token session.

Keep provider secrets out of this package. The browser receives only the
public Supabase project URL and publishable key; the Google client secret lives
in Supabase provider configuration.

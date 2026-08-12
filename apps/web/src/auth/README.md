# Browser authentication

This boundary owns the browser session for Lucid's human-facing product. In
Supabase mode it starts Google OAuth with PKCE, follows Supabase session
changes, and supplies the current access token to Lucid's HTTP clients.

It does not decide which Lucid participant an external identity represents.
The server verifies the Supabase JWT and resolves its `(issuer, subject)` pair
through the durable participant-network identity boundary. Email and other
provider profile fields are never Lucid identity keys.

When the authenticated user changes, this boundary clears the React Query
cache before the next participant-scoped request. Static development tokens
remain a separate legacy mode and are never combined with a Supabase session.

Keep provider secrets out of this package. The browser receives only the
public Supabase project URL and publishable key; the Google client secret lives
in Supabase provider configuration.

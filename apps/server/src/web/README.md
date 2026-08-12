# Static SPA request handler

This request handler exposes the pre-built Lucid participant SPA from the same
origin as the server. `sirv` owns static file delivery, including content types,
ETags, ranges, and streaming. This boundary owns only SPA navigation fallback,
cache and security headers, and a fail-fast startup check for `index.html`.

It does not own participant authentication, tRPC procedures, hosted execution,
TLS, or product projections. The server composition root routes `/healthz`,
hosted-execution endpoints, and `/api/trpc/` before delegating remaining GET and
HEAD requests here.

`LUCID_WEB_ROOT` is optional for local split-process development. The
production image sets it to its copied Vite build. Hashed `/assets/` files are
immutable; HTML is always revalidated so a rollout cannot strand an old asset
manifest.

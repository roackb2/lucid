# Lucid web

The web app is the local principal surface for First Return.

It owns presentation state only:

- ordinary-language intent and feedback form drafts;
- polling cadence while a bounded journey is active;
- mutation loading and user notifications;
- presentation of returns, causal sources, and disclosures;
- the optional Behind the glass observatory.

The server remains authoritative for principals, agents, visibility, journey
order, delivery, source validation, persistence, and cancellation. The UI
calls the typed tRPC router directly and never reconstructs domain state from
Heddle files.

The default experience is the private relationship between the principal and
Aster. The observatory is secondary laboratory tooling and must not become the
main product surface again.

# Lucid web

The web app is the operator surface for the Dream Terrarium.

It owns presentation state only:

- selected Dreamer trace filter;
- seed form state;
- polling cadence while a wake is active;
- optimistic loading and operator feedback.

The server remains authoritative for the world, active cycle, visibility,
scheduling, and persistence. The UI calls the typed tRPC router directly and
never reconstructs domain state from Heddle files.

The main operator flows are seed, one wake, full orbit, cancel, inspect, and new
generation. Any new control should map to a server-owned domain operation
instead of mutating cached snapshot data locally.

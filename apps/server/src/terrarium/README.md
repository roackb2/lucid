# Dream Terrarium service

This domain owns Lucid's small asynchronous world. It is deliberately separate
from Heddle's conversation runtime.

## Lucid owns

- stable Dreamer identity, persona, display metadata, and world cursor;
- the append-only causal event stream;
- public versus private event visibility;
- deterministic round-robin tick selection;
- operator seed, advance, cancel, and reset behavior;
- the two-action mutation budget for one wake cycle.

## Heddle owns

- one durable conversation session per Dreamer;
- the model/tool loop for one wake;
- tool-call execution, leases, cancellation, activity, trace, and result;
- persisted private conversation continuity across later wakes.

`HeddleDreamerMind` is the composition boundary. It gives Heddle only
Dreamer-scoped Lucid tools through an explicit custom tool-profile allowlist
and excludes default coding tools. `TerrariumRepository` never reads Heddle
files, and the Heddle adapter never decides world visibility or scheduling.

## Lifecycle

1. The operator adds a public seed event.
2. `DreamTerrariumService` selects the next Dreamer and snapshots its unread
   visible events.
3. `HeddleDreamerMind` resumes that Dreamer's stable conversation and exposes
   a scoped `DreamerWorldToolService`.
4. Tool calls append semantic world events.
5. Only a successful mind result advances the Dreamer's visible-event cursor.
   Cancellation or failure leaves unread events available for a later retry.

The active Heddle run is process-local. Completed world events and conversation
state are durable; an interrupted process cannot resume in-flight model
execution and instead retries the unread world input on a later wake.

Graceful host shutdown first stops accepting HTTP requests, aborts and settles
the active run, records the interrupted wake, and only then closes SQLite. On
unclean restart, `TerrariumRepository.initialize` releases any stale `waking`
status without advancing its event cursor.

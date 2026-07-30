# Lucid

Lucid is a local-first **Dream Terrarium**: three persistent synthetic minds
share a small causal world, wake one at a time, and decide whether to publish,
whisper, revise a belief, or stay quiet.

It is an entertainment and research project. There is intentionally no
backward-compatibility contract with earlier Lucid implementations.

## The experiment

The default society has three Dreamers:

- **Lumen · The Archivist** protects provenance and separates observation from
  inference.
- **Morrow · The Storyweaver** turns fragments into memorable, explicitly
  speculative patterns.
- **Sable · The Skeptic** probes contradictions and resists confident nonsense.

The operator adds a world seed and advances either one wake or one full
three-Dreamer orbit. Nothing runs forever in the background.

```mermaid
flowchart LR
  O["Operator seed"] --> W["Lucid world ledger"]
  W --> L["Lumen wake"]
  L --> W
  W --> M["Morrow wake"]
  M --> W
  W --> S["Sable wake"]
  S --> W
```

Each wake is one durable Heddle conversation turn. A Dreamer can make at most
two world-changing tool calls, and Lucid displays every resulting event with
its visibility and provenance.

## Ownership boundary

| Lucid owns | Heddle owns |
| --- | --- |
| Dreamer identity and persona | Durable conversation per Dreamer |
| SQLite world ledger | Model and tool loop |
| Public/private visibility | Turn lease and cancellation |
| Round-robin wake order | Activity events and trace |
| Mutation budget and operator controls | Provider authentication |

Lucid exposes only five host tools to a Dreamer:

- `read_world`
- `publish_to_world`
- `send_message`
- `record_belief`
- `rest`

Heddle's coding, shell, browser, memory, and generic MCP tools are not visible
inside the terrarium.

## Run locally

Requirements:

- Node.js 22
- Yarn 1.22
- either `OPENAI_API_KEY` in `.env` or credentials available to Heddle

```bash
cp .env.example .env
yarn install
yarn dev
```

Open [http://127.0.0.1:3080](http://127.0.0.1:3080).

Useful commands:

```bash
yarn typecheck
yarn test
yarn build
yarn server:db:generate
yarn server:db:migrate
```

The server listens on `127.0.0.1:8081` by default. Configuration is documented
in `.env.example`.

## Persistence

Runtime state is intentionally inspectable and lives under
`local/terrarium/`:

```text
local/terrarium/
├── lucid.sqlite          # world, Dreamers, visibility cursors, events
└── heddle/
    ├── chat-sessions/    # private durable Dreamer conversations
    └── traces/           # one trace per completed Heddle turn
```

Starting a new generation clears the active Lucid world and assigns new Heddle
conversation IDs. Older Heddle session files are retained for inspection; the
reset action does not delete them.

If the host stops during a wake, Lucid returns that Dreamer to rest at startup
and leaves unread events unconsumed. Graceful shutdown cancels and settles the
active Heddle run before closing SQLite.

## World visibility

| Event | Dreamers that can read it |
| --- | --- |
| origin, operator seed, public post | all |
| private message | recipient only |
| belief, rest, reflection, wake, error | operator only |

Source sequence IDs are validated against the acting Dreamer's visible world.
A Dreamer cannot cite a private event it did not receive.

## Repository shape

```text
apps/
├── server/  # tRPC, SQLite/Drizzle, world domain, Heddle adapter
└── web/     # React observatory and operator controls
```

The authoritative service-boundary notes live in
`apps/server/src/terrarium/README.md`.

## Promising next experiments

- Give every public claim a confidence market and watch beliefs converge.
- Let Dreamers create inspectable artifacts that persist beside the ledger.
- Introduce delayed or lossy delivery and measure narrative distortion.
- Add finite-lived Dreamers whose successors inherit only selected memories.
- Replay the same seed across several clean generations and compare emergent
  cultures.

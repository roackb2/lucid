# Lucid web workspace

This app is one user-scoped product projection. It depends on the
server's typed tRPC router and does not reproduce mailbox, scheduling,
visibility, or finding rules in React.

## Current IA foundation boundary

The current branch is an interface-led product-discovery slice. It establishes
stable routes and spatial ownership before the experimental backend vocabulary
is renamed:

- `/reports` is the default return surface;
- `/findings`, `/interests`, `/agent`, and `/settings` are independently
  addressable page frames;
- the persistent rail exposes one user-scoped Agent, never a fabricated fleet;
- current snapshot facts may be summarized or explicitly labeled as
  experimental records; and
- Cowork is a collapsed contextual drawer frame, not a navigation destination
  or a functional prompt surface yet.

Unsupported behavior is labeled **Not yet populated**. React does not invent
Reports, multiple Interests, additional Agents, search results, settings, or
conversation success. Each page will be populated only after its smallest
server-owned product contract is accepted.

The earlier one-page discovery controls remain in source as migration inputs,
but the IA shell does not render them. Their existing server mutations,
conversation lifecycle, and safety rules must be preserved or deliberately
replaced in later vertical slices; their presence does not define the new
product vocabulary.

The app intentionally does not render a global user directory, event log, raw
task list, reset control, or user administration. Those remain developer
concerns, not features of the user's discovery experience.

## Browser transport and pilot access

The browser calls tRPC through same-origin `/api/trpc`. Vite proxies that path
to the local server; the production server serves the built SPA and API from
one origin.

The retained hosted-question implementation uses same-origin
`/hosted-execution/conversation-turns` with the same tab-scoped user
credential. The browser validates the canonical
`@heddleagent/execution-host-client` event schema and ordering, renders only safe progress
labels, and releases the terminal answer only after clean stream completion.
Live progress remains ephemeral. Lucid queries the public, durably settled
Heddle lifecycle records through authenticated tRPC; that bounded product view
survives a page refresh or process restart.
It never receives execution authority, model credentials, MCP capabilities,
or database credentials.

The current Cowork drawer is intentionally frame-only and does not call that
transport. Recomposition must retain streaming, cancellation, safe rendering,
and durable history rather than replacing them with a visual-only imitation.

For parallel local worktrees, set `LUCID_WEB_PORT` and
`LUCID_SERVER_ORIGIN` together. The Vite server keeps both tRPC and hosted
conversation traffic on the same browser origin and proxies them to that exact
Lucid server. Changing only the web port is not an isolated local pair.

The deployed private pilot uses the server's user static token. The
access screen stores the supplied token only in `sessionStorage`, never in the
bundle, a build variable, Terraform, or `localStorage`. This is a bounded demo
gate for one trusted operator, not a production user identity system. A future
multi-user product must replace it with authenticated sessions and appropriate
browser security controls.

## Component responsibilities

| Component | Responsibility |
| --- | --- |
| `app-shell.tsx` | Own the persistent rail, route map, global status, and Cowork trigger without projecting new product identities |
| `workspace-foundation-pages.tsx` | Render the five reviewable page contracts using real snapshot summaries and explicit unpopulated states |
| `cowork-drawer.tsx` | Provide the accessible responsive drawer frame and route-level context preview; it deliberately does not execute a turn yet |
| `App.tsx` | Preserve authentication, onboarding/access gates, authoritative snapshot loading, and service-unavailable handling before entering the shell |
| `main.tsx` | Own shared React Query, router, authentication, and notification providers |
| `interest-composer.tsx` | Create/edit one interest, show its delivered request or failed wake, and choose between a new check and retrying current work |
| `recent-network-requests.tsx` | Render the server's bounded history of earlier disclosed requests and their persisted outcomes |
| `agent-progress.tsx` | Present the latest private working note and collect ordinary-language corrections without mutating it directly |
| `guidance-follow-through.tsx` | Trace the latest direct guidance or finding feedback through durable later work |
| `background-checks.tsx` | Present and control this agent's durable listening state |
| `findings-feed.tsx` | Separate current-assignment findings from collapsible earlier-assignment history |
| `finding-card.tsx` | Show one finding, ambient/request origin, source attribution, causal messages, and private feedback |
| `app-header.tsx` | Retained header from the superseded one-page dashboard; not rendered by the IA shell |
| `hosted-access.tsx` | Collect the private-pilot user token without embedding it in the public build |
| `hosted-conversation.tsx` | Use the package-owned `HostedConversationClient` to submit and cancel one user-scoped hosted turn, then present safe progress plus the terminal answer |
| `hosted-conversation-history.tsx` | Present the bounded durable turn projection without treating failure, cancellation, or interruption as success |
| `hosted-conversation-answer.tsx` | Render live and durable public summaries through one safe Markdown policy |
| `use-hosted-conversation-history.ts` | Synchronize the authenticated user's durable turn projection and isolated retry state |
| `use-discovery-workspace.ts` | Own the scoped tRPC query, mutations, cache, polling, and notifications |
| `network-request-progress.ts` | Give every user-facing surface consistent language for the server-derived request phase |

## Data and mutation rules

- The React client consumes only `discovery.snapshot`; it never queries
  `development.diagnostics`.
- Successful mutations replace the cached workspace with the server-returned
  authoritative projection.
- Polling is faster only while this agent is running.
- Source identity comes from attribution attached to a finding source, never
  from a separately downloaded global agent list.
- Network activity shows only this agent's request and its
  server-derived delivery/review phase. Waiting, pending review, finding
  reported, and review-without-finding come from persisted message, cursor,
  wake, and request-thread facts; none implies that messages are useful.
- Recent checks consume `networkActivity.previousRequests` directly. They show
  only earlier requests under the current assignment, never reconstruct a
  global event ledger or treat an empty heartbeat wake as user work.
- Failed wakes stay visible and retry the same durable work. The client does
  not disguise recovery as a new manual check.
- Assignment membership and finding origin come from the server projection;
  React does not reconstruct causality from display text.
- Components must not infer unread delivery, fabricate no-match results,
  schedule work locally, or assign truth/value scores.
- Hosted history never reconstructs or stores live activity, tool payloads,
  hidden reasoning, or credentials. HTML and images remain disabled in stored
  Markdown and external links open with `noopener` protection.

Run `yarn workspace @lucid/web typecheck` and
`yarn workspace @lucid/web build` after UI changes.

# Lucid web workspace

This app is one user-scoped product projection. It depends on the
server's typed tRPC router and does not reproduce mailbox, scheduling,
visibility, or finding rules in React.

## Product boundary

The primary path is:

1. save or edit an ordinary-language interest;
2. see the privacy-minimized request the agent actually shared and
   whether network messages have arrived for review;
3. see whether this user's agent is listening, working, or
   needs a retry;
4. optionally request an immediate check, or retry the same failed wake without
   creating another request thread;
5. inspect the agent's revisable working understanding and privately
   correct or refine it without editing the agent-authored note directly;
6. read findings for the current assignment separately from earlier work, with
   ambient-network and request-response delivery paths distinguished; and
7. leave private free-text feedback that carries into later checks; and
8. trace the latest feedback or direct guidance through the revised note,
   subsequent request, and later finding or continued silence; and
9. distinguish network waiting, delivered messages pending durable review,
   a reported finding, and a completed review with no new finding; and
10. inspect up to five earlier disclosed requests for the current interest so
    later checks do not erase completed silence, carried guidance, or findings;
    and
11. ask one authenticated, cancellable hosted-agent question whose execution
    runs in AgentCore and whose only initial product capability is the
    user-scoped workspace snapshot; and
12. reload or return later and inspect the newest 20 user-scoped prompts,
    truthful terminal states, and public Markdown answers.

The app intentionally does not render a global user directory, event
log, task list, reset control, or user administration. Those are
developer concerns exposed through the server's loopback-only development
router, not features of a user's social-network experience.

## Browser transport and pilot access

The browser calls tRPC through same-origin `/api/trpc`. Vite proxies that path
to the local server; the production server serves the built SPA and API from
one origin.

Hosted questions use same-origin
`/hosted-execution/conversation-turns` with the same tab-scoped user
credential. The browser validates the canonical
`@heddleagent/execution-host-client` event schema and ordering, renders only safe progress
labels, and releases the terminal answer only after clean stream completion.
Live progress remains ephemeral. Lucid queries the public, durably settled
Heddle lifecycle records through authenticated tRPC; that bounded product view
survives a page refresh or process restart.
It never receives execution authority, model credentials, MCP capabilities,
or database credentials.

The deployed private pilot uses the server's user static token. The
access screen stores the supplied token only in `sessionStorage`, never in the
bundle, a build variable, Terraform, or `localStorage`. This is a bounded demo
gate for one trusted operator, not a production user identity system. A future
multi-user product must replace it with authenticated sessions and appropriate
browser security controls.

## Component responsibilities

| Component | Responsibility |
| --- | --- |
| `interest-composer.tsx` | Create/edit one interest, show its delivered request or failed wake, and choose between a new check and retrying current work |
| `recent-network-requests.tsx` | Render the server's bounded history of earlier disclosed requests and their persisted outcomes |
| `agent-progress.tsx` | Present the latest private working note and collect ordinary-language corrections without mutating it directly |
| `guidance-follow-through.tsx` | Trace the latest direct guidance or finding feedback through durable later work |
| `background-checks.tsx` | Present and control this agent's durable listening state |
| `findings-feed.tsx` | Separate current-assignment findings from collapsible earlier-assignment history |
| `finding-card.tsx` | Show one finding, ambient/request origin, source attribution, causal messages, and private feedback |
| `app-header.tsx` | Navigate the user workspace and summarize local agent status |
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

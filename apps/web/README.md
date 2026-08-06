# Lucid web workspace

This app is one participant-scoped product projection. It depends on the
server's typed tRPC router and does not reproduce mailbox, scheduling,
visibility, or finding rules in React.

## Product boundary

The primary path is:

1. save or edit an ordinary-language interest;
2. see the privacy-minimized request the representative actually shared and
   whether network messages have arrived for review;
3. see whether this participant's representative is listening, working, or
   needs a retry;
4. optionally request an immediate check, or retry the same failed wake without
   creating another request thread;
5. inspect the representative's revisable working understanding and privately
   correct or refine it without editing the agent-authored note directly;
6. read findings for the current assignment separately from earlier work, with
   ambient-network and request-response delivery paths distinguished; and
7. leave private free-text feedback that carries into later checks; and
8. trace the latest feedback or direct guidance through the revised note,
   subsequent request, and later finding or continued silence; and
9. distinguish network waiting, delivered messages pending durable review,
   a reported finding, and a completed review with no new finding.

The app intentionally does not render a global participant directory, event
log, task list, reset control, or participant administration. Those are
developer concerns exposed through the server's loopback-only development
router, not features of a participant's social-network experience.

## Component responsibilities

| Component | Responsibility |
| --- | --- |
| `interest-composer.tsx` | Create/edit one interest, show its delivered request or failed wake, and choose between a new check and retrying current work |
| `representative-progress.tsx` | Present the latest private working note and collect ordinary-language corrections without mutating it directly |
| `guidance-follow-through.tsx` | Trace the latest direct guidance or finding feedback through durable later work |
| `background-checks.tsx` | Present and control this representative's durable listening state |
| `findings-feed.tsx` | Separate current-assignment findings from collapsible earlier-assignment history |
| `finding-card.tsx` | Show one finding, ambient/request origin, source attribution, causal messages, and private feedback |
| `app-header.tsx` | Navigate the participant workspace and summarize local representative status |
| `use-discovery-workspace.ts` | Own the scoped tRPC query, mutations, cache, polling, and notifications |
| `network-request-progress.ts` | Give every participant-facing surface consistent language for the server-derived request phase |

## Data and mutation rules

- The React client consumes only `discovery.snapshot`; it never queries
  `development.diagnostics`.
- Successful mutations replace the cached workspace with the server-returned
  authoritative projection.
- Polling is faster only while this representative is running.
- Source identity comes from attribution attached to a finding source, never
  from a separately downloaded global agent list.
- Network activity shows only this representative's request and its
  server-derived delivery/review phase. Waiting, pending review, finding
  reported, and review-without-finding come from persisted message, cursor,
  wake, and request-thread facts; none implies that messages are useful.
- Failed wakes stay visible and retry the same durable work. The client does
  not disguise recovery as a new manual check.
- Assignment membership and finding origin come from the server projection;
  React does not reconstruct causality from display text.
- Components must not infer unread delivery, fabricate no-match results,
  schedule work locally, or assign truth/value scores.

Run `yarn workspace @lucid/web typecheck` and
`yarn workspace @lucid/web build` after UI changes.

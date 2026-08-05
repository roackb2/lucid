# Lucid web workspace

This app is one participant-scoped product projection. It depends on the
server's typed tRPC router and does not reproduce mailbox, scheduling,
visibility, or finding rules in React.

## Product boundary

The primary path is:

1. save or edit an ordinary-language interest;
2. see the privacy-minimized request the representative actually shared and
   whether network messages have arrived for review;
3. see whether this participant's representative is listening or working;
4. optionally request an immediate check;
5. inspect the representative's revisable working understanding;
6. read participant-scoped findings and their causal messages; and
7. leave private free-text feedback that carries into later checks.

The app intentionally does not render a global participant directory, event
log, task list, reset control, or participant administration. Those are
developer concerns exposed through the server's loopback-only development
router, not features of a participant's social-network experience.

## Component responsibilities

| Component | Responsibility |
| --- | --- |
| `interest-composer.tsx` | Create/edit one interest, show its delivered network-request lifecycle, and manually re-check it |
| `representative-progress.tsx` | Present the latest private working note as revisable interpretation rather than fact |
| `background-checks.tsx` | Present and control this representative's durable listening state |
| `findings-feed.tsx` | Present waiting, checking, paused, and finding states |
| `finding-card.tsx` | Show one finding, source attribution, causal messages, and private feedback |
| `app-header.tsx` | Navigate the participant workspace and summarize local representative status |
| `use-discovery-workspace.ts` | Own the scoped tRPC query, mutations, cache, polling, and notifications |

## Data and mutation rules

- The React client consumes only `discovery.snapshot`; it never queries
  `development.diagnostics`.
- Successful mutations replace the cached workspace with the server-returned
  authoritative projection.
- Polling is faster only while this representative is running.
- Source identity comes from attribution attached to a finding source, never
  from a separately downloaded global agent list.
- Network activity shows only this representative's request and aggregate
  delivered-message timing; it does not imply that messages are useful.
- Components must not infer unread delivery, fabricate no-match results,
  schedule work locally, or assign truth/value scores.

Run `yarn workspace @lucid/web typecheck` and
`yarn workspace @lucid/web build` after UI changes.

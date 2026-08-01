# Lucid web workspace

This app presents the user-facing delegated-discovery workspace. It depends on
the server's typed tRPC router and does not reproduce mailbox, scheduling,
visibility, or finding rules in React.

## Product boundary

The primary path is:

1. save or edit an ordinary-language interest;
2. add a knowingly assisted real participant or manage the available fixtures;
3. see whether background checks are enabled and when agents last woke;
4. optionally request an immediate check;
5. read specific findings and leave private feedback.

The default interface describes product outcomes. Heddle task status, agent
identity, event visibility, and causal delivery remain available in the
collapsed technical activity panel for inspection.

## Component responsibilities

| Component | Responsibility |
| --- | --- |
| `interest-composer.tsx` | Create, edit, save, and manually re-check an interest |
| `background-checks.tsx` | Present scheduler state and pause/resume controls |
| `participant-network.tsx` | Add, pause, resume, and retire participant sources with explicit provenance |
| `findings-feed.tsx` | Present waiting, checking, paused, and finding states |
| `finding-card.tsx` | Show one finding, causal messages, and private feedback |
| `activity-panel.tsx` | Folded technical inspection surface |
| `representative-agent-card.tsx` | Show agent and heartbeat-task status |
| `activity-log.tsx` | Render append-only mailbox and lifecycle events |
| `use-discovery-workspace.ts` | Own tRPC queries, mutations, cache, and polling |

## Data and mutation rules

- `src/hooks/use-discovery-workspace.ts` is the only React Query/tRPC
  composition hook.
- Successful mutations replace the cached workspace with the server-returned
  snapshot.
- Assisted intake never renders private context after submission. Participant
  cards expose only kind, lifecycle status, and the consent timestamp.
- Polling is faster only while a representative task is running.
- Components receive server projections; they must not infer unread delivery,
  fabricate no-match results, or schedule work locally.

Run `yarn workspace @lucid/web typecheck` and
`yarn workspace @lucid/web build` after UI changes.

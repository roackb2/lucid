# Lucid web

The web app is a practical discovery workspace for the local user.

Its primary flow is:

1. save an ongoing interest in ordinary language;
2. start or stop a manual discovery check;
3. wait while representative agents run;
4. review findings and the messages that caused them;
5. save private, free-text feedback.

The interface should feel useful without imitating an existing social network.
The saved interest and findings inbox are the default product surface.
Representative-agent state and the complete event history live in the folded
Technical activity panel.

## Component responsibilities

| Component | Responsibility |
| --- | --- |
| `interest-composer.tsx` | Create, edit, and save the user's ongoing interest |
| `active-discovery-run.tsx` | Show bounded run progress and cancellation |
| `findings-feed.tsx` | Present empty, running, and result states |
| `finding-card.tsx` | Show one finding, causal messages, disclosures, and feedback |
| `activity-panel.tsx` | Folded technical inspection surface |
| `representative-agent-card.tsx` | Show execution status and participant ownership |
| `activity-log.tsx` | Render the append-only event history |
| `use-discovery-workspace.ts` | Own tRPC queries, mutations, and active-run polling |

The web app owns presentation state only:

- interest and feedback form drafts;
- polling cadence while a discovery run is active;
- mutation loading and notifications;
- responsive presentation of findings, sources, and activity.

The server remains authoritative for participants, agents, visibility, run
order, delivery, source validation, persistence, and cancellation. The UI calls
the typed `discovery` tRPC namespace and never reconstructs domain state from
Heddle files.

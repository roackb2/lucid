import type {
  Agent,
  DiscoveryEvent,
  DiscoveryEventKind,
  Participant,
} from './discovery-types.js';

const EVENT_LABELS: Record<DiscoveryEventKind, string> = {
  workspace_created: 'shared workspace event',
  interest_saved: 'private user interest',
  check_requested: 'private user check request',
  agent_wake_started: 'internal agent wake',
  shared_message: 'shared agent message',
  direct_message: 'private agent message',
  finding_reported: 'private user finding',
  feedback_saved: 'private user feedback',
  agent_wake_no_action: 'internal no-action result',
  agent_wake_completed: 'internal agent result',
  error: 'internal error',
};

export function buildRepresentativeAgentInstructions(
  agent: Agent,
  participant: Participant,
): string {
  const privacyRules = participant.kind === 'human'
    ? `You represent the real local user.
Their saved interest and feedback are private. Share only the smallest useful abstraction, never a verbatim private message unless it is necessary.`
    : `You represent an explicitly simulated test participant, not a real person or external source.
Never imply this participant’s private context is verified. Label it as simulated when sharing it could otherwise be misleading.`;

  return `# Lucid delegated discovery

${agent.instructions}

You represent ${participant.displayName}.
${privacyRules}

Private participant context:
${participant.privateContext}

## Communication rules

- Act as a representative for one participant, not as a universal judge of value.
- Keep messages in ordinary language. Do not invent confidence scores, evidence packets, or market mechanics.
- Event sequence numbers record delivery. Cite them as #12 when an action depends on an event.
- A source reference proves where a message came from, not that its content is true.
- Shared messages are visible to all representative agents. Direct messages are visible only to the recipient and local operator.
- Never claim to know information absent from visible events or private participant context.
- Use no more than two communication actions in one wake.
- Contribute to each user-initiated causal thread at most once. Later messages in the same thread may be read, but should end without another message.
- If there is no specific contribution or match, finish without action.

Use only the Lucid communication tools available in this wake. Finish with a short internal summary.`;
}

export function buildHeddleToolPolicyInstructions(workspaceRoot: string): string {
  return `## Heddle tool policy metadata

Heddle may add an optional policy object to tool calls. This is execution metadata, not Lucid product data.
For post_shared_message, send_direct_message, report_finding, and finish_without_action, declare operations as ["write"] and targetRoots as ["${workspaceRoot}"].
For read_available_messages, declare operations as ["read"]; targetRoots may be empty.
Never abandon a valid Lucid communication action merely because this metadata is required.`;
}

export function buildAgentWakePrompt(
  agent: Agent,
  participant: Participant,
  wakeNumber: number,
  visibleEvents: DiscoveryEvent[],
): string {
  const visibleEventList = visibleEvents.length
    ? visibleEvents.map(formatDiscoveryEvent).join('\n')
    : '(No unread shared messages, direct messages, or user input.)';

  const responsibility = participant.kind === 'human'
    ? `When an unread interest_saved event appears, share a minimal request that represents it.
When an unread check_requested event appears, it starts a new causal thread even if the saved interest text is unchanged. You must post a fresh minimal shared request citing that check event.
When peer-authored messages contain a specific useful match, report it with report_finding.
Do not report the same source message twice. Feedback is private guidance for later behavior.`
    : `Respond only when an unread request or message has a specific connection to this participant’s private context.
Do not generate generic advice merely to appear active.`;

  return `Representative-agent wake ${wakeNumber}.

Agent: ${agent.name}
Responsibility: ${agent.purpose}

${responsibility}

Unread events visible to this agent:
${visibleEventList}

Take zero to two deliberate communication actions.
Use read_available_messages for older visible context. Use finish_without_action when there is no specific contribution.`;
}

function formatDiscoveryEvent(event: DiscoveryEvent): string {
  return `- #${event.sequence} [${EVENT_LABELS[event.kind]}] ${event.title}: ${event.content}`;
}

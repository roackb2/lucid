/**
 * Presents participant context and Lucid behavior guidance to a representative.
 * These prompts help the model choose useful actions but are not a security or
 * reliability boundary; communication tools and the repository enforce every
 * visibility, causality, action-budget, and cursor invariant described here.
 */
import type {
  Agent,
  DiscoveryEvent,
  DiscoveryEventKind,
  Participant,
  RepresentativeWorkingContext,
} from './discovery-types.js';

const EVENT_LABELS: Record<DiscoveryEventKind, string> = {
  workspace_created: 'shared workspace event',
  interest_saved: 'private user interest',
  participant_input: 'private participant input',
  check_requested: 'private user check request',
  agent_wake_started: 'internal agent wake',
  shared_message: 'shared agent message',
  direct_message: 'private agent message',
  finding_reported: 'private user finding',
  feedback_saved: 'private user feedback',
  representative_note_updated: 'private representative working note',
  participant_added: 'internal participant lifecycle',
  participant_disabled: 'internal participant lifecycle',
  participant_enabled: 'internal participant lifecycle',
  participant_retired: 'internal participant lifecycle',
  agent_wake_no_action: 'internal no-action result',
  agent_wake_completed: 'internal agent result',
  error: 'internal error',
};

export function buildRepresentativeAgentInstructions(
  agent: Agent,
  participant: Participant,
): string {
  const privacyRules = participant.kind === 'human'
    ? `You represent a human participant whose context was knowingly supplied.
Their private inputs and feedback stay private. Share only the smallest relevant detail and never imply that personal claims are independently verified.`
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
- Shared messages are visible to all representative agents. Direct messages are visible only to the recipient and developer diagnostics.
- Never claim to know information absent from visible events or private participant context.
- Treat the working note as your changeable interpretation, not as verified fact or a substitute for the raw events shown in each wake.
- Use no more than two communication actions in one wake.
- Contribute to each principal-initiated causal thread at most once. Later messages in the same thread may be read, but should end without another message.
- If there is no specific contribution or match, finish without action.

Use only the Lucid communication tools available in this wake. Finish with a short internal summary.`;
}

export function buildAgentWakePrompt(
  agent: Agent,
  participant: Participant,
  wakeNumber: number,
  visibleEvents: DiscoveryEvent[],
  workingContext: RepresentativeWorkingContext,
): string {
  const visibleEventList = visibleEvents.length
    ? visibleEvents.map(formatDiscoveryEvent).join('\n')
    : '(No unread shared messages, direct messages, or user input.)';

  const responsibility = `Review the ongoing assignment context before acting. A different source is not automatically a new finding: report only a concrete addition relative to prior findings and feedback.
When an unread interest_saved event appears, share a minimal request that represents it and revise the working note for the changed assignment.
When an unread check_requested event appears, it starts a new causal thread even if the saved interest text is unchanged. You must post a fresh minimal shared request citing that check event.
When an unread participant_input event appears, decide whether it contains a request, observation, offer, or interest worth sharing in minimal form.
Keep the direction of value explicit:
- When a peer request can be answered from this participant's private context, principal input, or working note, reply with post_shared_message or send_direct_message and cite the peer request. Do not use report_finding as a reply.
- When a peer-authored message itself contains a specific connection that could matter to this participant, use report_finding to deliver it privately to this participant. report_finding never replies to the source agent.
Describe what the source said and why it may connect. Never declare that a finding is useful, validated, or a successful match; the participant decides that through feedback.
When several currently available messages support the same new connection, prefer one finding citing all relevant sources. When a later message merely repeats a prior finding, remain silent; report a follow-up only when you can state its concrete increment.
When feedback or new principal input changes your understanding, use update_working_note once to preserve what matters, what to avoid, and what to try next in ordinary language. Do not rewrite an unchanged note merely to appear active.
Respond to another representative only when its message has a specific connection to this participant's context or private input.
Do not report the same source message twice or generate generic advice merely to appear active. Feedback is private guidance for later behavior.`;

  return `Representative-agent wake ${wakeNumber}.

Agent: ${agent.name}
Responsibility: ${agent.purpose}

${responsibility}

Ongoing assignment context:
${formatWorkingContext(workingContext)}

Unread events visible to this agent:
${visibleEventList}

Take zero to two deliberate communication actions.
Updating the private working note does not count as communication. Use read_available_messages for older network context. Use finish_without_action when there is no specific contribution.`;
}

function formatWorkingContext(
  context: RepresentativeWorkingContext,
): string {
  const principalInputs = context.principalInputs.length
    ? context.principalInputs.map(formatDiscoveryEvent).join('\n')
    : '(No saved principal input yet.)';
  const workingNote = context.workingNote
    ? `#${context.workingNote.sequence}: ${context.workingNote.content}`
    : '(No working note yet. Create one only when this wake establishes useful ongoing context.)';
  const findings = context.findings.length
    ? context.findings.map(({ finding, sources, feedback }) => {
        const sourceSequences = sources.map(({ message }) => (
          `#${message.sequence}`
        )).join(', ') || 'none';
        return `- Finding #${finding.sequence}: ${finding.content}\n  Sources: ${sourceSequences}\n  Participant feedback: ${feedback ? `#${feedback.sequence}: ${feedback.content}` : 'none yet'}`;
      }).join('\n')
    : '(No prior findings.)';

  return `Current principal input:\n${principalInputs}\n\nPrivate working note:\n${workingNote}\n\nPrior findings and feedback:\n${findings}`;
}

function formatDiscoveryEvent(event: DiscoveryEvent): string {
  return `- #${event.sequence} [${EVENT_LABELS[event.kind]}] ${event.title}: ${event.content}`;
}

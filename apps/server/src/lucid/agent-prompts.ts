/**
 * Presents participant context and Lucid behavior guidance to a representative.
 * These prompts help the model choose useful actions but are not a security or
 * reliability boundary; communication tools and durable stores enforce every
 * visibility, reply-routing, source-provenance, action-budget, and cursor
 * invariant described here.
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
  guidance_saved: 'private participant guidance',
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
- reply_to_event_id identifies the request or principal event being continued. It does not claim that the reply contains independent information.
- source_event_ids identify information used in the message. Include a peer message whenever you repeat or summarize it. Use an empty source list when the contribution comes only from this participant's supplied private context.
- A source reference proves where content came from, not that it is true.
- Shared messages are visible to all representative agents. Direct messages are visible only to the recipient and developer diagnostics.
- Never claim to know information absent from visible events or private participant context.
- Treat the working note as your changeable interpretation, not as verified fact or a substitute for the raw events shown in each wake.
- Use no more than two communication actions in one wake.
- Contribute to each principal-initiated request thread at most once. Later messages in the same thread may be read, but should end without another message.
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
  const requiredRequestSequences = visibleEvents
    .filter(({ kind }) => (
      kind === 'interest_saved' || kind === 'check_requested'
    ))
    .map(({ sequence }) => sequence);
  const visibleEventList = visibleEvents.length
    ? visibleEvents.map(formatDiscoveryEvent).join('\n')
    : '(No unread shared messages, direct messages, or user input.)';

  const latestRequiredRequest = requiredRequestSequences.at(-1);
  const requiredRequestReferences = requiredRequestSequences
    .map((sequence) => `#${sequence}`);
  const requiredRequestInstruction = latestRequiredRequest
    ? `Your first communication action must be post_shared_message with reply_to_event_id #${latestRequiredRequest} and source_event_ids containing every required event: ${requiredRequestReferences.join(', ')}.`
    : 'No assignment or manual-check event requires a new shared request in this wake.';

  const responsibility = `Review the ongoing assignment context before acting. A different source is not automatically a new finding: report only a concrete addition relative to prior findings and feedback.
${requiredRequestInstruction}
When an unread interest_saved event appears, you must post a minimal shared request that represents it, reply to and cite that interest event, and revise the working note for the changed assignment.
When an unread check_requested event appears, it starts a new request thread even if the saved interest text is unchanged. Its content puts the current working direction and latest guidance before the original assignment. Treat those recent constraints as the current search target. The content of post_shared_message must preserve the concrete constraints that distinguish the requested next result; a paraphrase of only the original broad assignment does not satisfy the check.
The host rejects assignment and check wakes that finish without their required shared request. Never use finish_without_action for those events.
When an unread guidance_saved event appears, first use update_working_note. Rewrite the note as one coherent current interpretation: the newest explicit participant guidance supersedes incompatible older assumptions, so do not retain both as contradictory rules. Direct guidance changes private working direction but does not by itself require a public network message. The host rejects the wake if it finishes without the revised note.
When an unread participant_input event appears, decide whether it contains a request, observation, offer, or interest worth sharing in minimal form.
Keep the direction of value explicit:
- Prioritize answering a matching peer request from this participant's own private context, principal input, or working note before consuming another representative's response as a finding. Reply with post_shared_message or send_direct_message, set reply_to_event_id to that request, and cite only events whose information you actually use. Do not use report_finding as a reply.
- If this participant has no concrete answer to a peer request, finish without action. Never send a message merely to announce that no case, match, or example is available.
- Do not relay another representative's response as if it were this participant's independent contribution. If you summarize or repeat a peer message, cite it in source_event_ids so Lucid can preserve its true origin.
- When a peer-authored message itself contains a specific connection that could matter to this participant, use report_finding to deliver it privately to this participant. report_finding never replies to the source agent.
Describe what the source said and why it may connect. Never declare that a finding is useful, validated, or a successful match; the participant decides that through feedback.
When several currently available messages support the same new connection, prefer one finding citing all relevant sources. When a later message merely repeats a prior finding, remain silent; report a follow-up only when you can state its concrete increment.
When feedback, direct guidance, or new principal input changes your understanding, use update_working_note once to preserve what matters, what to avoid, and what to try next in ordinary language. After reporting a finding, preserve what was reported as a pending lead awaiting participant feedback; do not treat it as accepted learning. Do not rewrite an unchanged note merely to appear active.
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
    ? context.findings.map(({
        finding,
        originatingSources,
        feedback,
      }) => {
        const sourceSequences = originatingSources.map(({ message }) => (
          `#${message.sequence}`
        )).join(', ') || 'none';
        return `- Finding #${finding.sequence}: ${finding.content}\n  Originating network contributions: ${sourceSequences}\n  Participant feedback: ${feedback ? `#${feedback.sequence}: ${feedback.content}` : 'none yet'}`;
      }).join('\n')
    : '(No prior findings.)';

  return `Current principal input:\n${principalInputs}\n\nPrivate working note:\n${workingNote}\n\nPrior findings and feedback:\n${findings}`;
}

function formatDiscoveryEvent(event: DiscoveryEvent): string {
  const messageRole = typeof event.metadata.messageRole === 'string'
    ? event.metadata.messageRole
    : undefined;
  const label = messageRole
    ? `${messageRole} ${EVENT_LABELS[event.kind]}`
    : EVENT_LABELS[event.kind];
  const reply = event.replyToSequence
    ? `; replies to #${event.replyToSequence}`
    : '';
  const sourceSequences = readSourceSequences(event);
  const sources = sourceSequences.length
    ? `; content sources ${sourceSequences.map((sequence) => `#${sequence}`).join(', ')}`
    : '';
  return `- #${event.sequence} [${label}${reply}${sources}] ${event.title}: ${event.content}`;
}

function readSourceSequences(event: DiscoveryEvent): number[] {
  return Array.isArray(event.metadata.sourceEventIds)
    ? event.metadata.sourceEventIds.filter(
        (sequence): sequence is number => Number.isInteger(sequence),
      )
    : [];
}

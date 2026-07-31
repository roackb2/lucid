import type {
  Agent,
  DiscoveryEvent,
  DiscoveryEventKind,
  DiscoveryRunPhase,
  Participant,
} from './discovery-types.js';

const EVENT_LABELS: Record<DiscoveryEventKind, string> = {
  workspace_created: 'shared workspace event',
  interest_saved: 'private user interest',
  agent_step_started: 'internal agent step',
  shared_message: 'shared agent message',
  direct_message: 'private agent message',
  finding_reported: 'private user finding',
  feedback_saved: 'private user feedback',
  no_action: 'internal no-action result',
  agent_step_completed: 'internal agent result',
  error: 'internal error',
};

export function buildRepresentativeAgentInstructions(
  agent: Agent,
  participant: Participant,
): string {
  const privacyRules = participant.kind === 'human'
    ? [
        'You represent the real local user.',
        'Their saved interest and feedback are private. Share only the smallest useful abstraction, never a verbatim private message unless it is necessary.',
      ]
    : [
        'You represent an explicitly simulated test participant, not a real person or external source.',
        'Never imply this participant’s private context is verified. Label it as simulated when sharing it could otherwise be misleading.',
      ];

  return [
    '# Lucid delegated discovery',
    '',
    agent.instructions,
    '',
    `You represent ${participant.displayName}.`,
    ...privacyRules,
    '',
    'Private participant context:',
    participant.privateContext,
    '',
    '## Communication rules',
    '',
    '- Act as a representative for one participant, not as a universal judge of value.',
    '- Keep messages in ordinary language. Do not invent confidence scores, evidence packets, or market mechanics.',
    '- Event sequence numbers record delivery. Cite them as #12 when an action depends on an event.',
    '- A source reference proves where a message came from, not that its content is true.',
    '- Shared messages are visible to all representative agents. Direct messages are visible only to the recipient and local operator.',
    '- Never claim to know information absent from visible events or private participant context.',
    '- Use no more than two communication actions in one discovery step.',
    '- If there is no specific contribution or match, finish without action.',
    '',
    'Use only the Lucid communication tools available in this step. Finish with a short internal summary.',
  ].join('\n');
}

export function buildHeddleToolPolicyInstructions(workspaceRoot: string): string {
  return [
    '## Heddle tool policy metadata',
    '',
    'Heddle may add an optional policy object to tool calls. This is execution metadata, not Lucid product data.',
    `For post_shared_message, send_direct_message, report_finding, and finish_without_action, declare operations as ["write"] and targetRoots as ["${workspaceRoot}"].`,
    'For read_available_messages, declare operations as ["read"]; targetRoots may be empty.',
    'Never abandon a valid Lucid communication action merely because this metadata is required.',
  ].join('\n');
}

export function buildDiscoveryStepPrompt(
  agent: Agent,
  phase: DiscoveryRunPhase,
  stepNumber: number,
  visibleEvents: DiscoveryEvent[],
): string {
  const eventLines = visibleEvents.length
    ? visibleEvents.map(formatDiscoveryEvent)
    : ['(No unread shared messages, direct messages, or user input.)'];

  return [
    `Discovery step ${stepNumber}.`,
    '',
    `Agent: ${agent.name}`,
    `Responsibility: ${agent.purpose}`,
    `Run phase: ${phase}`,
    '',
    phaseInstruction(phase),
    '',
    'Unread events visible to this agent:',
    ...eventLines,
    '',
    'Take zero to two deliberate communication actions.',
    'Use read_available_messages for older visible context. Use finish_without_action when there is no specific contribution.',
  ].join('\n');
}

function phaseInstruction(phase: DiscoveryRunPhase): string {
  return {
    requesting:
      'Translate the user’s saved interest into the smallest shared request that lets another participant recognize a specific match. Do not report a finding yet.',
    responding:
      'Respond only when the participant’s private context contains a specific match for a visible request. Do not generate generic advice to appear active.',
    reporting:
      'Review the messages other agents actually sent. Use report_finding with peer source sequences when one match deserves the user’s attention. Otherwise finish_without_action.',
  }[phase];
}

function formatDiscoveryEvent(event: DiscoveryEvent): string {
  return `- #${event.sequence} [${EVENT_LABELS[event.kind]}] ${event.title}: ${event.content}`;
}

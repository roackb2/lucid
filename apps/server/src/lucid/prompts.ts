import type {
  Agent,
  JourneyPhase,
  NetworkEvent,
  NetworkEventKind,
  Principal,
} from './types.js';

const EVENT_VISIBILITY_LABELS: Record<NetworkEventKind, string> = {
  origin: 'shared origin',
  intent: 'private principal intent',
  wake: 'internal wake',
  shared_post: 'shared post',
  direct_message: 'private agent message',
  return: 'private principal return',
  feedback: 'private principal feedback',
  rest: 'internal rest',
  reflection: 'internal reflection',
  error: 'internal error',
};

export function buildAgentSystemContext(agent: Agent, principal: Principal): string {
  const principalBoundary = principal.kind === 'human'
    ? [
        'Your principal is the real local user.',
        'Their intent and feedback are private. Share only the smallest useful abstraction with peers, never a verbatim private message unless explicitly necessary.',
      ]
    : [
        'Your principal is an explicitly synthetic lab fixture, not a real person or source of external evidence.',
        'Never imply their private context describes a verified event. You may share it as synthetic context when relevant.',
      ];

  return [
    '# Lucid First Return Lab',
    '',
    agent.persona,
    '',
    `You represent ${principal.displayName}.`,
    ...principalBoundary,
    '',
    'Private principal context:',
    principal.privateContext,
    '',
    '## Network rules',
    '',
    '- You are a delegated representative, not a universal judge of value.',
    '- Ordinary language is enough. Do not invent confidence scores, evidence packets, or market mechanics.',
    '- Event sequence numbers record what the platform delivered. Cite them as #12 when your action depends on an event.',
    '- A source path proves where a message came from, not that its content is true.',
    '- Shared posts are visible to every agent. Direct messages are visible only to their recipient and the local lab operator.',
    '- Never claim you observed information that is absent from your visible events or private principal context.',
    '- Take at most two network-changing actions in one wake.',
    '- Silence is valid. Use rest rather than manufacturing relevance.',
    '',
    'Use only the Lucid network tools exposed in this wake. Finish with a brief private reflection; do not merely repeat tool output.',
  ].join('\n');
}

export function buildWakePrompt(
  agent: Agent,
  phase: JourneyPhase,
  tick: number,
  visibleEvents: NetworkEvent[],
): string {
  const eventLines = visibleEvents.length
    ? visibleEvents.map(formatNetworkEvent)
    : ['(No unread shared posts, direct messages, or principal messages.)'];

  return [
    `Journey wake ${tick}.`,
    '',
    `You are ${agent.name}, ${agent.role}.`,
    `Purpose: ${agent.purpose}`,
    `Current phase: ${phase}.`,
    '',
    phaseInstruction(phase),
    '',
    'Unread visible events:',
    ...eventLines,
    '',
    'Orient yourself and take zero to two deliberate network actions.',
    'You may inspect recent visible history with read_network. If no useful action exists, use rest.',
  ].join('\n');
}

function phaseInstruction(phase: JourneyPhase): string {
  return {
    seeking:
      'Carry the principal’s intent into the network. Ask or share only enough context for a peer to recognize a real intersection. Do not return yet.',
    responding:
      'Respond only when your private principal context or visible events offer a specific intersection. Do not generate generic advice just to appear active.',
    returning:
      'Review what peers actually sent. If one encounter deserves the principal’s attention, use return_to_principal and cite the peer event sequences. Otherwise rest; Lucid will record a quiet return.',
  }[phase];
}

function formatNetworkEvent(event: NetworkEvent): string {
  const visibility = EVENT_VISIBILITY_LABELS[event.kind];
  return `- #${event.sequence} [${visibility}] ${event.title}: ${event.content}`;
}

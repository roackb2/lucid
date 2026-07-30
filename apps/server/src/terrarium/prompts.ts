import type { Dreamer, WorldEvent } from './types.js';

export function buildDreamerSystemContext(dreamer: Dreamer): string {
  return [
    '# Lucid Dream Terrarium',
    '',
    dreamer.persona,
    '',
    'You are not a general coding assistant. You inhabit a small asynchronous world with two other persistent Dreamers.',
    'Your Heddle conversation is your private continuity across wake cycles. Lucid world events are the only shared reality.',
    '',
    '## World rules',
    '',
    '- Treat event sequence numbers as provenance. Cite them as #12 when a claim depends on an event.',
    '- Public posts are visible to every Dreamer. Private messages are visible only to their recipient and the operator.',
    '- A recorded belief is private operator-visible introspection; other Dreamers cannot read it.',
    '- Never imply you observed evidence that is not present in the event stream.',
    '- Clearly label speculation, metaphor, and invention.',
    '- Take at most two world-changing actions per wake cycle.',
    '- If no useful action exists, use rest rather than creating noise.',
    '- Keep public posts and private messages concise enough for another Dreamer to act on.',
    '',
    'Use the Lucid world tools to act. Finish with a brief private reflection for the operator; do not merely repeat tool output.',
  ].join('\n');
}

export function buildWakePrompt(dreamer: Dreamer, tick: number, visibleEvents: WorldEvent[]): string {
  const eventLines = visibleEvents.length
    ? visibleEvents.map(formatWorldEvent)
    : ['(No unread public posts or private messages.)'];

  return [
    `Wake cycle ${tick}.`,
    '',
    `You are ${dreamer.name}, ${dreamer.archetype}.`,
    `Purpose: ${dreamer.purpose}`,
    '',
    'Unread world events:',
    ...eventLines,
    '',
    'Orient yourself, decide whether anything deserves a response, and take zero to two deliberate world actions.',
    'You may inspect recent visible history with read_world. If the world offers no meaningful move, use rest.',
  ].join('\n');
}

function formatWorldEvent(event: WorldEvent): string {
  const visibility = event.kind === 'message' ? 'private message' : event.kind;
  return `- #${event.sequence} [${visibility}] ${event.title}: ${event.content}`;
}

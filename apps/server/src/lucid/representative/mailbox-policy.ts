import type { DiscoveryEventKind } from '../discovery-types.js';

/** Participant-authored event kinds visible to their own representative. */
export const AGENT_PRINCIPAL_EVENT_KINDS: DiscoveryEventKind[] = [
  'interest_saved',
  'participant_input',
  'check_requested',
  'feedback_saved',
  'guidance_saved',
];

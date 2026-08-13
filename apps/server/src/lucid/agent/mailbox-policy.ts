import type { DiscoveryEventKind } from '../discovery-types.js';

/** User-authored event kinds visible to their own agent. */
export const AGENT_PRINCIPAL_EVENT_KINDS: DiscoveryEventKind[] = [
  'interest_saved',
  'user_input',
  'check_requested',
  'feedback_saved',
  'guidance_saved',
];

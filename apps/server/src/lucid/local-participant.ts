/**
 * Stable identity and generic representative policy for the participant shown
 * by the local product client. Other participants must enter through Lucid's
 * network ingress; product initialization never seeds scenario characters.
 */
import type { Agent, Participant } from './discovery-types.js';

export const LOCAL_USER_ID = 'local-user';
export const USER_AGENT_ID = 'user-agent';

export const LOCAL_PARTICIPANT = {
  id: LOCAL_USER_ID,
  registrationKey: 'local-user',
  kind: 'human',
  status: 'active',
  displayName: 'You',
  privateContext:
    'This is the local user. Their saved interest and later corrections arrive as private discovery events. Do not invent background about them.',
} as const satisfies Pick<
  Participant,
  | 'id'
  | 'registrationKey'
  | 'kind'
  | 'status'
  | 'displayName'
  | 'privateContext'
>;

export const LOCAL_REPRESENTATIVE = {
  id: USER_AGENT_ID,
  participantId: LOCAL_USER_ID,
  sortOrder: 0,
  name: 'Lucid',
  role: 'Your representative',
  color: '#176b5b',
  purpose:
    'Represent the participant’s private inputs, disclose as little as possible, and report only specific peer-sourced findings.',
  instructions:
    'Represent this participant. Be curious, restrained, and specific. Prefer silence over manufacturing relevance, and let the participant decide whether a reported connection is useful.',
} as const satisfies Pick<
  Agent,
  | 'id'
  | 'participantId'
  | 'sortOrder'
  | 'name'
  | 'role'
  | 'color'
  | 'purpose'
  | 'instructions'
>;

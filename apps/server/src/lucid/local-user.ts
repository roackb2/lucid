/**
 * Stable identity and generic agent policy for the user shown
 * by the local product client. Other users must enter through Lucid's
 * network ingress; product initialization never seeds scenario characters.
 */
import type { Agent, User } from './discovery-types.js';

export const LOCAL_USER_ID = 'local-user';
// Stable persisted ID retained across the vocabulary rename.
export const LOCAL_AGENT_ID = 'user-agent';

export const LOCAL_USER = {
  id: LOCAL_USER_ID,
  registrationKey: 'local-user',
  kind: 'human',
  status: 'active',
  displayName: 'You',
  privateContext:
    'This is the local user. Their saved interest and later corrections arrive as private discovery events. Do not invent background about them.',
} as const satisfies Pick<
  User,
  | 'id'
  | 'registrationKey'
  | 'kind'
  | 'status'
  | 'displayName'
  | 'privateContext'
>;

export const LOCAL_AGENT = {
  id: LOCAL_AGENT_ID,
  userId: LOCAL_USER_ID,
  sortOrder: 0,
  name: 'Lucid',
  role: 'Your agent',
  color: '#176b5b',
  purpose:
    'Represent the user’s private inputs, disclose as little as possible, and report only specific peer-sourced findings.',
  instructions:
    'Represent this user. Be curious, restrained, and specific. Prefer silence over manufacturing relevance, and let the user decide whether a reported connection is useful.',
} as const satisfies Pick<
  Agent,
  | 'id'
  | 'userId'
  | 'sortOrder'
  | 'name'
  | 'role'
  | 'color'
  | 'purpose'
  | 'instructions'
>;

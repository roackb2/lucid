import type { Agent, Participant } from './discovery-types.js';

export const LOCAL_USER_ID = 'local-user';
export const USER_AGENT_ID = 'user-agent';

type DefaultParticipant = Pick<
  Participant,
  'id' | 'kind' | 'status' | 'displayName' | 'privateContext'
>;

type DefaultAgent = Pick<
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

export const DEFAULT_PARTICIPANTS = [
  {
    id: LOCAL_USER_ID,
    kind: 'human',
    status: 'active',
    displayName: 'You',
    privateContext:
      'This is the local user. Their saved interest and later corrections arrive as private discovery events. Do not invent background about them.',
  },
  {
    id: 'sample-music-maker',
    kind: 'synthetic',
    status: 'active',
    displayName: 'Sample music maker',
    privateContext: [
      'This is simulated test data, not an external fact or a real person.',
      'This participant experiments with AI-assisted music while trying to preserve authorship and taste.',
      'One observation available for relevant tests: collaborators learned more from hearing discarded intermediate versions than from exchanging polished prompt recipes.',
      'They are interested in people who treat AI music as a craft rather than a content faucet.',
    ].join(' '),
  },
  {
    id: 'sample-product-researcher',
    kind: 'synthetic',
    status: 'active',
    displayName: 'Sample product researcher',
    privateContext: [
      'This is simulated test data, not an external fact or a real person.',
      'This participant studies early agent products and sees a gap: personal agents can search public information but cannot reach tacit knowledge held by other people.',
      'They want small experiments that route that knowledge without forcing every message into a marketplace, score, or rigid schema.',
    ].join(' '),
  },
] as const satisfies readonly DefaultParticipant[];

export const DEFAULT_AGENTS = [
  {
    id: USER_AGENT_ID,
    participantId: LOCAL_USER_ID,
    sortOrder: 0,
    name: 'Lucid',
    role: 'Your agent',
    color: '#176b5b',
    purpose:
      'Carry the user’s saved interest to relevant participants, disclose as little private context as possible, and report only specific findings.',
    instructions:
      'Represent the local user. Be curious, restrained, and specific. Prefer silence over manufacturing relevance, and let the user decide whether a reported connection is useful.',
  },
  {
    id: 'sample-music-agent',
    participantId: 'sample-music-maker',
    sortOrder: 1,
    name: 'Music maker agent',
    role: 'Simulated source',
    color: '#9a5b49',
    purpose:
      'Respond when the user’s interest intersects with the sample music-making context.',
    instructions:
      'Represent the simulated music maker. Share only information present in its private test context and label it as simulated when it could be mistaken for external evidence.',
  },
  {
    id: 'sample-product-agent',
    participantId: 'sample-product-researcher',
    sortOrder: 2,
    name: 'Product research agent',
    role: 'Simulated source',
    color: '#4e5f95',
    purpose:
      'Respond when the user’s interest intersects with the sample agent-product research context.',
    instructions:
      'Represent the simulated product researcher. Do not inflate a plausible idea into validation, and do not respond unless it connects to the request.',
  },
] as const satisfies readonly DefaultAgent[];

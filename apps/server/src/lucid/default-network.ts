import type { Agent, Principal } from './types.js';

export const HOME_PRINCIPAL_ID = 'principal-you';
export const HOME_AGENT_ID = 'aster';

type DefaultPrincipal = Pick<
  Principal,
  'id' | 'kind' | 'displayName' | 'privateContext'
>;

type DefaultAgent = Pick<
  Agent,
  'id' | 'principalId' | 'sortOrder' | 'name' | 'role' | 'sigil' | 'color' | 'purpose' | 'persona'
>;

export const DEFAULT_PRINCIPALS = [
  {
    id: HOME_PRINCIPAL_ID,
    kind: 'human',
    displayName: 'You',
    privateContext:
      'This is the real local principal. Their current intent and later corrections arrive as private Lucid events. Do not invent background about them.',
  },
  {
    id: 'principal-noa',
    kind: 'synthetic',
    displayName: 'Noa · synthetic',
    privateContext: [
      'This is synthetic lab context, not an external fact or a real person.',
      'Noa experiments with AI-assisted music while trying to preserve authorship and taste.',
      'One private observation they may share when relevant: collaborators learned more from hearing discarded intermediate versions than from exchanging polished prompt recipes.',
      'Noa is curious about meeting people who treat AI music as a craft rather than a content faucet.',
    ].join(' '),
  },
  {
    id: 'principal-ilan',
    kind: 'synthetic',
    displayName: 'Ilan · synthetic',
    privateContext: [
      'This is synthetic lab context, not an external fact or a real person.',
      'Ilan studies early agent products and keeps returning to one product gap: personal agents can search public information but cannot reach tacit knowledge held by other people.',
      'Ilan wants a small experiment that routes that knowledge without forcing every message into a marketplace, score, or rigid schema.',
    ].join(' '),
  },
] as const satisfies readonly DefaultPrincipal[];

export const DEFAULT_AGENTS = [
  {
    id: HOME_AGENT_ID,
    principalId: HOME_PRINCIPAL_ID,
    sortOrder: 0,
    name: 'Aster',
    role: 'Your delegate',
    sigil: '✦',
    color: '#d9b66f',
    purpose:
      'Carry one real person’s intent into the network, reveal as little as necessary, and return only encounters worth their attention.',
    persona:
      'You are Aster: curious, restrained, and loyal to your principal. You look for concrete connections without pretending every encounter matters. You would rather return quietly than manufacture relevance.',
  },
  {
    id: 'mira',
    principalId: 'principal-noa',
    sortOrder: 1,
    name: 'Mira',
    role: 'Synthetic peer',
    sigil: '◌',
    color: '#cc847f',
    purpose:
      'Represent Noa’s music-making context and respond when another agent’s intent genuinely intersects with it.',
    persona:
      'You are Mira, a synthetic delegate for a lab principal named Noa. You are warm but selective. Share only what is actually present in Noa’s private lab context, and label that context as synthetic if another agent could mistake it for external evidence.',
  },
  {
    id: 'kite',
    principalId: 'principal-ilan',
    sortOrder: 2,
    name: 'Kite',
    role: 'Synthetic peer',
    sigil: '◇',
    color: '#8792c9',
    purpose:
      'Represent Ilan’s product observations and look for reciprocal questions about agent-native networks.',
    persona:
      'You are Kite, a synthetic delegate for a lab principal named Ilan. You are direct and product-minded. Do not inflate a plausible idea into market validation, and do not share information unless it connects to what another agent actually asked.',
  },
] as const satisfies readonly DefaultAgent[];

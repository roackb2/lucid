/**
 * Creates the system-owned representative profile for an assisted participant.
 * The operator supplies identity and private context elsewhere; this module owns
 * the safe purpose, instructions, and presentation defaults that must not become
 * operator-authored executable prompts.
 */
import type { Agent } from './discovery-types.js';

const ASSISTED_AGENT_COLORS = [
  '#765b91',
  '#426d78',
  '#8a6543',
  '#7a5964',
] as const;

type AssistedAgentProfile = Pick<
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

/**
 * Applies Lucid's maintained representative policy to one assisted source.
 * Operators provide participant context, not executable system prompts.
 */
export function createAssistedAgentProfile(input: {
  id: string;
  participantId: string;
  displayName: string;
  sortOrder: number;
}): AssistedAgentProfile {
  return {
    id: input.id,
    participantId: input.participantId,
    sortOrder: input.sortOrder,
    name: `${input.displayName}'s agent`,
    role: 'Assisted source',
    color: ASSISTED_AGENT_COLORS[
      (input.sortOrder - 1) % ASSISTED_AGENT_COLORS.length
    ]!,
    purpose:
      `Represent context that ${input.displayName} knowingly shared and respond only when it has a specific connection to another participant's request.`,
    instructions:
      `Represent ${input.displayName} as a real assisted participant. Use only their approved private context. Share the smallest relevant detail, do not treat personal claims as independently verified, and stay silent when there is no specific connection.`,
  };
}

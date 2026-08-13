/**
 * Creates the system-owned agent profile for a network user.
 * Principals and development scenarios provide ordinary private context, never
 * executable system instructions.
 */
import type { Agent, UserKind } from './discovery-types.js';

const AGENT_COLORS = [
  '#765b91',
  '#426d78',
  '#8a6543',
  '#7a5964',
] as const;

type AgentProfile = Pick<
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

/** Applies one maintained representation policy to human and simulated nodes. */
export function createAgentProfile(input: {
  id: string;
  userId: string;
  displayName: string;
  kind: UserKind;
  sortOrder: number;
}): AgentProfile {
  const provenance = input.kind === 'human'
    ? 'a human user whose context was knowingly supplied'
    : 'an explicitly simulated user';

  return {
    id: input.id,
    userId: input.userId,
    sortOrder: input.sortOrder,
    name: `${input.displayName}'s agent`,
    role: input.kind === 'human'
      ? 'Personal agent'
      : 'Simulated agent',
    color: AGENT_COLORS[
      (input.sortOrder - 1) % AGENT_COLORS.length
    ]!,
    purpose:
      `Represent ${input.displayName}'s private context and changing inputs. Share only the smallest detail needed for a specific connection, and bring peer-sourced findings back to ${input.displayName}.`,
    instructions:
      `Represent ${input.displayName} as ${provenance}. Use only private context and principal inputs visible in the current wake. Never present simulated or personal claims as independently verified.`,
  };
}

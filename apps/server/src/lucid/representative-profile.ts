/**
 * Creates the system-owned representative profile for a network participant.
 * Principals and development scenarios provide ordinary private context, never
 * executable system instructions.
 */
import type { Agent, ParticipantKind } from './discovery-types.js';

const REPRESENTATIVE_COLORS = [
  '#765b91',
  '#426d78',
  '#8a6543',
  '#7a5964',
] as const;

type RepresentativeProfile = Pick<
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

/** Applies one maintained representation policy to human and simulated nodes. */
export function createRepresentativeProfile(input: {
  id: string;
  participantId: string;
  displayName: string;
  kind: ParticipantKind;
  sortOrder: number;
}): RepresentativeProfile {
  const provenance = input.kind === 'human'
    ? 'a human participant whose context was knowingly supplied'
    : 'an explicitly simulated participant';

  return {
    id: input.id,
    participantId: input.participantId,
    sortOrder: input.sortOrder,
    name: `${input.displayName}'s representative`,
    role: input.kind === 'human'
      ? 'Participant representative'
      : 'Simulated representative',
    color: REPRESENTATIVE_COLORS[
      (input.sortOrder - 1) % REPRESENTATIVE_COLORS.length
    ]!,
    purpose:
      `Represent ${input.displayName}'s private context and changing inputs. Share only the smallest detail needed for a specific connection, and bring peer-sourced findings back to ${input.displayName}.`,
    instructions:
      `Represent ${input.displayName} as ${provenance}. Use only private context and principal inputs visible in the current wake. Never present simulated or personal claims as independently verified.`,
  };
}

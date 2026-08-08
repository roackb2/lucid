/** Policy-free PostgreSQL record decoding and normalization. */
import {
  agentStatusSchema,
  discoveryEventKindSchema,
  participantKindSchema,
  participantStatusSchema,
  type Agent,
  type DiscoveryEvent,
  type DiscoveryWorkspace,
  type Participant,
} from '../../discovery-types.js';
import {
  postgresDiscoveryEvents,
  postgresDiscoveryWorkspaces,
  postgresParticipants,
  postgresRepresentativeAgents,
} from './schema.js';

type AgentRow = typeof postgresRepresentativeAgents.$inferSelect;
type DiscoveryEventRow = typeof postgresDiscoveryEvents.$inferSelect;
type DiscoveryWorkspaceRow = typeof postgresDiscoveryWorkspaces.$inferSelect;
type ParticipantRow = typeof postgresParticipants.$inferSelect;

export function toAgent(row: AgentRow): Agent {
  return {
    ...row,
    status: agentStatusSchema.parse(row.status),
    activeWakeId: row.activeWakeId ?? undefined,
    activeWakeClaimToken: row.activeWakeClaimToken ?? undefined,
    activeWakeNumber: row.activeWakeNumber ?? undefined,
    activeWakeHorizon: row.activeWakeHorizon ?? undefined,
    lastRunAt: row.lastRunAt ?? undefined,
  };
}

export function toParticipant(row: ParticipantRow): Participant {
  return {
    ...row,
    registrationKey: row.registrationKey ?? undefined,
    kind: participantKindSchema.parse(row.kind),
    status: participantStatusSchema.parse(row.status),
    contextConsentAt: row.contextConsentAt ?? undefined,
  };
}

export function toDiscoveryEvent(row: DiscoveryEventRow): DiscoveryEvent {
  return {
    ...row,
    kind: discoveryEventKindSchema.parse(row.kind),
    actorAgentId: row.actorAgentId ?? undefined,
    targetAgentId: row.targetAgentId ?? undefined,
    targetParticipantId: row.targetParticipantId ?? undefined,
    replyToSequence: row.replyToSequence ?? undefined,
    idempotencyKey: row.idempotencyKey ?? undefined,
    metadata: row.metadata ?? {},
  };
}

export function toDiscoveryWorkspace(
  row: DiscoveryWorkspaceRow,
): DiscoveryWorkspace {
  return { ...row };
}

export function readSequenceIds(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => Number.isInteger(item) && item > 0)
    : [];
}

export function readMetadataSequence(value: unknown): number {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : 0;
}

export function uniqueEvents(events: DiscoveryEvent[]): DiscoveryEvent[] {
  return [...new Map(events.map((event) => [event.sequence, event])).values()]
    .sort((left, right) => left.sequence - right.sequence);
}

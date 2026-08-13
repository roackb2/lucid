/** Policy-free PostgreSQL record decoding and normalization. */
import {
  agentStatusSchema,
  discoveryEventKindSchema,
  userKindSchema,
  userStatusSchema,
  type Agent,
  type DiscoveryEvent,
  type DiscoveryWorkspace,
  type User,
} from '../../discovery-types.js';
import {
  postgresDiscoveryEvents,
  postgresDiscoveryWorkspaces,
  postgresUsers,
  postgresAgents,
} from './schema.js';

type AgentRow = typeof postgresAgents.$inferSelect;
type DiscoveryEventRow = typeof postgresDiscoveryEvents.$inferSelect;
type DiscoveryWorkspaceRow = typeof postgresDiscoveryWorkspaces.$inferSelect;
type UserRow = typeof postgresUsers.$inferSelect;

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

export function toUser(row: UserRow): User {
  return {
    ...row,
    registrationKey: row.registrationKey ?? undefined,
    kind: userKindSchema.parse(row.kind),
    status: userStatusSchema.parse(row.status),
    contextConsentAt: row.contextConsentAt ?? undefined,
  };
}

export function toDiscoveryEvent(row: DiscoveryEventRow): DiscoveryEvent {
  return {
    ...row,
    kind: discoveryEventKindSchema.parse(row.kind),
    actorAgentId: row.actorAgentId ?? undefined,
    targetAgentId: row.targetAgentId ?? undefined,
    targetUserId: row.targetUserId ?? undefined,
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

/** PostgreSQL adapter for one representative's communication tools. */
import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  lte,
  ne,
  or,
} from 'drizzle-orm';
import type { PostgresDatabase } from '../../../infrastructure/postgres/database.js';
import type {
  Agent,
  AppendDiscoveryEventInput,
  DiscoveryEvent,
  Participant,
} from '../../discovery-types.js';
import {
  readMetadataSequence,
  readSequenceIds,
  toAgent,
  toDiscoveryEvent,
  toParticipant,
  uniqueEvents,
} from '../../persistence/postgres/records.js';
import {
  postgresDiscoveryEvents as discoveryEvents,
  postgresDiscoveryWorkspaces as discoveryWorkspaces,
  postgresParticipants as participants,
  postgresRepresentativeAgents as representativeAgents,
} from '../../persistence/postgres/schema.js';
import { LUCID_WORKSPACE_ID } from '../../workspace/workspace-identity.js';
import { AGENT_PRINCIPAL_EVENT_KINDS } from '../mailbox-policy.js';
import type {
  AgentCommunicationStore,
  AppendCommunicationEventInput,
} from './store.js';

export class PostgresAgentCommunicationStore
implements AgentCommunicationStore {
  constructor(private readonly database: PostgresDatabase) {}

  private async listParticipants(): Promise<Participant[]> {
    return (await this.database.orm
      .select()
      .from(participants)
      .where(eq(participants.workspaceId, LUCID_WORKSPACE_ID))
      .orderBy(asc(participants.createdAt)))
      .map(toParticipant);
  }

  async listAgents(): Promise<Agent[]> {
    return (await this.database.orm
      .select()
      .from(representativeAgents)
      .where(eq(representativeAgents.workspaceId, LUCID_WORKSPACE_ID))
      .orderBy(asc(representativeAgents.sortOrder)))
      .map(toAgent);
  }

  async listActiveAgents(): Promise<Agent[]> {
    const [participantList, agentList] = await Promise.all([
      this.listParticipants(),
      this.listAgents(),
    ]);
    const activeParticipantIds = new Set(
      participantList
        .filter((participant) => participant.status === 'active')
        .map((participant) => participant.id),
    );
    return agentList.filter(
      (agent) => activeParticipantIds.has(agent.participantId),
    );
  }

  private async requireAgentByParticipantId(participantId: string): Promise<Agent> {
    const [row] = await this.database.orm
      .select()
      .from(representativeAgents)
      .where(and(
        eq(representativeAgents.workspaceId, LUCID_WORKSPACE_ID),
        eq(representativeAgents.participantId, participantId),
      ))
      .limit(1);
    if (!row) {
      throw new Error(
        `Representative agent not found for participant: ${participantId}`,
      );
    }
    return toAgent(row);
  }

  async listEventsVisibleToAgent(
    agentId: string,
    afterSequence: number,
    limit = 40,
    throughSequence?: number,
  ): Promise<DiscoveryEvent[]> {
    const agent = await this.findActiveAgent(agentId);
    if (!agent) {
      return [];
    }
    // The caller may request older history, but it can never bypass the join or
    // resume floor established for this participant.
    const visibleAfterSequence = Math.max(
      afterSequence,
      agent.mailboxFloorSequence,
    );
    return (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        gt(discoveryEvents.sequence, visibleAfterSequence),
        // A claimed wake passes throughSequence so concurrent arrivals remain
        // unread for the next wake instead of changing the current model input.
        throughSequence === undefined
          ? undefined
          : lte(discoveryEvents.sequence, throughSequence),
        or(
          and(
            eq(discoveryEvents.kind, 'shared_message'),
            ne(discoveryEvents.actorAgentId, agentId),
          ),
          and(
            eq(discoveryEvents.kind, 'direct_message'),
            eq(discoveryEvents.targetAgentId, agentId),
          ),
          and(
            inArray(discoveryEvents.kind, AGENT_PRINCIPAL_EVENT_KINDS),
            eq(discoveryEvents.targetAgentId, agentId),
          ),
        ),
      ))
      .orderBy(asc(discoveryEvents.sequence))
      .limit(limit))
      .map(toDiscoveryEvent);
  }

  async readVisibleEventsBySequence(
    agentId: string,
    sequences: number[],
  ): Promise<DiscoveryEvent[]> {
    const agent = await this.findActiveAgent(agentId);
    if (!sequences.length || !agent) {
      return [];
    }

    return (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        inArray(discoveryEvents.sequence, sequences),
        gt(discoveryEvents.sequence, agent.mailboxFloorSequence),
        or(
          and(
            eq(discoveryEvents.kind, 'shared_message'),
            ne(discoveryEvents.actorAgentId, agentId),
          ),
          and(
            eq(discoveryEvents.kind, 'direct_message'),
            eq(discoveryEvents.targetAgentId, agentId),
          ),
          and(
            inArray(discoveryEvents.kind, AGENT_PRINCIPAL_EVENT_KINDS),
            eq(discoveryEvents.targetAgentId, agentId),
          ),
        ),
      ))
      .orderBy(asc(discoveryEvents.sequence)))
      .map(toDiscoveryEvent);
  }

  async hasParticipantFindingUsingAnyOrigin(
    participantId: string,
    sourceEventIds: number[],
  ): Promise<boolean> {
    if (!sourceEventIds.length) {
      return false;
    }
    const reporter = await this.requireAgentByParticipantId(participantId);
    const requested = new Set(
      (await this.findOriginatingPeerMessages(sourceEventIds, reporter.id))
        .map(({ sequence }) => sequence),
    );
    if (!requested.size) {
      return false;
    }
    const findings = (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'finding_reported'),
        eq(discoveryEvents.targetParticipantId, participantId),
      )))
      .map(toDiscoveryEvent);
    return (await Promise.all(findings.map(async (finding) => (
      await this.findOriginatingPeerMessages(
        readSequenceIds(finding.metadata.sourceEventIds),
        reporter.id,
      )
    )))).some((origins) => (
      origins.some(({ sequence }) => requested.has(sequence))
    ));
  }

  async findAgentPublishedRequestForTrigger(
    agentId: string,
    triggerSequence: number,
  ): Promise<DiscoveryEvent | undefined> {
    const [row] = await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'shared_message'),
        eq(discoveryEvents.actorAgentId, agentId),
        eq(discoveryEvents.replyToSequence, triggerSequence),
      ))
      .orderBy(asc(discoveryEvents.sequence))
      .limit(1);
    return row ? toDiscoveryEvent(row) : undefined;
  }

  async hasAgentUpdatedWorkingNoteThrough(
    agentId: string,
    sourceSequence: number,
  ): Promise<boolean> {
    return (await this.database.orm
      .select({ metadata: discoveryEvents.metadata })
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'representative_note_updated'),
        eq(discoveryEvents.actorAgentId, agentId),
        eq(discoveryEvents.targetAgentId, agentId),
        gt(discoveryEvents.sequence, sourceSequence),
      )))
      .some(({ metadata }) => (
        readMetadataSequence(metadata?.throughSequence) >= sourceSequence
      ));
  }

  async countAgentWakeCommunicationActions(
    agentId: string,
    wakeNumber: number,
  ): Promise<number> {
    return (await this.database.orm
      .select({ sequence: discoveryEvents.sequence })
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.actorAgentId, agentId),
        eq(discoveryEvents.wakeNumber, wakeNumber),
        inArray(discoveryEvents.kind, [
          'shared_message',
          'direct_message',
          'finding_reported',
          'agent_wake_no_action',
        ]),
      )))
      .length;
  }

  async hasAgentContributedToRequestThread(
    agentId: string,
    replyToSequence: number,
    currentWakeId: string,
  ): Promise<boolean> {
    const requestRoot = await this.findReplyThreadRoot(replyToSequence);
    if (!requestRoot) {
      return false;
    }

    const priorMessages = (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.actorAgentId, agentId),
        inArray(
          discoveryEvents.kind,
          ['shared_message', 'direct_message'],
        ),
      )))
      .map(toDiscoveryEvent)
      .filter((event) => event.metadata.wakeId !== currentWakeId);
    return (await Promise.all(priorMessages.map(
      async (event) => await this.findReplyThreadRoot(event.sequence),
    ))).some((root) => root === requestRoot);
  }

  async appendCommunicationEvent(
    input: AppendCommunicationEventInput,
  ): Promise<DiscoveryEvent> {
    return await this.appendEvent(input);
  }

  private async appendEvent(
    input: AppendDiscoveryEventInput,
  ): Promise<DiscoveryEvent> {
    return await this.database.orm.transaction(async (transaction) => {
      // The unique key is the final concurrency authority. `onConflictDoNothing`
      // allows simultaneous retries from different workers without surfacing a
      // transient constraint error or duplicating the side effect.
      const [workspace] = await transaction
        .select({ currentWake: discoveryWorkspaces.currentWake })
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, LUCID_WORKSPACE_ID))
        .limit(1);
      if (!workspace) {
        throw new Error(
          'Discovery workspace is missing. Run the database migration and restart the service.',
        );
      }
      const [inserted] = await transaction
        .insert(discoveryEvents)
        .values({
          id: `event_${randomUUID()}`,
          workspaceId: LUCID_WORKSPACE_ID,
          wakeNumber: input.wakeNumber ?? workspace.currentWake,
          kind: input.kind,
          actorAgentId: input.actorAgentId,
          targetAgentId: input.targetAgentId,
          targetParticipantId: input.targetParticipantId,
          replyToSequence: input.replyToSequence,
          idempotencyKey: input.idempotencyKey,
          title: input.title,
          content: input.content,
          metadata: input.metadata ?? {},
          createdAt: dayjs().toISOString(),
        })
        .onConflictDoNothing({ target: discoveryEvents.idempotencyKey })
        .returning();
      if (inserted) {
        return toDiscoveryEvent(inserted);
      }
      if (!input.idempotencyKey) {
        throw new Error('PostgreSQL did not return the appended event.');
      }
      const [existing] = await transaction
        .select()
        .from(discoveryEvents)
        .where(eq(discoveryEvents.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (!existing) {
        throw new Error(
          `Idempotent event is missing after a concurrent insert: ${input.idempotencyKey}`,
        );
      }
      return toDiscoveryEvent(existing);
    });
  }

  private async findReplyThreadRoot(
    sequence: number,
  ): Promise<number | undefined> {
    const visited = new Set<number>();
    let currentSequence: number | undefined = sequence;
    let latestResolved: number | undefined;

    while (currentSequence && !visited.has(currentSequence)) {
      visited.add(currentSequence);
      const event: DiscoveryEvent | undefined = (
        await this.readEventsBySequence([currentSequence])
      )[0];
      if (!event) {
        return latestResolved;
      }
      latestResolved = event.sequence;
      currentSequence = event.replyToSequence;
    }

    return latestResolved;
  }

  private async findOriginatingPeerMessages(
    sourceEventIds: number[],
    reporterAgentId?: string,
  ): Promise<DiscoveryEvent[]> {
    const memo = new Map<number, DiscoveryEvent[]>();

    const resolve = async (
      sequence: number,
      ancestors: ReadonlySet<number>,
    ): Promise<DiscoveryEvent[]> => {
      const cached = memo.get(sequence);
      if (cached) {
        return cached;
      }
      if (ancestors.has(sequence)) {
        return [];
      }
      const event = (await this.readEventsBySequence([sequence]))[0];
      if (!event) {
        memo.set(sequence, []);
        return [];
      }
      const sourceEvents = await this.readEventsBySequence(
        readSequenceIds(event.metadata.sourceEventIds),
      );
      const nextAncestors = new Set([...ancestors, sequence]);
      const upstream = uniqueEvents((await Promise.all(sourceEvents.map(
        async (source) => await resolve(source.sequence, nextAncestors),
      ))).flat());
      const isPeerMessage = Boolean(
        event.actorAgentId
        && event.actorAgentId !== reporterAgentId
        && ['shared_message', 'direct_message'].includes(event.kind),
      );
      const hasParticipantOwnedSource = sourceEvents.some((source) => (
        source.targetAgentId === event.actorAgentId
        && [
          'interest_saved',
          'participant_input',
          'check_requested',
          'feedback_saved',
          'representative_note_updated',
        ].includes(source.kind)
      ));
      const originatesContent = isPeerMessage
        && (!upstream.length || hasParticipantOwnedSource);
      const origins = uniqueEvents([
        ...upstream,
        ...(originatesContent ? [event] : []),
      ]);
      memo.set(sequence, origins);
      return origins;
    };

    return uniqueEvents((await Promise.all(sourceEventIds.map(
      async (sequence) => await resolve(sequence, new Set()),
    ))).flat());
  }

  private async readEventsBySequence(
    sequences: number[],
  ): Promise<DiscoveryEvent[]> {
    if (!sequences.length) {
      return [];
    }
    return (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        inArray(discoveryEvents.sequence, sequences),
      ))
      .orderBy(asc(discoveryEvents.sequence)))
      .map(toDiscoveryEvent);
  }

  private async findActiveAgent(agentId: string): Promise<Agent | undefined> {
    const [row] = await this.database.orm
      .select({
        participantStatus: participants.status,
        agent: representativeAgents,
      })
      .from(representativeAgents)
      .innerJoin(
        participants,
        eq(participants.id, representativeAgents.participantId),
      )
      .where(and(
        eq(representativeAgents.workspaceId, LUCID_WORKSPACE_ID),
        eq(representativeAgents.id, agentId),
      ))
      .limit(1);
    return row?.participantStatus === 'active'
      ? toAgent(row.agent)
      : undefined;
  }
}

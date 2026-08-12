/** PostgreSQL adapter for participant-facing workspace commands and views. */
import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  lte,
  ne,
  or,
} from 'drizzle-orm';
import {
  type AppendDiscoveryEventInput,
  type Agent,
  type AgentView,
  type DiscoveryEvent,
  type DiscoveryWorkspace,
  type GuidanceFollowThroughView,
  type FindingView,
  type FindingSourceView,
  type NetworkActivityView,
  type NetworkRequestHistoryItemView,
  type NetworkRequestProgressPhase,
  type NetworkRequestProgressView,
  type Participant,
  type RepresentativeWorkingContext,
} from '../discovery-types.js';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import { toParticipantView } from '../network/participant-visibility.js';
import {
  readMetadataSequence,
  readSequenceIds,
  toAgent,
  toDiscoveryEvent,
  toDiscoveryWorkspace,
  toParticipant,
  uniqueEvents,
} from '../persistence/postgres/records.js';
import {
  postgresDiscoveryEvents as discoveryEvents,
  postgresDiscoveryWorkspaces as discoveryWorkspaces,
  postgresParticipants as participants,
  postgresRepresentativeAgents as representativeAgents,
} from '../persistence/postgres/schema.js';
import { AGENT_PRINCIPAL_EVENT_KINDS } from '../representative/mailbox-policy.js';
import type {
  DiscoveryWorkspaceStore,
  DiscoveryWorkspaceStoreSnapshot,
  RecordCheckRequestInput,
} from './store.js';
import { LUCID_WORKSPACE_ID } from './workspace-identity.js';

const FINDING_LIMIT = 12;
const NETWORK_REQUEST_HISTORY_LIMIT = 5;
const PRINCIPAL_INPUT_LIMIT = 6;

function resolveNetworkRequestProgressPhase(input: {
  responseCount: number;
  pendingReviewCount: number;
  hasLinkedFinding: boolean;
}): NetworkRequestProgressPhase {
  if (!input.responseCount) {
    return 'waiting-for-network';
  }
  if (input.pendingReviewCount) {
    return 'messages-pending-review';
  }
  if (input.hasLinkedFinding) {
    return 'finding-reported';
  }
  return 'reviewed-without-finding';
}

/**
 * PostgreSQL/Drizzle adapter for Lucid's service-owned persistence ports.
 * Content remains ordinary language and is never scored here.
 */
export class PostgresDiscoveryWorkspaceStore
implements DiscoveryWorkspaceStore {
  constructor(private readonly database: PostgresDatabase) {}

  async readSnapshot(
    participantId: string,
  ): Promise<DiscoveryWorkspaceStoreSnapshot> {
    const workspace = await this.requireWorkspace();
    const [user, representative] = await Promise.all([
      this.requireParticipant(participantId),
      this.requireParticipantAgent(participantId),
    ]);
    const workingContext = await this.readRepresentativeWorkingContext(
      representative.id,
      Number.MAX_SAFE_INTEGER,
    );
    return {
      workspace,
      user: toParticipantView(user),
      representative: await this.toAgentView(representative, user),
      interest: await this.findSavedInterest(participantId),
      workingNote: workingContext.workingNote,
      networkActivity: await this.readNetworkActivity(representative),
      guidanceFollowThrough: await this.readGuidanceFollowThrough(
        representative,
        workingContext.findings,
      ),
      findings: workingContext.findings,
    };
  }

  private async requireParticipant(id: string): Promise<Participant> {
    const [row] = await this.database.orm
      .select()
      .from(participants)
      .where(and(
        eq(participants.workspaceId, LUCID_WORKSPACE_ID),
        eq(participants.id, id),
      ))
      .limit(1);
    if (!row) {
      throw new Error(`Participant not found: ${id}`);
    }
    return toParticipant(row);
  }

  private async requireAgent(id: string): Promise<Agent> {
    const [row] = await this.database.orm
      .select()
      .from(representativeAgents)
      .where(and(
        eq(representativeAgents.workspaceId, LUCID_WORKSPACE_ID),
        eq(representativeAgents.id, id),
      ))
      .limit(1);
    if (!row) {
      throw new Error(`Representative agent not found: ${id}`);
    }
    return toAgent(row);
  }

  private async requireAgentByParticipantId(
    participantId: string,
  ): Promise<Agent> {
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

  async requireParticipantAgent(participantId: string): Promise<Agent> {
    return await this.requireAgentByParticipantId(participantId);
  }

  async findSavedInterest(
    participantId: string,
  ): Promise<DiscoveryEvent | undefined> {
    const representative = await this.requireParticipantAgent(participantId);
    const [row] = await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'interest_saved'),
        eq(discoveryEvents.targetAgentId, representative.id),
        eq(discoveryEvents.targetParticipantId, participantId),
      ))
      .orderBy(desc(discoveryEvents.sequence))
      .limit(1);
    return row ? toDiscoveryEvent(row) : undefined;
  }

  async saveInterest(
    participantId: string,
    content: string,
  ): Promise<DiscoveryEvent> {
    const representative = await this.requireParticipantAgent(participantId);
    return await this.appendEvent({
      kind: 'interest_saved',
      targetAgentId: representative.id,
      targetParticipantId: participantId,
      title: 'You update what Lucid should look for',
      content,
      metadata: {
        visibility: 'user-and-agent',
        source: 'user',
      },
    });
  }

  async saveFeedback(
    participantId: string,
    findingSequence: number,
    content: string,
  ): Promise<DiscoveryEvent> {
    const finding = await this.requireParticipantFinding(
      participantId,
      findingSequence,
    );
    const [existing] = await this.database.orm
      .select({ sequence: discoveryEvents.sequence })
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'feedback_saved'),
        eq(discoveryEvents.replyToSequence, findingSequence),
      ))
      .limit(1);
    if (existing) {
      throw new Error('Feedback has already been saved for this finding.');
    }

    return await this.appendEvent({
      kind: 'feedback_saved',
      targetAgentId: (await this.requireAgentByParticipantId(participantId)).id,
      targetParticipantId: participantId,
      replyToSequence: finding.sequence,
      title: 'You explain how this finding should affect future checks',
      content,
      metadata: {
        visibility: 'user-and-agent',
        findingSequence,
      },
    });
  }

  async saveGuidance(
    participantId: string,
    content: string,
  ): Promise<DiscoveryEvent> {
    const normalizedContent = content.trim();
    if (!normalizedContent || normalizedContent.length > 1_600) {
      throw new Error('Guidance must contain 1 to 1,600 characters.');
    }
    const [interest, representative] = await Promise.all([
      this.findSavedInterest(participantId),
      this.requireParticipantAgent(participantId),
    ]);
    if (!interest) {
      throw new Error('Save an interest before refining the representative.');
    }
    const workingNote = await this.findWorkingNote(
      representative,
      Number.MAX_SAFE_INTEGER,
    );

    return await this.appendEvent({
      kind: 'guidance_saved',
      targetAgentId: representative.id,
      targetParticipantId: representative.participantId,
      replyToSequence: workingNote?.sequence,
      title: 'You correct or refine your representative’s direction',
      content: normalizedContent,
      metadata: {
        visibility: 'user-and-agent',
        source: 'user',
        interestSequence: interest.sequence,
        workingNoteSequence: workingNote?.sequence,
      },
    });
  }

  private async listEventsVisibleToAgent(
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

  async readRepresentativeWorkingContext(
    agentId: string,
    throughSequence: number,
  ): Promise<RepresentativeWorkingContext> {
    const agent = await this.requireAgent(agentId);
    const boundedSequence = Math.max(0, throughSequence);

    // This projection deliberately ignores unread cursors. Findings and
    // feedback remain relevant after mailbox consumption, while the explicit
    // sequence bound preserves one claimed wake's retry-stable view.
    const [principalInputs, findings, workingNote] = await Promise.all([
      this.listPrincipalInputs(
        agent,
        boundedSequence,
      ),
      this.listFindings(
        agent.participantId,
        boundedSequence,
      ),
      this.findWorkingNote(
        agent,
        boundedSequence,
      ),
    ]);
    return {
      principalInputs,
      findings,
      workingNote,
    };
  }

  async recordCheckRequest(
    input: RecordCheckRequestInput,
  ): Promise<DiscoveryEvent> {
    return await this.appendEvent({
      ...input,
      kind: 'check_requested',
    });
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

  private async listPrincipalInputs(
    agent: Agent,
    throughSequence: number,
  ): Promise<DiscoveryEvent[]> {
    const [latestInterestRows, recentParticipantInputRows] = await Promise.all([
      this.database.orm
        .select()
        .from(discoveryEvents)
        .where(and(
          eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
          eq(discoveryEvents.kind, 'interest_saved'),
          eq(discoveryEvents.targetAgentId, agent.id),
          eq(discoveryEvents.targetParticipantId, agent.participantId),
          lte(discoveryEvents.sequence, throughSequence),
        ))
        .orderBy(desc(discoveryEvents.sequence))
        .limit(1),
      this.database.orm
        .select()
        .from(discoveryEvents)
        .where(and(
          eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
          inArray(discoveryEvents.kind, [
            'participant_input',
            'guidance_saved',
          ]),
          eq(discoveryEvents.targetAgentId, agent.id),
          eq(discoveryEvents.targetParticipantId, agent.participantId),
          lte(discoveryEvents.sequence, throughSequence),
        ))
        .orderBy(desc(discoveryEvents.sequence))
        .limit(PRINCIPAL_INPUT_LIMIT),
    ]);
    const latestInterest = latestInterestRows[0];
    const recentParticipantInputs = recentParticipantInputRows.reverse();

    return [
      ...(latestInterest ? [toDiscoveryEvent(latestInterest)] : []),
      ...recentParticipantInputs.map(toDiscoveryEvent),
    ].sort((left, right) => left.sequence - right.sequence);
  }

  private async findWorkingNote(
    agent: Agent,
    throughSequence: number,
  ): Promise<DiscoveryEvent | undefined> {
    const [row] = await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'representative_note_updated'),
        eq(discoveryEvents.actorAgentId, agent.id),
        eq(discoveryEvents.targetAgentId, agent.id),
        eq(discoveryEvents.targetParticipantId, agent.participantId),
        lte(discoveryEvents.sequence, throughSequence),
      ))
      .orderBy(desc(discoveryEvents.sequence))
      .limit(1);
    return row ? toDiscoveryEvent(row) : undefined;
  }

  private async listFindings(
    participantId: string,
    throughSequence = Number.MAX_SAFE_INTEGER,
  ): Promise<FindingView[]> {
    const findings = (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'finding_reported'),
        eq(discoveryEvents.targetParticipantId, participantId),
        lte(discoveryEvents.sequence, throughSequence),
      ))
      .orderBy(desc(discoveryEvents.sequence))
      .limit(FINDING_LIMIT))
      .map(toDiscoveryEvent);
    return await Promise.all(findings.map(async (finding) => {
      const sourceEventIds = readSequenceIds(finding.metadata.sourceEventIds);
      const [
        sourceEvents,
        originatingSources,
        outboundMessages,
        assignmentRows,
        feedbackRows,
      ] = await Promise.all([
        this.readEventsBySequence(sourceEventIds),
        this.findOriginatingPeerMessages(
          sourceEventIds,
          finding.actorAgentId,
        ),
        this.listRequestThreadOutboundMessages(
          sourceEventIds,
          finding.actorAgentId,
        ),
        this.database.orm
          .select({ sequence: discoveryEvents.sequence })
          .from(discoveryEvents)
          .where(and(
            eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
            eq(discoveryEvents.kind, 'interest_saved'),
            eq(discoveryEvents.targetParticipantId, participantId),
            lte(discoveryEvents.sequence, finding.sequence),
          ))
          .orderBy(desc(discoveryEvents.sequence))
          .limit(1),
        this.database.orm
          .select()
          .from(discoveryEvents)
          .where(and(
            eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
            eq(discoveryEvents.kind, 'feedback_saved'),
            eq(discoveryEvents.replyToSequence, finding.sequence),
            lte(discoveryEvents.sequence, throughSequence),
          ))
          .orderBy(desc(discoveryEvents.sequence))
          .limit(1),
      ]);
      const [sources, originatingSourceViews] = await Promise.all([
        Promise.all(sourceEvents.map(
          async (source) => await this.toFindingSourceView(source),
        )),
        Promise.all(originatingSources.map(
          async (source) => await this.toFindingSourceView(source),
        )),
      ]);

      return {
        finding,
        sources,
        originatingSources: originatingSourceViews,
        outboundMessages,
        feedback: feedbackRows[0]
          ? toDiscoveryEvent(feedbackRows[0])
          : undefined,
        noMatch: finding.metadata.noMatch === true,
        assignmentSequence: assignmentRows[0]?.sequence,
        origin: outboundMessages.length
          ? 'request-thread' as const
          : 'ambient-network' as const,
      };
    }));
  }

  private async readNetworkActivity(
    representative: Agent,
  ): Promise<NetworkActivityView | undefined> {
    const [assignmentRow] = await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.targetAgentId, representative.id),
        eq(discoveryEvents.kind, 'interest_saved'),
      ))
      .orderBy(desc(discoveryEvents.sequence))
      .limit(1);
    if (!assignmentRow) {
      return undefined;
    }

    // Manual checks are execution nudges for the current assignment, not new
    // assignment roots. Keeping this projection anchored to the saved interest
    // prevents “Run now” from making the product appear to forget its request.
    const assignment = toDiscoveryEvent(assignmentRow);
    const checks = (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'check_requested'),
        eq(discoveryEvents.targetAgentId, representative.id),
        gt(discoveryEvents.sequence, assignment.sequence),
      ))
      .orderBy(desc(discoveryEvents.sequence)))
      .map(toDiscoveryEvent);
    const requestTriggers = [...checks, assignment];
    const triggerSequences = new Set(
      requestTriggers.map(({ sequence }) => sequence),
    );
    const requestByTriggerSequence = (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'shared_message'),
        eq(discoveryEvents.actorAgentId, representative.id),
        gt(discoveryEvents.sequence, assignment.sequence),
      ))
      .orderBy(asc(discoveryEvents.sequence)))
      .map(toDiscoveryEvent)
      .reduce((byTrigger, request) => {
        const triggerSequence = request.replyToSequence;
        if (
          !triggerSequence
          || !triggerSequences.has(triggerSequence)
          || byTrigger.has(triggerSequence)
        ) {
          return byTrigger;
        }
        byTrigger.set(triggerSequence, request);
        return byTrigger;
      }, new Map<number, DiscoveryEvent>());
    const findingEvents = await this.listFindingEvents(
      representative.participantId,
      representative.id,
      assignment.sequence,
    );
    const currentTrigger = requestTriggers[0]!;
    const request = requestByTriggerSequence.get(currentTrigger.sequence);
    const previousRequestItems = await Promise.all(requestTriggers
      .slice(1)
      .map(async (trigger) => {
        const previousRequest = requestByTriggerSequence.get(trigger.sequence);
        return previousRequest
          ? await this.toNetworkRequestHistoryItem(
              representative,
              trigger,
              previousRequest,
              findingEvents,
            )
          : undefined;
      }));
    const previousRequests = previousRequestItems
      .filter((item): item is NetworkRequestHistoryItemView => Boolean(item))
      .slice(0, NETWORK_REQUEST_HISTORY_LIMIT);
    if (!request) {
      return { assignment, previousRequests };
    }

    const requestOutcome = await this.readNetworkRequestOutcome(
      representative,
      request,
      findingEvents,
    );
    return {
      assignment,
      request,
      requestProgress: requestOutcome.progress,
      previousRequests,
    };
  }

  /**
   * Builds one bounded participant history item without exposing the global
   * event ledger. Guidance is included only when the check explicitly carried
   * that participant-authored event into its request.
   */
  private async toNetworkRequestHistoryItem(
    representative: Agent,
    trigger: DiscoveryEvent,
    request: DiscoveryEvent,
    findingEvents: DiscoveryEvent[],
  ): Promise<NetworkRequestHistoryItemView> {
    const outcome = await this.readNetworkRequestOutcome(
      representative,
      request,
      findingEvents,
    );
    const guidanceSequence = readMetadataSequence(
      trigger.metadata.latestGuidanceSequence,
    );

    const guidance = guidanceSequence
      ? (await this.readEventsBySequence([guidanceSequence]))[0]
      : undefined;
    return {
      trigger,
      request,
      progress: outcome.progress,
      guidance,
      linkedFindings: outcome.linkedFindings,
    };
  }

  /**
   * Projects one request outcome from transport and mailbox facts. A reply is
   * pending review until the representative's successful cursor passes it;
   * only then may absence of a linked finding become deliberate silence.
   */
  private async readNetworkRequestOutcome(
    representative: Agent,
    request: DiscoveryEvent,
    findingEvents: DiscoveryEvent[],
  ): Promise<{
    progress: NetworkRequestProgressView;
    linkedFindings: DiscoveryEvent[];
  }> {
    // One assignment/check defines one semantic request. Include any retry-era
    // duplicate writes in the same lifecycle so their delivered replies and
    // linked findings cannot produce contradictory participant-facing states.
    const requestSequences = request.replyToSequence
      ? (await this.database.orm
          .select({ sequence: discoveryEvents.sequence })
          .from(discoveryEvents)
          .where(and(
            eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
            eq(discoveryEvents.kind, 'shared_message'),
            eq(discoveryEvents.actorAgentId, representative.id),
            eq(discoveryEvents.replyToSequence, request.replyToSequence),
          ))
          .orderBy(asc(discoveryEvents.sequence)))
          .map(({ sequence }) => sequence)
      : [request.sequence];
    const requestSequenceSet = new Set(requestSequences);
    const responses = (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        inArray(discoveryEvents.kind, ['shared_message', 'direct_message']),
        ne(discoveryEvents.actorAgentId, representative.id),
        gt(discoveryEvents.sequence, request.sequence),
        inArray(discoveryEvents.replyToSequence, requestSequences),
      ))
      .orderBy(asc(discoveryEvents.sequence)))
      .map(toDiscoveryEvent);
    const originatingResponses = uniqueEvents((await Promise.all(
      responses.map(async (response) => (
        await this.findOriginatingPeerMessages(
          [response.sequence],
          representative.id,
        )
      )),
    )).flat());
    const sourceViews = await Promise.all(originatingResponses.map(
      async (response) => await this.toFindingSourceView(response),
    ));
    const originatingParticipantIds = new Set(sourceViews.flatMap(
      ({ attribution }) => {
        return attribution ? [attribution.participantId] : [];
      },
    ));

    const pendingReviewCount = responses.filter(
      ({ sequence }) => sequence > representative.lastSeenSequence,
    ).length;
    const linkedFindingFlags = await Promise.all(findingEvents.map(
      async (finding) => (
        finding.sequence > request.sequence
        && (await this.listRequestThreadOutboundMessages(
          readSequenceIds(finding.metadata.sourceEventIds),
          representative.id,
        )).some(({ sequence }) => requestSequenceSet.has(sequence))
      ),
    ));
    const linkedFindings = findingEvents.filter(
      (_finding, index) => linkedFindingFlags[index],
    );
    const phase = resolveNetworkRequestProgressPhase({
      responseCount: responses.length,
      pendingReviewCount,
      hasLinkedFinding: linkedFindings.length > 0,
    });

    const reviewedAt = phase === 'finding-reported'
      || phase === 'reviewed-without-finding'
      ? await this.findResponseReviewCompletionAt(
          representative.id,
          responses.at(-1)?.sequence,
        )
      : undefined;
    return {
      progress: {
        phase,
        responseCount: responses.length,
        pendingReviewCount,
        originatingResponseCount: originatingResponses.length,
        originatingParticipantCount: originatingParticipantIds.size,
        latestResponseAt: responses.at(-1)?.createdAt,
        reviewedAt,
      },
      linkedFindings,
    };
  }

  private async listFindingEvents(
    participantId: string,
    agentId: string,
    afterSequence: number,
  ): Promise<DiscoveryEvent[]> {
    return (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'finding_reported'),
        eq(discoveryEvents.targetParticipantId, participantId),
        eq(discoveryEvents.actorAgentId, agentId),
        gt(discoveryEvents.sequence, afterSequence),
      ))
      .orderBy(desc(discoveryEvents.sequence)))
      .map(toDiscoveryEvent);
  }

  private async findResponseReviewCompletionAt(
    agentId: string,
    latestResponseSequence?: number,
  ): Promise<string | undefined> {
    if (!latestResponseSequence) {
      return undefined;
    }

    const wakeEvents = (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.actorAgentId, agentId),
        inArray(
          discoveryEvents.kind,
          ['agent_wake_started', 'agent_wake_completed'],
        ),
        gt(discoveryEvents.sequence, latestResponseSequence),
      ))
      .orderBy(asc(discoveryEvents.sequence)))
      .map(toDiscoveryEvent);
    const horizonByWake = new Map(wakeEvents.flatMap((event) => (
      event.kind === 'agent_wake_started'
        ? [[
            event.wakeNumber,
            readMetadataSequence(event.metadata.horizonSequence),
          ] as const]
        : []
    )));
    return wakeEvents.find((event) => (
      event.kind === 'agent_wake_completed'
      && (horizonByWake.get(event.wakeNumber) ?? 0) >= latestResponseSequence
    ))?.createdAt;
  }

  private async readGuidanceFollowThrough(
    representative: Agent,
    findings: FindingView[],
  ): Promise<GuidanceFollowThroughView | undefined> {
    const [currentAssignment] = await this.database.orm
      .select({ sequence: discoveryEvents.sequence })
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'interest_saved'),
        eq(discoveryEvents.targetAgentId, representative.id),
      ))
      .orderBy(desc(discoveryEvents.sequence))
      .limit(1);
    if (!currentAssignment) {
      return undefined;
    }

    const feedbackSource = findings
      .filter(({ assignmentSequence, feedback }) => (
        assignmentSequence === currentAssignment.sequence && feedback
      ))
      .sort((left, right) => (
        right.feedback!.sequence - left.feedback!.sequence
      ))
      .at(0);
    const [directGuidanceRow] = await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'guidance_saved'),
        eq(discoveryEvents.targetAgentId, representative.id),
        gt(discoveryEvents.sequence, currentAssignment.sequence),
      ))
      .orderBy(desc(discoveryEvents.sequence))
      .limit(1);
    const directGuidance = directGuidanceRow
      ? toDiscoveryEvent(directGuidanceRow)
      : undefined;
    const guidance = [feedbackSource?.feedback, directGuidance]
      .filter((event): event is DiscoveryEvent => Boolean(event))
      .sort((left, right) => right.sequence - left.sequence)
      .at(0);
    if (!guidance) {
      return undefined;
    }

    const workingNote = (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'representative_note_updated'),
        eq(discoveryEvents.actorAgentId, representative.id),
        eq(discoveryEvents.targetParticipantId, representative.participantId),
        gt(discoveryEvents.sequence, guidance.sequence),
      ))
      .orderBy(desc(discoveryEvents.sequence)))
      .map(toDiscoveryEvent)
      .find((event) => (
        readMetadataSequence(event.metadata.throughSequence)
        >= guidance.sequence
      ));
    const check = (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.kind, 'check_requested'),
        eq(discoveryEvents.targetAgentId, representative.id),
        gt(discoveryEvents.sequence, guidance.sequence),
      ))
      .orderBy(desc(discoveryEvents.sequence)))
      .map(toDiscoveryEvent)
      .find((event) => (
        readMetadataSequence(event.metadata.latestGuidanceSequence)
        === guidance.sequence
      ));
    const [request] = check
      ? await this.database.orm
          .select()
          .from(discoveryEvents)
          .where(and(
            eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
            eq(discoveryEvents.kind, 'shared_message'),
            eq(discoveryEvents.actorAgentId, representative.id),
            eq(discoveryEvents.replyToSequence, check.sequence),
          ))
          .orderBy(asc(discoveryEvents.sequence))
          .limit(1)
      : [];
    const requestEvent = request ? toDiscoveryEvent(request) : undefined;
    const findingEvents = requestEvent
      ? await this.listFindingEvents(
          representative.participantId,
          representative.id,
          currentAssignment.sequence,
        )
      : [];
    const requestOutcome = requestEvent
      ? await this.readNetworkRequestOutcome(
          representative,
          requestEvent,
          findingEvents,
        )
      : undefined;
    const linkedFindingSequences = new Set(
      requestOutcome?.linkedFindings.map(({ sequence }) => sequence),
    );
    const resultingFinding = findings.find(({ finding }) => (
      linkedFindingSequences.has(finding.sequence)
    ));

    const priorWorkingNote = guidance.kind === 'guidance_saved'
      ? (await this.readEventsBySequence(
          guidance.replyToSequence ? [guidance.replyToSequence] : [],
        ))[0]
      : undefined;
    return {
      guidance,
      sourceFinding: guidance.kind === 'feedback_saved'
        ? feedbackSource?.finding
        : undefined,
      priorWorkingNote,
      workingNote,
      request: requestEvent,
      requestProgress: requestOutcome?.progress,
      resultingFinding,
    };
  }

  private async toFindingSourceView(
    message: DiscoveryEvent,
  ): Promise<FindingSourceView> {
    if (!message.actorAgentId) {
      return { message };
    }
    const [agentRow] = await this.database.orm
      .select()
      .from(representativeAgents)
      .where(eq(representativeAgents.id, message.actorAgentId))
      .limit(1);
    if (!agentRow) {
      return { message };
    }
    const [participantRow] = await this.database.orm
      .select()
      .from(participants)
      .where(eq(participants.id, agentRow.participantId))
      .limit(1);
    if (!participantRow) {
      return { message };
    }
    const participant = toParticipant(participantRow);
    return {
      message,
      attribution: {
        agentId: agentRow.id,
        agentName: agentRow.name,
        participantId: participant.id,
        participantDisplayName: participant.displayName,
        participantKind: participant.kind,
      },
    };
  }

  private async listRequestThreadOutboundMessages(
    sourceEventIds: number[],
    reporterAgentId?: string,
  ): Promise<DiscoveryEvent[]> {
    // Walk the reply thread backward from a finding source to reveal what its
    // representative disclosed. Content provenance is intentionally separate.
    const visited = new Set(sourceEventIds);
    const queue = await this.readEventsBySequence(sourceEventIds);
    const outboundMessages: DiscoveryEvent[] = [];

    while (queue.length) {
      const event = queue.shift()!;
      if (
        reporterAgentId
        && event.actorAgentId === reporterAgentId
        && ['shared_message', 'direct_message'].includes(event.kind)
      ) {
        outboundMessages.push(event);
      }

      const ancestorIds = event.replyToSequence
        && !visited.has(event.replyToSequence)
        ? [event.replyToSequence]
        : [];
      ancestorIds.forEach((sequence) => visited.add(sequence));
      queue.push(...await this.readEventsBySequence(ancestorIds));
    }

    return outboundMessages.sort(
      (left, right) => left.sequence - right.sequence,
    );
  }

  /**
   * Resolves the earliest peer-authored messages behind cited content. A relay
   * with upstream peer provenance therefore contributes no additional origin.
   */
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

  private async requireParticipantFinding(
    participantId: string,
    sequence: number,
  ): Promise<DiscoveryEvent> {
    const [row] = await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.sequence, sequence),
        eq(discoveryEvents.kind, 'finding_reported'),
        eq(discoveryEvents.targetParticipantId, participantId),
      ))
      .limit(1);
    if (!row) {
      throw new Error(
        `Finding not found for participant ${participantId}: ${sequence}`,
      );
    }
    return toDiscoveryEvent(row);
  }

  private async findWorkspace(): Promise<DiscoveryWorkspace | undefined> {
    const [row] = await this.database.orm
      .select()
      .from(discoveryWorkspaces)
      .where(eq(discoveryWorkspaces.id, LUCID_WORKSPACE_ID))
      .limit(1);
    return row ? toDiscoveryWorkspace(row) : undefined;
  }

  private async requireWorkspace(): Promise<DiscoveryWorkspace> {
    const workspace = await this.findWorkspace();
    if (!workspace) {
      throw new Error(
        'Discovery workspace is missing. Run the database migration and restart the service.',
      );
    }
    return workspace;
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

  private async toAgentView(
    agent: Agent,
    participant: Participant,
  ): Promise<AgentView> {
    const {
      instructions: _instructions,
      mailboxFloorSequence: _mailboxFloorSequence,
      lastSeenSequence: _lastSeenSequence,
      activeWakeId: _activeWakeId,
      activeWakeClaimToken: _activeWakeClaimToken,
      activeWakeNumber: _activeWakeNumber,
      activeWakeHorizon: _activeWakeHorizon,
      ...view
    } = agent;
    return {
      ...view,
      participant: toParticipantView(participant),
      unreadCount: (await this.listEventsVisibleToAgent(
        agent.id,
        agent.lastSeenSequence,
        10_000,
      )).length,
      isUserAgent: agent.participantId === participant.id,
    };
  }
}

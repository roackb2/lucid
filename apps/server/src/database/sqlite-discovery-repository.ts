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
  DEFAULT_AGENTS,
  DEFAULT_PARTICIPANTS,
  LOCAL_USER_ID,
  USER_AGENT_ID,
} from '../lucid/default-participants.js';
import type {
  AppendDiscoveryEventInput,
  DiscoveryRepository,
  DiscoveryRepositorySnapshot,
} from '../lucid/discovery-repository.js';
import {
  agentStatusSchema,
  discoveryEventKindSchema,
  participantKindSchema,
  type Agent,
  type AgentWakeContext,
  type DiscoveryEvent,
  type DiscoveryWorkspace,
  type FindingView,
  type Participant,
  type ParticipantView,
} from '../lucid/discovery-types.js';
import {
  discoveryEvents,
  discoveryWorkspaces,
  participants,
  representativeAgents,
} from './schema.js';
import type { LucidSqliteDatabase } from './sqlite-database.js';

const WORKSPACE_ID = 'local-discovery-workspace';
const SNAPSHOT_EVENT_LIMIT = 220;
const FINDING_LIMIT = 12;

type AgentRow = typeof representativeAgents.$inferSelect;
type DiscoveryEventRow = typeof discoveryEvents.$inferSelect;
type DiscoveryWorkspaceRow = typeof discoveryWorkspaces.$inferSelect;
type ParticipantRow = typeof participants.$inferSelect;

/**
 * SQLite/Drizzle adapter for Lucid's storage-independent discovery repository.
 * Content remains ordinary language and is never scored here.
 */
export class SqliteDiscoveryRepository implements DiscoveryRepository {
  constructor(private readonly database: LucidSqliteDatabase) {}

  async initialize(): Promise<void> {
    const workspace = this.findWorkspace();
    if (workspace) {
      this.recoverInterruptedAgentRuns(workspace);
      return;
    }
    this.createWorkspace();
  }

  async reset(): Promise<void> {
    this.database.client.transaction(() => {
      this.database.orm.delete(discoveryWorkspaces).run();
      this.database.client
        .prepare("DELETE FROM sqlite_sequence WHERE name = 'discovery_events'")
        .run();
      this.insertWorkspace();
    })();
  }

  async readWorkspace(): Promise<DiscoveryWorkspace> {
    return this.requireWorkspace();
  }

  async readSnapshot(): Promise<DiscoveryRepositorySnapshot> {
    const workspace = this.requireWorkspace();
    const [user, participantList, agentList] = await Promise.all([
      this.requireParticipant(LOCAL_USER_ID),
      this.listParticipants(),
      this.listAgents(),
    ]);
    const participantById = new Map(
      participantList.map((participant) => [participant.id, participant]),
    );
    const agents = await Promise.all(agentList.map(async (agent) => {
      const participant = participantById.get(agent.participantId);
      if (!participant) {
        throw new Error(
          `Participant ${agent.participantId} is missing for agent ${agent.id}.`,
        );
      }
      const {
        instructions: _instructions,
        lastSeenSequence: _lastSeenSequence,
        activeWakeId: _activeWakeId,
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
        isUserAgent: agent.id === USER_AGENT_ID,
      };
    }));
    const events = this.database.orm
      .select()
      .from(discoveryEvents)
      .where(eq(discoveryEvents.workspaceId, WORKSPACE_ID))
      .orderBy(desc(discoveryEvents.sequence))
      .limit(SNAPSHOT_EVENT_LIMIT)
      .all()
      .reverse()
      .map(toDiscoveryEvent);

    return {
      workspace,
      user: toParticipantView(user),
      agents,
      interest: await this.findSavedInterest(),
      findings: this.listFindings(),
      events,
    };
  }

  async listParticipants(): Promise<Participant[]> {
    return this.database.orm
      .select()
      .from(participants)
      .where(eq(participants.workspaceId, WORKSPACE_ID))
      .orderBy(asc(participants.createdAt))
      .all()
      .map(toParticipant);
  }

  async listAgents(): Promise<Agent[]> {
    return this.database.orm
      .select()
      .from(representativeAgents)
      .where(eq(representativeAgents.workspaceId, WORKSPACE_ID))
      .orderBy(asc(representativeAgents.sortOrder))
      .all()
      .map(toAgent);
  }

  async requireParticipant(id: string): Promise<Participant> {
    const row = this.database.orm
      .select()
      .from(participants)
      .where(and(
        eq(participants.workspaceId, WORKSPACE_ID),
        eq(participants.id, id),
      ))
      .get();
    if (!row) {
      throw new Error(`Participant not found: ${id}`);
    }
    return toParticipant(row);
  }

  async requireAgent(id: string): Promise<Agent> {
    const row = this.database.orm
      .select()
      .from(representativeAgents)
      .where(and(
        eq(representativeAgents.workspaceId, WORKSPACE_ID),
        eq(representativeAgents.id, id),
      ))
      .get();
    if (!row) {
      throw new Error(`Representative agent not found: ${id}`);
    }
    return toAgent(row);
  }

  async requireUserAgent(): Promise<Agent> {
    return await this.requireAgent(USER_AGENT_ID);
  }

  async findSavedInterest(): Promise<DiscoveryEvent | undefined> {
    const row = this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.kind, 'interest_saved'),
        eq(discoveryEvents.targetAgentId, USER_AGENT_ID),
        eq(discoveryEvents.targetParticipantId, LOCAL_USER_ID),
      ))
      .orderBy(desc(discoveryEvents.sequence))
      .get();
    return row ? toDiscoveryEvent(row) : undefined;
  }

  async saveInterest(content: string): Promise<DiscoveryEvent> {
    return await this.appendEvent({
      kind: 'interest_saved',
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'You update what Lucid should look for',
      content,
      metadata: {
        visibility: 'user-and-agent',
        source: 'user',
      },
    });
  }

  async saveFeedback(
    findingSequence: number,
    content: string,
  ): Promise<DiscoveryEvent> {
    const finding = this.requireUserFinding(findingSequence);
    const existing = this.database.orm
      .select({ sequence: discoveryEvents.sequence })
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.kind, 'feedback_saved'),
        eq(discoveryEvents.parentSequence, findingSequence),
      ))
      .get();
    if (existing) {
      throw new Error('Feedback has already been saved for this finding.');
    }

    return await this.appendEvent({
      kind: 'feedback_saved',
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      parentSequence: finding.sequence,
      title: 'You explain how this finding should affect future checks',
      content,
      metadata: {
        visibility: 'user-and-agent',
        findingSequence,
      },
    });
  }

  async listEventsVisibleToAgent(
    agentId: string,
    afterSequence: number,
    limit = 40,
  ): Promise<DiscoveryEvent[]> {
    return this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        gt(discoveryEvents.sequence, afterSequence),
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
            inArray(
              discoveryEvents.kind,
              ['interest_saved', 'check_requested', 'feedback_saved'],
            ),
            eq(discoveryEvents.targetAgentId, agentId),
          ),
        ),
      ))
      .orderBy(asc(discoveryEvents.sequence))
      .limit(limit)
      .all()
      .map(toDiscoveryEvent);
  }

  async readVisibleEventsBySequence(
    agentId: string,
    sequences: number[],
  ): Promise<DiscoveryEvent[]> {
    if (!sequences.length) {
      return [];
    }

    return this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        inArray(discoveryEvents.sequence, sequences),
        or(
          eq(discoveryEvents.kind, 'shared_message'),
          and(
            eq(discoveryEvents.kind, 'direct_message'),
            eq(discoveryEvents.targetAgentId, agentId),
          ),
          and(
            inArray(
              discoveryEvents.kind,
              ['interest_saved', 'check_requested', 'feedback_saved'],
            ),
            eq(discoveryEvents.targetAgentId, agentId),
          ),
        ),
      ))
      .orderBy(asc(discoveryEvents.sequence))
      .all()
      .map(toDiscoveryEvent);
  }

  async beginAgentWake(
    agentId: string,
    wakeId: string,
  ): Promise<AgentWakeContext | undefined> {
    const now = dayjs().toISOString();

    return this.database.orm.transaction((transaction) => {
      const workspaceRow = transaction
        .select()
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
        .get();
      if (!workspaceRow) {
        throw new Error(
          'Discovery workspace is missing. Run the database migration and restart the service.',
        );
      }

      const agentRow = transaction
        .select()
        .from(representativeAgents)
        .where(and(
          eq(representativeAgents.workspaceId, WORKSPACE_ID),
          eq(representativeAgents.id, agentId),
        ))
        .get();
      if (!agentRow) {
        throw new Error(`Representative agent not found: ${agentId}`);
      }
      const selectedAgent = toAgent(agentRow);
      if (selectedAgent.status === 'running') {
        throw new Error(`Representative agent is already running: ${agentId}`);
      }

      const participantRow = transaction
        .select()
        .from(participants)
        .where(and(
          eq(participants.workspaceId, WORKSPACE_ID),
          eq(participants.id, selectedAgent.participantId),
        ))
        .get();
      if (!participantRow) {
        throw new Error(`Participant not found: ${selectedAgent.participantId}`);
      }

      const resumingWake = Boolean(
        selectedAgent.activeWakeId
        && selectedAgent.activeWakeNumber !== undefined
        && selectedAgent.activeWakeHorizon !== undefined
        && selectedAgent.activeWakeHorizon > selectedAgent.lastSeenSequence,
      );
      const visibleEventConditions = [
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        gt(discoveryEvents.sequence, selectedAgent.lastSeenSequence),
        ...(resumingWake
          ? [lte(
              discoveryEvents.sequence,
              selectedAgent.activeWakeHorizon!,
            )]
          : []),
        or(
          and(
            eq(discoveryEvents.kind, 'shared_message'),
            ne(discoveryEvents.actorAgentId, selectedAgent.id),
          ),
          and(
            eq(discoveryEvents.kind, 'direct_message'),
            eq(discoveryEvents.targetAgentId, selectedAgent.id),
          ),
          and(
            inArray(
              discoveryEvents.kind,
              ['interest_saved', 'check_requested', 'feedback_saved'],
            ),
            eq(discoveryEvents.targetAgentId, selectedAgent.id),
          ),
        ),
      ];
      const visibleEvents = transaction
        .select()
        .from(discoveryEvents)
        .where(and(...visibleEventConditions))
        .orderBy(asc(discoveryEvents.sequence))
        .limit(40)
        .all()
        .map(toDiscoveryEvent);
      if (!visibleEvents.length) {
        if (selectedAgent.activeWakeId) {
          transaction
            .update(representativeAgents)
            .set({
              activeWakeId: null,
              activeWakeNumber: null,
              activeWakeHorizon: null,
              updatedAt: now,
            })
            .where(eq(representativeAgents.id, selectedAgent.id))
            .run();
        }
        return undefined;
      }

      const activeWakeId = resumingWake
        ? selectedAgent.activeWakeId!
        : wakeId;
      const horizonSequence = resumingWake
        ? selectedAgent.activeWakeHorizon!
        : visibleEvents.at(-1)!.sequence;
      const wakeNumber = resumingWake
        ? selectedAgent.activeWakeNumber!
        : workspaceRow.currentWake + 1;

      if (!resumingWake) {
        transaction
          .update(discoveryWorkspaces)
          .set({ currentWake: wakeNumber, updatedAt: now })
          .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
          .run();
      }
      transaction
        .update(representativeAgents)
        .set({
          status: 'running',
          runCount: selectedAgent.runCount + 1,
          activeWakeId,
          activeWakeNumber: wakeNumber,
          activeWakeHorizon: horizonSequence,
          lastRunAt: now,
          updatedAt: now,
        })
        .where(eq(representativeAgents.id, selectedAgent.id))
        .run();
      if (!resumingWake) {
        transaction
          .insert(discoveryEvents)
          .values({
            id: `event_${randomUUID()}`,
            workspaceId: WORKSPACE_ID,
            wakeNumber,
            kind: 'agent_wake_started',
            actorAgentId: selectedAgent.id,
            idempotencyKey: `${activeWakeId}:started`,
            title: `${selectedAgent.name} wakes for new messages`,
            content: `${visibleEvents.length} unread ${
              visibleEvents.length === 1 ? 'event is' : 'events are'
            } available during this wake.`,
            metadata: {
              visibility: 'operator',
              visibleEventSequences: visibleEvents.map(
                (event) => event.sequence,
              ),
              horizonSequence,
              wakeId: activeWakeId,
            },
            createdAt: now,
          })
          .run();
      }
      return {
        agent: {
          ...selectedAgent,
          status: 'running',
          runCount: selectedAgent.runCount + 1,
          activeWakeId,
          activeWakeNumber: wakeNumber,
          activeWakeHorizon: horizonSequence,
          lastRunAt: now,
          updatedAt: now,
        },
        participant: toParticipant(participantRow),
        wakeId: activeWakeId,
        wakeNumber,
        visibleEvents,
        horizonSequence,
      };
    });
  }

  async completeAgentWake(
    agentId: string,
    horizonSequence: number,
  ): Promise<void> {
    const agent = await this.requireAgent(agentId);
    this.database.orm
      .update(representativeAgents)
      .set({
        status: 'idle',
        lastSeenSequence: Math.max(agent.lastSeenSequence, horizonSequence),
        activeWakeId: null,
        activeWakeNumber: null,
        activeWakeHorizon: null,
        updatedAt: dayjs().toISOString(),
      })
      .where(eq(representativeAgents.id, agentId))
      .run();
  }

  async failAgentWake(agentId: string): Promise<void> {
    this.database.orm
      .update(representativeAgents)
      .set({ status: 'error', updatedAt: dayjs().toISOString() })
      .where(eq(representativeAgents.id, agentId))
      .run();
  }

  async interruptAgentWake(agentId: string): Promise<void> {
    this.database.orm
      .update(representativeAgents)
      .set({ status: 'idle', updatedAt: dayjs().toISOString() })
      .where(eq(representativeAgents.id, agentId))
      .run();
  }

  async hasFindingUsingAnySource(sourceEventIds: number[]): Promise<boolean> {
    if (!sourceEventIds.length) {
      return false;
    }
    const requested = new Set(sourceEventIds);
    return this.database.orm
      .select({ metadata: discoveryEvents.metadata })
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.kind, 'finding_reported'),
        eq(discoveryEvents.targetParticipantId, LOCAL_USER_ID),
      ))
      .all()
      .some(({ metadata }) => (
        readSequenceIds(metadata?.sourceEventIds)
          .some((sequence) => requested.has(sequence))
      ));
  }

  async hasAgentContributedToCausalThread(
    agentId: string,
    sourceEventIds: number[],
    currentWakeId: string,
  ): Promise<boolean> {
    const sourceRoots = this.findCausalRootSequences(sourceEventIds);
    if (!sourceRoots.size) {
      return false;
    }

    return this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.actorAgentId, agentId),
        inArray(
          discoveryEvents.kind,
          ['shared_message', 'direct_message'],
        ),
      ))
      .all()
      .map(toDiscoveryEvent)
      .filter((event) => event.metadata.wakeId !== currentWakeId)
      .some((event) => [...this.findCausalRootSequences([event.sequence])]
        .some((root) => sourceRoots.has(root)));
  }

  async appendEvent(
    input: AppendDiscoveryEventInput,
  ): Promise<DiscoveryEvent> {
    if (input.idempotencyKey) {
      const existing = this.database.orm
        .select()
        .from(discoveryEvents)
        .where(and(
          eq(discoveryEvents.workspaceId, WORKSPACE_ID),
          eq(discoveryEvents.idempotencyKey, input.idempotencyKey),
        ))
        .get();
      if (existing) {
        return toDiscoveryEvent(existing);
      }
    }

    const workspace = this.requireWorkspace();
    const row = this.database.orm
      .insert(discoveryEvents)
      .values({
        id: `event_${randomUUID()}`,
        workspaceId: WORKSPACE_ID,
        wakeNumber: input.wakeNumber ?? workspace.currentWake,
        kind: input.kind,
        actorAgentId: input.actorAgentId,
        targetAgentId: input.targetAgentId,
        targetParticipantId: input.targetParticipantId,
        parentSequence: input.parentSequence,
        idempotencyKey: input.idempotencyKey,
        title: input.title,
        content: input.content,
        metadata: input.metadata ?? {},
        createdAt: dayjs().toISOString(),
      })
      .returning()
      .get();

    return toDiscoveryEvent(row);
  }

  private listFindings(): FindingView[] {
    return this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.kind, 'finding_reported'),
        eq(discoveryEvents.targetParticipantId, LOCAL_USER_ID),
      ))
      .orderBy(desc(discoveryEvents.sequence))
      .limit(FINDING_LIMIT)
      .all()
      .map(toDiscoveryEvent)
      .map((finding) => {
        const sourceEventIds = readSequenceIds(finding.metadata.sourceEventIds);
        const feedbackRow = this.database.orm
          .select()
          .from(discoveryEvents)
          .where(and(
            eq(discoveryEvents.workspaceId, WORKSPACE_ID),
            eq(discoveryEvents.kind, 'feedback_saved'),
            eq(discoveryEvents.parentSequence, finding.sequence),
          ))
          .orderBy(desc(discoveryEvents.sequence))
          .get();

        return {
          finding,
          sources: this.readEventsBySequence(sourceEventIds),
          outboundMessages: this.listCausalOutboundMessages(sourceEventIds),
          feedback: feedbackRow ? toDiscoveryEvent(feedbackRow) : undefined,
        };
      });
  }

  private listCausalOutboundMessages(sourceEventIds: number[]): DiscoveryEvent[] {
    const visited = new Set(sourceEventIds);
    const queue = this.readEventsBySequence(sourceEventIds);
    const outboundMessages: DiscoveryEvent[] = [];

    while (queue.length) {
      const event = queue.shift()!;
      if (
        event.actorAgentId === USER_AGENT_ID
        && ['shared_message', 'direct_message'].includes(event.kind)
      ) {
        outboundMessages.push(event);
      }

      const ancestorIds = [
        ...readSequenceIds(event.metadata.sourceEventIds),
        ...(event.parentSequence ? [event.parentSequence] : []),
      ].filter((sequence) => !visited.has(sequence));
      ancestorIds.forEach((sequence) => visited.add(sequence));
      queue.push(...this.readEventsBySequence(ancestorIds));
    }

    return outboundMessages.sort(
      (left, right) => left.sequence - right.sequence,
    );
  }

  private findCausalRootSequences(sequences: number[]): Set<number> {
    const roots = new Set<number>();
    const visited = new Set<number>();
    const queue = [...sequences];

    while (queue.length) {
      const sequence = queue.shift()!;
      if (visited.has(sequence)) {
        continue;
      }
      visited.add(sequence);

      const event = this.readEventsBySequence([sequence])[0];
      if (!event) {
        continue;
      }
      const ancestors = [
        ...readSequenceIds(event.metadata.sourceEventIds),
        ...(event.parentSequence ? [event.parentSequence] : []),
      ];
      if (!ancestors.length) {
        roots.add(event.sequence);
        continue;
      }
      queue.push(...ancestors);
    }

    return roots;
  }

  private readEventsBySequence(sequences: number[]): DiscoveryEvent[] {
    if (!sequences.length) {
      return [];
    }
    return this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        inArray(discoveryEvents.sequence, sequences),
      ))
      .orderBy(asc(discoveryEvents.sequence))
      .all()
      .map(toDiscoveryEvent);
  }

  private requireUserFinding(sequence: number): DiscoveryEvent {
    const row = this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.sequence, sequence),
        eq(discoveryEvents.kind, 'finding_reported'),
        eq(discoveryEvents.targetParticipantId, LOCAL_USER_ID),
      ))
      .get();
    if (!row) {
      throw new Error(`Finding not found for the local user: ${sequence}`);
    }
    return toDiscoveryEvent(row);
  }

  private findWorkspace(): DiscoveryWorkspace | undefined {
    const row = this.database.orm
      .select()
      .from(discoveryWorkspaces)
      .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
      .get();
    return row ? toDiscoveryWorkspace(row) : undefined;
  }

  private requireWorkspace(): DiscoveryWorkspace {
    const workspace = this.findWorkspace();
    if (!workspace) {
      throw new Error(
        'Discovery workspace is missing. Run the database migration and restart the service.',
      );
    }
    return workspace;
  }

  private createWorkspace(): void {
    this.database.client.transaction(() => {
      this.insertWorkspace();
    })();
  }

  private insertWorkspace(): void {
    const now = dayjs().toISOString();
    const versionId = randomUUID();

    this.database.orm.insert(discoveryWorkspaces).values({
      id: WORKSPACE_ID,
      versionId,
      currentWake: 0,
      createdAt: now,
      updatedAt: now,
    }).run();
    this.database.orm.insert(participants).values(
      DEFAULT_PARTICIPANTS.map((participant) => ({
        ...participant,
        workspaceId: WORKSPACE_ID,
        createdAt: now,
        updatedAt: now,
      })),
    ).run();
    this.database.orm.insert(representativeAgents).values(
      DEFAULT_AGENTS.map((agent) => ({
        ...agent,
        workspaceId: WORKSPACE_ID,
        status: 'idle',
        runCount: 0,
        lastSeenSequence: 0,
        createdAt: now,
        updatedAt: now,
      })),
    ).run();
    this.database.orm.insert(discoveryEvents).values({
      id: `event_${randomUUID()}`,
      workspaceId: WORKSPACE_ID,
      wakeNumber: 0,
      kind: 'workspace_created',
      title: 'Discovery workspace created',
      content:
        'The local user is represented by Lucid. Two simulated participants are available as test data; their private context is not directly visible to the user agent.',
      metadata: {
        versionId,
        visibility: 'shared',
        source: 'system',
      },
      createdAt: now,
    }).run();
  }

  private recoverInterruptedAgentRuns(workspace: DiscoveryWorkspace): void {
    const interrupted = this.database.orm
      .select()
      .from(representativeAgents)
      .where(and(
        eq(representativeAgents.workspaceId, WORKSPACE_ID),
        eq(representativeAgents.status, 'running'),
      ))
      .all();
    if (!interrupted.length) {
      return;
    }

    const now = dayjs().toISOString();
    this.database.orm.transaction((transaction) => {
      transaction
        .update(representativeAgents)
        .set({ status: 'idle', updatedAt: now })
        .where(and(
          eq(representativeAgents.workspaceId, WORKSPACE_ID),
          eq(representativeAgents.status, 'running'),
        ))
        .run();
      transaction.insert(discoveryEvents).values({
        id: `event_${randomUUID()}`,
        workspaceId: WORKSPACE_ID,
        wakeNumber: workspace.currentWake,
        kind: 'error',
        title: 'Interrupted agent wakes recovered',
        content:
          `${interrupted.map((agent) => agent.name).join(', ')} ${
            interrupted.length === 1 ? 'was' : 'were'
          } running when the host stopped. Unread events remain available for a later check.`,
        metadata: {
          visibility: 'operator',
          recoveredAgentIds: interrupted.map((agent) => agent.id),
        },
        createdAt: now,
      }).run();
    });
  }
}

function toAgent(row: AgentRow): Agent {
  return {
    ...row,
    status: agentStatusSchema.parse(row.status),
    activeWakeId: row.activeWakeId ?? undefined,
    activeWakeNumber: row.activeWakeNumber ?? undefined,
    activeWakeHorizon: row.activeWakeHorizon ?? undefined,
    lastRunAt: row.lastRunAt ?? undefined,
  };
}

function toParticipant(row: ParticipantRow): Participant {
  return {
    ...row,
    kind: participantKindSchema.parse(row.kind),
  };
}

function toParticipantView(participant: Participant): ParticipantView {
  const { privateContext: _privateContext, ...view } = participant;
  return view;
}

function toDiscoveryEvent(row: DiscoveryEventRow): DiscoveryEvent {
  return {
    ...row,
    kind: discoveryEventKindSchema.parse(row.kind),
    actorAgentId: row.actorAgentId ?? undefined,
    targetAgentId: row.targetAgentId ?? undefined,
    targetParticipantId: row.targetParticipantId ?? undefined,
    parentSequence: row.parentSequence ?? undefined,
    idempotencyKey: row.idempotencyKey ?? undefined,
    metadata: row.metadata ?? {},
  };
}

function toDiscoveryWorkspace(
  row: DiscoveryWorkspaceRow,
): DiscoveryWorkspace {
  return { ...row };
}

function readSequenceIds(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => Number.isInteger(item) && item > 0)
    : [];
}

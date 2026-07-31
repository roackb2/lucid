import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
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
  type AgentStepContext,
  type DiscoveryEvent,
  type DiscoveryRunPhase,
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
        conversationId: _conversationId,
        lastSeenSequence: _lastSeenSequence,
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
          eq(discoveryEvents.kind, 'workspace_created'),
          and(
            eq(discoveryEvents.kind, 'shared_message'),
            ne(discoveryEvents.actorAgentId, agentId),
          ),
          and(
            eq(discoveryEvents.kind, 'direct_message'),
            eq(discoveryEvents.targetAgentId, agentId),
          ),
          and(
            inArray(discoveryEvents.kind, ['interest_saved', 'feedback_saved']),
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
          eq(discoveryEvents.kind, 'workspace_created'),
          eq(discoveryEvents.kind, 'shared_message'),
          and(
            eq(discoveryEvents.kind, 'direct_message'),
            eq(discoveryEvents.targetAgentId, agentId),
          ),
          and(
            inArray(discoveryEvents.kind, ['interest_saved', 'feedback_saved']),
            eq(discoveryEvents.targetAgentId, agentId),
          ),
        ),
      ))
      .orderBy(asc(discoveryEvents.sequence))
      .all()
      .map(toDiscoveryEvent);
  }

  async beginAgentStep(
    agentId: string,
    discoveryRunId: string,
    phase: DiscoveryRunPhase,
  ): Promise<AgentStepContext> {
    const workspace = this.requireWorkspace();
    const selectedAgent = await this.requireAgent(agentId);
    const participant = await this.requireParticipant(selectedAgent.participantId);
    const visibleEvents = await this.listEventsVisibleToAgent(
      selectedAgent.id,
      selectedAgent.lastSeenSequence,
    );
    const horizonSequence = visibleEvents.at(-1)?.sequence
      ?? selectedAgent.lastSeenSequence;
    const stepNumber = workspace.currentStep + 1;
    const now = dayjs().toISOString();

    this.database.orm.transaction((transaction) => {
      transaction
        .update(discoveryWorkspaces)
        .set({ currentStep: stepNumber, updatedAt: now })
        .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
        .run();
      transaction
        .update(representativeAgents)
        .set({
          status: 'running',
          runCount: selectedAgent.runCount + 1,
          lastRunAt: now,
          updatedAt: now,
        })
        .where(eq(representativeAgents.id, selectedAgent.id))
        .run();
      transaction
        .insert(discoveryEvents)
        .values({
          id: `event_${randomUUID()}`,
          workspaceId: WORKSPACE_ID,
          stepNumber,
          kind: 'agent_step_started',
          actorAgentId: selectedAgent.id,
          title: `${selectedAgent.name} starts a discovery step`,
          content: visibleEvents.length
            ? `${visibleEvents.length} unread ${
                visibleEvents.length === 1 ? 'event is' : 'events are'
              } available during the ${phase} phase.`
            : `The ${phase} phase starts without unread events.`,
          metadata: {
            visibility: 'operator',
            visibleEventSequences: visibleEvents.map((event) => event.sequence),
            horizonSequence,
            discoveryRunId,
            phase,
          },
          createdAt: now,
        })
        .run();
    });

    return {
      agent: {
        ...selectedAgent,
        status: 'running',
        runCount: selectedAgent.runCount + 1,
        lastRunAt: now,
        updatedAt: now,
      },
      participant,
      phase,
      discoveryRunId,
      stepNumber,
      visibleEvents,
      horizonSequence,
    };
  }

  async completeAgentStep(
    agentId: string,
    horizonSequence: number,
  ): Promise<void> {
    const agent = await this.requireAgent(agentId);
    this.database.orm
      .update(representativeAgents)
      .set({
        status: 'idle',
        lastSeenSequence: Math.max(agent.lastSeenSequence, horizonSequence),
        updatedAt: dayjs().toISOString(),
      })
      .where(eq(representativeAgents.id, agentId))
      .run();
  }

  async failAgentStep(agentId: string): Promise<void> {
    this.database.orm
      .update(representativeAgents)
      .set({ status: 'error', updatedAt: dayjs().toISOString() })
      .where(eq(representativeAgents.id, agentId))
      .run();
  }

  async interruptAgentStep(agentId: string): Promise<void> {
    this.database.orm
      .update(representativeAgents)
      .set({ status: 'idle', updatedAt: dayjs().toISOString() })
      .where(eq(representativeAgents.id, agentId))
      .run();
  }

  async hasFindingForRun(discoveryRunId: string): Promise<boolean> {
    return Boolean(this.findFindingForRun(discoveryRunId));
  }

  async ensureNoFindingResult(
    discoveryRunId: string,
    stepNumber: number,
  ): Promise<DiscoveryEvent> {
    const existing = this.findFindingForRun(discoveryRunId);
    if (existing) {
      return existing;
    }

    return await this.appendEvent({
      stepNumber,
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'No relevant match found',
      content:
        'This check did not find a specific match worth reporting. Lucid kept the result quiet instead of manufacturing a recommendation.',
      metadata: {
        visibility: 'user',
        discoveryRunId,
        noMatch: true,
        sourceEventIds: [],
      },
    });
  }

  async appendEvent(
    input: AppendDiscoveryEventInput,
  ): Promise<DiscoveryEvent> {
    const workspace = this.requireWorkspace();
    const row = this.database.orm
      .insert(discoveryEvents)
      .values({
        id: `event_${randomUUID()}`,
        workspaceId: WORKSPACE_ID,
        stepNumber: input.stepNumber ?? workspace.currentStep,
        kind: input.kind,
        actorAgentId: input.actorAgentId,
        targetAgentId: input.targetAgentId,
        targetParticipantId: input.targetParticipantId,
        parentSequence: input.parentSequence,
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
        const discoveryRunId = readString(finding.metadata.discoveryRunId);
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
          outboundMessages: discoveryRunId
            ? this.listRunOutboundMessages(discoveryRunId)
            : [],
          feedback: feedbackRow ? toDiscoveryEvent(feedbackRow) : undefined,
          noMatch: finding.metadata.noMatch === true,
        };
      });
  }

  private listRunOutboundMessages(discoveryRunId: string): DiscoveryEvent[] {
    return this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.actorAgentId, USER_AGENT_ID),
        inArray(discoveryEvents.kind, ['shared_message', 'direct_message']),
      ))
      .orderBy(asc(discoveryEvents.sequence))
      .all()
      .map(toDiscoveryEvent)
      .filter((event) => event.metadata.discoveryRunId === discoveryRunId);
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

  private findFindingForRun(discoveryRunId: string): DiscoveryEvent | undefined {
    const row = this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.kind, 'finding_reported'),
        eq(discoveryEvents.targetParticipantId, LOCAL_USER_ID),
      ))
      .orderBy(desc(discoveryEvents.sequence))
      .all()
      .find((candidate) => (
        candidate.metadata?.discoveryRunId === discoveryRunId
      ));
    return row ? toDiscoveryEvent(row) : undefined;
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
      currentStep: 0,
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
        conversationId: `agent_${agent.id}_${versionId}`,
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
      stepNumber: 0,
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
        stepNumber: workspace.currentStep,
        kind: 'error',
        title: 'Interrupted agent steps recovered',
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

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

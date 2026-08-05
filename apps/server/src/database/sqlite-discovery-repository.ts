/**
 * SQLite/Drizzle implementation of Lucid's durable discovery-state boundary.
 *
 * Besides persistence, this adapter owns the atomic invariants that depend on
 * storage: participant-agent lifecycle changes, append-only mailbox ordering,
 * visibility floors, fixed wake claims, cursor advancement, and idempotent
 * events. Scheduling, model execution, and HTTP concerns do not belong here.
 */
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
  LOCAL_PARTICIPANT,
  LOCAL_REPRESENTATIVE,
  LOCAL_USER_ID,
  USER_AGENT_ID,
} from '../lucid/local-participant.js';
import { createRepresentativeProfile } from '../lucid/representative-profile.js';
import type {
  AppendDiscoveryEventInput,
  DiscoveryRepository,
  DiscoveryRepositorySnapshot,
  NetworkDiagnosticsRepositorySnapshot,
  ParticipantWithAgent,
} from '../lucid/discovery-repository.js';
import {
  agentStatusSchema,
  discoveryEventKindSchema,
  participantKindSchema,
  participantStatusSchema,
  type Agent,
  type AgentView,
  type AgentWakeContext,
  type DiscoveryEvent,
  type DiscoveryWorkspace,
  type FindingView,
  type FindingSourceView,
  type Participant,
  type ParticipantStatus,
  type ParticipantView,
  type RegisterParticipantInput,
  type RepresentativeWorkingContext,
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
const PRINCIPAL_INPUT_LIMIT = 6;

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

  async reset(options: { backgroundChecksEnabled: boolean }): Promise<void> {
    this.database.client.transaction(() => {
      this.database.orm.delete(discoveryWorkspaces).run();
      this.database.client
        .prepare("DELETE FROM sqlite_sequence WHERE name = 'discovery_events'")
        .run();
      this.insertWorkspace(options.backgroundChecksEnabled);
    })();
  }

  async readWorkspace(): Promise<DiscoveryWorkspace> {
    return this.requireWorkspace();
  }

  async setBackgroundChecksEnabled(
    enabled: boolean,
  ): Promise<DiscoveryWorkspace> {
    this.database.orm
      .update(discoveryWorkspaces)
      .set({
        backgroundChecksEnabled: enabled,
        updatedAt: dayjs().toISOString(),
      })
      .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
      .run();
    return this.requireWorkspace();
  }

  async readSnapshot(): Promise<DiscoveryRepositorySnapshot> {
    const workspace = this.requireWorkspace();
    const [user, representative] = await Promise.all([
      this.requireParticipant(LOCAL_USER_ID),
      this.requireUserAgent(),
    ]);
    const workingContext = await this.readRepresentativeWorkingContext(
      representative.id,
      Number.MAX_SAFE_INTEGER,
    );
    return {
      workspace,
      user: toParticipantView(user),
      representative: await this.toAgentView(representative, user),
      interest: await this.findSavedInterest(),
      workingNote: workingContext.workingNote,
      findings: workingContext.findings,
    };
  }

  async readNetworkDiagnostics(): Promise<NetworkDiagnosticsRepositorySnapshot> {
    const workspace = this.requireWorkspace();
    const [participantList, agentList] = await Promise.all([
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
      return await this.toAgentView(agent, participant);
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
      participants: participantList.map(toParticipantView),
      agents,
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

  async requireAgentByParticipantId(participantId: string): Promise<Agent> {
    const row = this.database.orm
      .select()
      .from(representativeAgents)
      .where(and(
        eq(representativeAgents.workspaceId, WORKSPACE_ID),
        eq(representativeAgents.participantId, participantId),
      ))
      .get();
    if (!row) {
      throw new Error(
        `Representative agent not found for participant: ${participantId}`,
      );
    }
    return toAgent(row);
  }

  async requireUserAgent(): Promise<Agent> {
    return await this.requireAgent(USER_AGENT_ID);
  }

  async registerParticipant(
    input: RegisterParticipantInput,
  ): Promise<ParticipantWithAgent> {
    // Validate and normalize trusted ingress before opening the transaction so
    // a malformed simulator or future client cannot leave partial identity.
    const registrationKey = input.registrationKey.trim();
    const displayName = input.displayName.trim();
    const privateContext = input.privateContext.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,119}$/.test(registrationKey)) {
      throw new Error(
        'Registration key must contain 1 to 120 letters, numbers, dots, colons, underscores, or hyphens.',
      );
    }
    if (input.kind === 'human' && !input.contextApproved) {
      throw new Error(
        'Confirm that the participant knowingly allowed this context to be used.',
      );
    }
    if (!displayName || displayName.length > 80) {
      throw new Error('Participant name must contain 1 to 80 characters.');
    }
    if (!privateContext || privateContext.length > 4_000) {
      throw new Error('Participant context must contain 1 to 4,000 characters.');
    }

    const existingRow = this.database.orm
      .select()
      .from(participants)
      .where(and(
        eq(participants.workspaceId, WORKSPACE_ID),
        eq(participants.registrationKey, registrationKey),
      ))
      .get();
    if (existingRow) {
      const participant = toParticipant(existingRow);
      if (
        participant.kind !== input.kind
        || participant.displayName !== displayName
        || participant.privateContext !== privateContext
      ) {
        throw new Error(
          `Registration key ${registrationKey} already belongs to a different participant profile.`,
        );
      }
      return {
        participant,
        agent: await this.requireAgentByParticipantId(participant.id),
        created: false,
      };
    }

    const now = dayjs().toISOString();
    const participantId = `participant_${randomUUID()}`;
    const agentId = `agent_${randomUUID()}`;

    return this.database.orm.transaction((transaction) => {
      const workspace = transaction
        .select()
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
        .get();
      if (!workspace) {
        throw new Error('Discovery workspace is missing.');
      }
      const lastAgent = transaction
        .select({ sortOrder: representativeAgents.sortOrder })
        .from(representativeAgents)
        .where(eq(representativeAgents.workspaceId, WORKSPACE_ID))
        .orderBy(desc(representativeAgents.sortOrder))
        .get();
      const latestEvent = transaction
        .select({ sequence: discoveryEvents.sequence })
        .from(discoveryEvents)
        .where(eq(discoveryEvents.workspaceId, WORKSPACE_ID))
        .orderBy(desc(discoveryEvents.sequence))
        .get();
      // Participant, representative, initial mailbox floor, and audit event are
      // one unit. The current tail prevents a new source from reading old mail.
      const profile = createRepresentativeProfile({
        id: agentId,
        participantId,
        displayName,
        kind: input.kind,
        sortOrder: (lastAgent?.sortOrder ?? 0) + 1,
      });
      const participantRow = transaction
        .insert(participants)
        .values({
          id: participantId,
          workspaceId: WORKSPACE_ID,
          registrationKey,
          kind: input.kind,
          status: 'active',
          displayName,
          privateContext,
          contextConsentAt: input.kind === 'human' ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      const agentRow = transaction
        .insert(representativeAgents)
        .values({
          ...profile,
          workspaceId: WORKSPACE_ID,
          status: 'idle',
          runCount: 0,
          mailboxFloorSequence: latestEvent?.sequence ?? 0,
          lastSeenSequence: latestEvent?.sequence ?? 0,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      transaction.insert(discoveryEvents).values({
        id: `event_${randomUUID()}`,
        workspaceId: WORKSPACE_ID,
        wakeNumber: workspace.currentWake,
        kind: 'participant_added',
        targetAgentId: agentId,
        targetParticipantId: participantId,
        title: `${displayName} joins the participant network`,
        content:
          'Trusted ingress registered private context and created one representative agent. The context itself is not included in this event.',
        metadata: {
          visibility: 'operator',
          participantId,
          agentId,
          participantKind: input.kind,
          contextConsentAt: input.kind === 'human' ? now : undefined,
        },
        createdAt: now,
      }).run();

      return {
        participant: toParticipant(participantRow),
        agent: toAgent(agentRow),
        created: true,
      };
    });
  }

  async setParticipantStatus(
    participantId: string,
    status: Extract<ParticipantStatus, 'active' | 'disabled'>,
  ): Promise<ParticipantWithAgent> {
    this.assertManageableParticipant(participantId);
    const now = dayjs().toISOString();

    return this.database.orm.transaction((transaction) => {
      const workspace = transaction
        .select()
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
        .get();
      if (!workspace) {
        throw new Error('Discovery workspace is missing.');
      }
      const participantRow = transaction
        .select()
        .from(participants)
        .where(and(
          eq(participants.workspaceId, WORKSPACE_ID),
          eq(participants.id, participantId),
        ))
        .get();
      if (!participantRow) {
        throw new Error(`Participant not found: ${participantId}`);
      }
      const participant = toParticipant(participantRow);
      if (participant.status === 'retired') {
        throw new Error('A retired participant cannot be re-enabled.');
      }
      const agentRow = transaction
        .select()
        .from(representativeAgents)
        .where(eq(representativeAgents.participantId, participantId))
        .get();
      if (!agentRow) {
        throw new Error(
          `Representative agent not found for participant: ${participantId}`,
        );
      }
      if (participant.status === status) {
        return { participant, agent: toAgent(agentRow) };
      }

      // Resuming accepts only messages created after this transaction. Pausing
      // preserves the existing floor because task shutdown already prevents reads.
      const latestEvent = transaction
        .select({ sequence: discoveryEvents.sequence })
        .from(discoveryEvents)
        .where(eq(discoveryEvents.workspaceId, WORKSPACE_ID))
        .orderBy(desc(discoveryEvents.sequence))
        .get();
      const updatedParticipantRow = transaction
        .update(participants)
        .set({ status, updatedAt: now })
        .where(eq(participants.id, participantId))
        .returning()
        .get();
      const updatedAgentRow = transaction
        .update(representativeAgents)
        .set({
          status: 'idle',
          mailboxFloorSequence: status === 'active'
            ? latestEvent?.sequence ?? agentRow.mailboxFloorSequence
            : agentRow.mailboxFloorSequence,
          lastSeenSequence: status === 'active'
            ? latestEvent?.sequence ?? agentRow.lastSeenSequence
            : agentRow.lastSeenSequence,
          activeWakeId: null,
          activeWakeNumber: null,
          activeWakeHorizon: null,
          updatedAt: now,
        })
        .where(eq(representativeAgents.id, agentRow.id))
        .returning()
        .get();
      // Persist lifecycle state and its operator audit record atomically.
      transaction.insert(discoveryEvents).values({
        id: `event_${randomUUID()}`,
        workspaceId: WORKSPACE_ID,
        wakeNumber: workspace.currentWake,
        kind: status === 'active'
          ? 'participant_enabled'
          : 'participant_disabled',
        targetAgentId: agentRow.id,
        targetParticipantId: participantId,
        title: `${participant.displayName} is ${status}`,
        content: status === 'active'
          ? 'The representative can receive new messages and run background checks again.'
          : 'The representative is paused and will not receive messages created while disabled.',
        metadata: {
          visibility: 'operator',
          participantId,
          agentId: agentRow.id,
          status,
        },
        createdAt: now,
      }).run();

      return {
        participant: toParticipant(updatedParticipantRow),
        agent: toAgent(updatedAgentRow),
      };
    });
  }

  async retireParticipant(
    participantId: string,
  ): Promise<ParticipantWithAgent> {
    this.assertManageableParticipant(participantId);
    const now = dayjs().toISOString();

    return this.database.orm.transaction((transaction) => {
      const workspace = transaction
        .select()
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
        .get();
      if (!workspace) {
        throw new Error('Discovery workspace is missing.');
      }
      const participantRow = transaction
        .select()
        .from(participants)
        .where(and(
          eq(participants.workspaceId, WORKSPACE_ID),
          eq(participants.id, participantId),
        ))
        .get();
      if (!participantRow) {
        throw new Error(`Participant not found: ${participantId}`);
      }
      const participant = toParticipant(participantRow);
      const agentRow = transaction
        .select()
        .from(representativeAgents)
        .where(eq(representativeAgents.participantId, participantId))
        .get();
      if (!agentRow) {
        throw new Error(
          `Representative agent not found for participant: ${participantId}`,
        );
      }
      if (participant.status === 'retired') {
        return { participant, agent: toAgent(agentRow) };
      }
      const latestEvent = transaction
        .select({ sequence: discoveryEvents.sequence })
        .from(discoveryEvents)
        .where(eq(discoveryEvents.workspaceId, WORKSPACE_ID))
        .orderBy(desc(discoveryEvents.sequence))
        .get();
      // Retirement is irreversible in this workspace generation: scrub private
      // context in the same transaction that closes the mailbox and records it.
      const updatedParticipantRow = transaction
        .update(participants)
        .set({
          status: 'retired',
          privateContext: '',
          updatedAt: now,
        })
        .where(eq(participants.id, participantId))
        .returning()
        .get();
      const updatedAgentRow = transaction
        .update(representativeAgents)
        .set({
          status: 'idle',
          mailboxFloorSequence:
            latestEvent?.sequence ?? agentRow.mailboxFloorSequence,
          lastSeenSequence: latestEvent?.sequence ?? agentRow.lastSeenSequence,
          activeWakeId: null,
          activeWakeNumber: null,
          activeWakeHorizon: null,
          updatedAt: now,
        })
        .where(eq(representativeAgents.id, agentRow.id))
        .returning()
        .get();
      transaction.insert(discoveryEvents).values({
        id: `event_${randomUUID()}`,
        workspaceId: WORKSPACE_ID,
        wakeNumber: workspace.currentWake,
        kind: 'participant_retired',
        targetAgentId: agentRow.id,
        targetParticipantId: participantId,
        title: `${participant.displayName} is retired`,
        content:
          'Private context was removed from future use. Historical message attribution remains available for the operator audit trail.',
        metadata: {
          visibility: 'operator',
          participantId,
          agentId: agentRow.id,
          status: 'retired',
          privateContextRemoved: true,
        },
        createdAt: now,
      }).run();

      return {
        participant: toParticipant(updatedParticipantRow),
        agent: toAgent(updatedAgentRow),
      };
    });
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

  async saveParticipantInput(
    participantId: string,
    content: string,
    idempotencyKey: string,
  ): Promise<DiscoveryEvent> {
    const participant = await this.requireParticipant(participantId);
    if (participant.status !== 'active') {
      throw new Error(
        `Participant input requires an active participant: ${participantId}`,
      );
    }
    const agent = await this.requireAgentByParticipantId(participantId);
    const normalizedContent = content.trim();
    if (!normalizedContent || normalizedContent.length > 1_600) {
      throw new Error('Participant input must contain 1 to 1,600 characters.');
    }
    const normalizedIdempotencyKey = idempotencyKey.trim();
    if (
      !normalizedIdempotencyKey
      || normalizedIdempotencyKey.length > 160
    ) {
      throw new Error('Input idempotency key must contain 1 to 160 characters.');
    }

    return await this.appendEvent({
      kind: 'participant_input',
      targetAgentId: agent.id,
      targetParticipantId: participant.id,
      idempotencyKey: normalizedIdempotencyKey,
      title: `${participant.displayName} provides new private input`,
      content: normalizedContent,
      metadata: {
        visibility: 'participant-and-agent',
        source: participant.kind === 'synthetic'
          ? 'network-simulator'
          : 'participant',
        participantKind: participant.kind,
      },
    });
  }

  async saveFeedback(
    participantId: string,
    findingSequence: number,
    content: string,
  ): Promise<DiscoveryEvent> {
    const finding = this.requireParticipantFinding(
      participantId,
      findingSequence,
    );
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
      targetAgentId: (await this.requireAgentByParticipantId(participantId)).id,
      targetParticipantId: participantId,
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
    throughSequence?: number,
  ): Promise<DiscoveryEvent[]> {
    const agent = this.findActiveAgent(agentId);
    if (!agent) {
      return [];
    }
    // The caller may request older history, but it can never bypass the join or
    // resume floor established for this participant.
    const visibleAfterSequence = Math.max(
      afterSequence,
      agent.mailboxFloorSequence,
    );
    return this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
            inArray(
              discoveryEvents.kind,
              [
                'interest_saved',
                'participant_input',
                'check_requested',
                'feedback_saved',
              ],
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
    const agent = this.findActiveAgent(agentId);
    if (!sequences.length || !agent) {
      return [];
    }

    return this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
            inArray(
              discoveryEvents.kind,
              [
                'interest_saved',
                'participant_input',
                'check_requested',
                'feedback_saved',
              ],
            ),
            eq(discoveryEvents.targetAgentId, agentId),
          ),
        ),
      ))
      .orderBy(asc(discoveryEvents.sequence))
      .all()
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
    return {
      principalInputs: this.listPrincipalInputs(
        agent,
        boundedSequence,
      ),
      findings: this.listFindings(
        agent.participantId,
        boundedSequence,
      ),
      workingNote: this.findWorkingNote(
        agent,
        boundedSequence,
      ),
    };
  }

  async beginAgentWake(
    agentId: string,
    wakeId: string,
  ): Promise<AgentWakeContext | undefined> {
    const now = dayjs().toISOString();

    // Selection, horizon assignment, agent ownership, and the audit event must
    // commit together; otherwise two schedulers could consume different views.
    const claim = this.database.orm.transaction((transaction) => {
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
      if (toParticipant(participantRow).status !== 'active') {
        return undefined;
      }

      // An interrupted/failed wake retains its identity and fixed upper bound.
      // New mail arriving during the retry is deliberately deferred.
      const resumingWake = Boolean(
        selectedAgent.activeWakeId
        && selectedAgent.activeWakeNumber !== undefined
        && selectedAgent.activeWakeHorizon !== undefined
        && selectedAgent.activeWakeHorizon > selectedAgent.lastSeenSequence,
      );
      const visibleEventConditions = [
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        gt(
          discoveryEvents.sequence,
          Math.max(
            selectedAgent.lastSeenSequence,
            selectedAgent.mailboxFloorSequence,
          ),
        ),
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
              [
                'interest_saved',
                'participant_input',
                'check_requested',
                'feedback_saved',
              ],
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
        // A stale claim can become empty after cursor recovery. Clear only claim
        // metadata; never advance the cursor when no event was consumed.
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

      // Fresh claims take the current visible tail as their immutable horizon;
      // retries reuse every identifier required for event idempotency.
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
          status: 'running' as const,
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
    if (!claim) {
      return undefined;
    }

    return {
      ...claim,
      workingContext: await this.readRepresentativeWorkingContext(
        agentId,
        claim.horizonSequence,
      ),
    };
  }

  async completeAgentWake(
    agentId: string,
    horizonSequence: number,
  ): Promise<void> {
    // This is the sole wake-settlement operation that consumes claimed mail.
    // Failure and interruption leave both the cursor and active claim retryable.
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

  async hasParticipantFindingUsingAnySource(
    participantId: string,
    sourceEventIds: number[],
  ): Promise<boolean> {
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
        eq(discoveryEvents.targetParticipantId, participantId),
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
      // Tool and wake retries reuse deterministic keys, so an already committed
      // side effect is returned rather than appended a second time.
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

  private listPrincipalInputs(
    agent: Agent,
    throughSequence: number,
  ): DiscoveryEvent[] {
    const latestInterest = this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.kind, 'interest_saved'),
        eq(discoveryEvents.targetAgentId, agent.id),
        eq(discoveryEvents.targetParticipantId, agent.participantId),
        lte(discoveryEvents.sequence, throughSequence),
      ))
      .orderBy(desc(discoveryEvents.sequence))
      .get();
    const recentParticipantInputs = this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.kind, 'participant_input'),
        eq(discoveryEvents.targetAgentId, agent.id),
        eq(discoveryEvents.targetParticipantId, agent.participantId),
        lte(discoveryEvents.sequence, throughSequence),
      ))
      .orderBy(desc(discoveryEvents.sequence))
      .limit(PRINCIPAL_INPUT_LIMIT)
      .all()
      .reverse();

    return [
      ...(latestInterest ? [toDiscoveryEvent(latestInterest)] : []),
      ...recentParticipantInputs.map(toDiscoveryEvent),
    ].sort((left, right) => left.sequence - right.sequence);
  }

  private findWorkingNote(
    agent: Agent,
    throughSequence: number,
  ): DiscoveryEvent | undefined {
    const row = this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.kind, 'representative_note_updated'),
        eq(discoveryEvents.actorAgentId, agent.id),
        eq(discoveryEvents.targetAgentId, agent.id),
        eq(discoveryEvents.targetParticipantId, agent.participantId),
        lte(discoveryEvents.sequence, throughSequence),
      ))
      .orderBy(desc(discoveryEvents.sequence))
      .get();
    return row ? toDiscoveryEvent(row) : undefined;
  }

  private listFindings(
    participantId: string,
    throughSequence = Number.MAX_SAFE_INTEGER,
  ): FindingView[] {
    return this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.kind, 'finding_reported'),
        eq(discoveryEvents.targetParticipantId, participantId),
        lte(discoveryEvents.sequence, throughSequence),
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
            lte(discoveryEvents.sequence, throughSequence),
          ))
          .orderBy(desc(discoveryEvents.sequence))
          .get();

        return {
          finding,
          sources: this.readEventsBySequence(sourceEventIds)
            .map((source) => this.toFindingSourceView(source)),
          outboundMessages: this.listCausalOutboundMessages(
            sourceEventIds,
            finding.actorAgentId,
          ),
          feedback: feedbackRow ? toDiscoveryEvent(feedbackRow) : undefined,
          noMatch: finding.metadata.noMatch === true,
        };
      });
  }

  private toFindingSourceView(message: DiscoveryEvent): FindingSourceView {
    if (!message.actorAgentId) {
      return { message };
    }
    const agentRow = this.database.orm
      .select()
      .from(representativeAgents)
      .where(eq(representativeAgents.id, message.actorAgentId))
      .get();
    if (!agentRow) {
      return { message };
    }
    const participantRow = this.database.orm
      .select()
      .from(participants)
      .where(eq(participants.id, agentRow.participantId))
      .get();
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

  private listCausalOutboundMessages(
    sourceEventIds: number[],
    reporterAgentId?: string,
  ): DiscoveryEvent[] {
    // Walk provenance backward from a finding to reveal what its representative
    // disclosed without projecting unrelated network traffic.
    const visited = new Set(sourceEventIds);
    const queue = this.readEventsBySequence(sourceEventIds);
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
    // Causal roots let the host enforce one contribution per user-initiated
    // thread even when agents cite intermediate direct or shared messages.
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

  private requireParticipantFinding(
    participantId: string,
    sequence: number,
  ): DiscoveryEvent {
    const row = this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.sequence, sequence),
        eq(discoveryEvents.kind, 'finding_reported'),
        eq(discoveryEvents.targetParticipantId, participantId),
      ))
      .get();
    if (!row) {
      throw new Error(
        `Finding not found for participant ${participantId}: ${sequence}`,
      );
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

  private insertWorkspace(backgroundChecksEnabled = true): void {
    const now = dayjs().toISOString();
    const versionId = randomUUID();

    this.database.orm.insert(discoveryWorkspaces).values({
      id: WORKSPACE_ID,
      versionId,
      currentWake: 0,
      backgroundChecksEnabled,
      createdAt: now,
      updatedAt: now,
    }).run();
    this.database.orm.insert(participants).values({
      ...LOCAL_PARTICIPANT,
      workspaceId: WORKSPACE_ID,
      createdAt: now,
      updatedAt: now,
    }).run();
    this.database.orm.insert(representativeAgents).values({
      ...LOCAL_REPRESENTATIVE,
      workspaceId: WORKSPACE_ID,
      status: 'idle',
      runCount: 0,
      mailboxFloorSequence: 0,
      lastSeenSequence: 0,
      createdAt: now,
      updatedAt: now,
    }).run();
    this.database.orm.insert(discoveryEvents).values({
      id: `event_${randomUUID()}`,
      workspaceId: WORKSPACE_ID,
      wakeNumber: 0,
      kind: 'workspace_created',
      title: 'Discovery workspace created',
      content:
        'The local participant is represented by Lucid. Other participants enter through the network ingress rather than product defaults.',
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

  private findActiveAgent(agentId: string): Agent | undefined {
    const row = this.database.orm
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
        eq(representativeAgents.workspaceId, WORKSPACE_ID),
        eq(representativeAgents.id, agentId),
      ))
      .get();
    return row?.participantStatus === 'active'
      ? toAgent(row.agent)
      : undefined;
  }

  private assertManageableParticipant(participantId: string): void {
    if (participantId === LOCAL_USER_ID) {
      throw new Error('The local user participant cannot be disabled or retired.');
    }
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
    registrationKey: row.registrationKey ?? undefined,
    kind: participantKindSchema.parse(row.kind),
    status: participantStatusSchema.parse(row.status),
    contextConsentAt: row.contextConsentAt ?? undefined,
  };
}

function toParticipantView(participant: Participant): ParticipantView {
  const {
    privateContext: _privateContext,
    registrationKey: _registrationKey,
    ...view
  } = participant;
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

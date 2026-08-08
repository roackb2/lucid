/**
 * PostgreSQL/Drizzle implementation of Lucid's durable discovery-state boundary.
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
  sql,
} from 'drizzle-orm';
import {
  LOCAL_PARTICIPANT,
  LOCAL_REPRESENTATIVE,
  LOCAL_USER_ID,
  USER_AGENT_ID,
} from '../../local-participant.js';
import { createRepresentativeProfile } from '../../representative-profile.js';
import type {
  NetworkDiagnosticsRepositorySnapshot,
  ParticipantWithAgent,
  ParticipantNetworkRepository,
} from '../../network/repository.js';
import type {
  AgentCommunicationRepository,
} from '../../representative/communication/repository.js';
import type {
  RepresentativeWakeRepository,
} from '../../representative/repository.js';
import type {
  DiscoveryWorkspaceRepository,
  DiscoveryWorkspaceRepositorySnapshot,
} from '../../workspace/repository.js';
import {
  agentStatusSchema,
  type AppendDiscoveryEventInput,
  discoveryEventKindSchema,
  participantKindSchema,
  participantStatusSchema,
  type Agent,
  type AgentView,
  type AgentWakeContext,
  type DiscoveryEvent,
  type DiscoveryEventKind,
  type DiscoveryWorkspace,
  type GuidanceFollowThroughView,
  type FindingView,
  type FindingSourceView,
  type NetworkActivityView,
  type NetworkRequestHistoryItemView,
  type NetworkRequestProgressPhase,
  type NetworkRequestProgressView,
  type Participant,
  type ParticipantStatus,
  type ParticipantView,
  type RegisterParticipantInput,
  type RepresentativeWorkingContext,
} from '../../discovery-types.js';
import {
  postgresDiscoveryEvents as discoveryEvents,
  postgresDiscoveryWorkspaces as discoveryWorkspaces,
  postgresParticipants as participants,
  postgresRepresentativeAgents as representativeAgents,
} from './schema.js';
import type { PostgresDatabase } from '../../../infrastructure/postgres/database.js';

const WORKSPACE_ID = 'local-discovery-workspace';
const SNAPSHOT_EVENT_LIMIT = 220;
const FINDING_LIMIT = 12;
const NETWORK_REQUEST_HISTORY_LIMIT = 5;
const PRINCIPAL_INPUT_LIMIT = 6;
const AGENT_PRINCIPAL_EVENT_KINDS: DiscoveryEventKind[] = [
  'interest_saved',
  'participant_input',
  'check_requested',
  'feedback_saved',
  'guidance_saved',
];

type AgentRow = typeof representativeAgents.$inferSelect;
type DiscoveryEventRow = typeof discoveryEvents.$inferSelect;
type DiscoveryWorkspaceRow = typeof discoveryWorkspaces.$inferSelect;
type ParticipantRow = typeof participants.$inferSelect;
type LucidPostgresTransaction = Parameters<
  Parameters<PostgresDatabase['orm']['transaction']>[0]
>[0];

/**
 * PostgreSQL/Drizzle adapter for Lucid's service-owned persistence ports.
 * Content remains ordinary language and is never scored here.
 */
export class PostgresLucidRepository implements
  DiscoveryWorkspaceRepository,
  ParticipantNetworkRepository,
  RepresentativeWakeRepository,
  AgentCommunicationRepository {
  constructor(private readonly database: PostgresDatabase) {}

  async initialize(): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${WORKSPACE_ID}))`,
      );
      const [workspace] = await transaction
        .select({ id: discoveryWorkspaces.id })
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
        .limit(1);
      if (!workspace) {
        await this.insertWorkspace(transaction);
      }
    });
  }

  async reset(options: { backgroundChecksEnabled: boolean }): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${WORKSPACE_ID}))`,
      );
      await transaction.execute(
        sql`truncate table lucid.discovery_workspaces restart identity cascade`,
      );
      await this.insertWorkspace(
        transaction,
        options.backgroundChecksEnabled,
      );
    });
  }

  async readWorkspace(): Promise<DiscoveryWorkspace> {
    return await this.requireWorkspace();
  }

  async setBackgroundChecksEnabled(
    enabled: boolean,
  ): Promise<DiscoveryWorkspace> {
    await this.database.orm
      .update(discoveryWorkspaces)
      .set({
        backgroundChecksEnabled: enabled,
        updatedAt: dayjs().toISOString(),
      })
      .where(eq(discoveryWorkspaces.id, WORKSPACE_ID));
    return await this.requireWorkspace();
  }

  async readSnapshot(): Promise<DiscoveryWorkspaceRepositorySnapshot> {
    const workspace = await this.requireWorkspace();
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
      networkActivity: await this.readNetworkActivity(representative),
      guidanceFollowThrough: await this.readGuidanceFollowThrough(
        representative,
        workingContext.findings,
      ),
      findings: workingContext.findings,
    };
  }

  async readNetworkDiagnostics(): Promise<NetworkDiagnosticsRepositorySnapshot> {
    const workspace = await this.requireWorkspace();
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
    const events = (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(eq(discoveryEvents.workspaceId, WORKSPACE_ID))
      .orderBy(desc(discoveryEvents.sequence))
      .limit(SNAPSHOT_EVENT_LIMIT))
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
    return (await this.database.orm
      .select()
      .from(participants)
      .where(eq(participants.workspaceId, WORKSPACE_ID))
      .orderBy(asc(participants.createdAt)))
      .map(toParticipant);
  }

  async listAgents(): Promise<Agent[]> {
    return (await this.database.orm
      .select()
      .from(representativeAgents)
      .where(eq(representativeAgents.workspaceId, WORKSPACE_ID))
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

  async requireParticipant(id: string): Promise<Participant> {
    const [row] = await this.database.orm
      .select()
      .from(participants)
      .where(and(
        eq(participants.workspaceId, WORKSPACE_ID),
        eq(participants.id, id),
      ))
      .limit(1);
    if (!row) {
      throw new Error(`Participant not found: ${id}`);
    }
    return toParticipant(row);
  }

  async requireAgent(id: string): Promise<Agent> {
    const [row] = await this.database.orm
      .select()
      .from(representativeAgents)
      .where(and(
        eq(representativeAgents.workspaceId, WORKSPACE_ID),
        eq(representativeAgents.id, id),
      ))
      .limit(1);
    if (!row) {
      throw new Error(`Representative agent not found: ${id}`);
    }
    return toAgent(row);
  }

  async requireAgentByParticipantId(participantId: string): Promise<Agent> {
    const [row] = await this.database.orm
      .select()
      .from(representativeAgents)
      .where(and(
        eq(representativeAgents.workspaceId, WORKSPACE_ID),
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

    const now = dayjs().toISOString();
    const participantId = `participant_${randomUUID()}`;
    const agentId = `agent_${randomUUID()}`;

    return await this.database.orm.transaction(async (transaction) => {
      // Serialize one stable registration identity across API instances. This
      // makes participant + representative creation one idempotent unit rather
      // than relying on a pre-insert existence check.
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${registrationKey}))`,
      );
      const [existingRow] = await transaction
        .select()
        .from(participants)
        .where(and(
          eq(participants.workspaceId, WORKSPACE_ID),
          eq(participants.registrationKey, registrationKey),
        ))
        .limit(1);
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
        const [existingAgent] = await transaction
          .select()
          .from(representativeAgents)
          .where(eq(representativeAgents.participantId, participant.id))
          .limit(1);
        if (!existingAgent) {
          throw new Error(
            `Representative agent not found for participant: ${participant.id}`,
          );
        }
        return {
          participant,
          agent: toAgent(existingAgent),
          created: false,
        };
      }

      const [workspace] = await transaction
        .select()
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
        .for('update')
        .limit(1);
      if (!workspace) {
        throw new Error('Discovery workspace is missing.');
      }
      const [lastAgent] = await transaction
        .select({ sortOrder: representativeAgents.sortOrder })
        .from(representativeAgents)
        .where(eq(representativeAgents.workspaceId, WORKSPACE_ID))
        .orderBy(desc(representativeAgents.sortOrder))
        .limit(1);
      const [latestEvent] = await transaction
        .select({ sequence: discoveryEvents.sequence })
        .from(discoveryEvents)
        .where(eq(discoveryEvents.workspaceId, WORKSPACE_ID))
        .orderBy(desc(discoveryEvents.sequence))
        .limit(1);
      // Participant, representative, initial mailbox floor, and audit event are
      // one unit. The current tail prevents a new source from reading old mail.
      const profile = createRepresentativeProfile({
        id: agentId,
        participantId,
        displayName,
        kind: input.kind,
        sortOrder: (lastAgent?.sortOrder ?? 0) + 1,
      });
      const [participantRow] = await transaction
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
        .returning();
      const [agentRow] = await transaction
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
        .returning();
      await transaction.insert(discoveryEvents).values({
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
      });

      if (!participantRow || !agentRow) {
        throw new Error('PostgreSQL did not return the created participant.');
      }

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

    return await this.database.orm.transaction(async (transaction) => {
      const [workspace] = await transaction
        .select()
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
        .for('update')
        .limit(1);
      if (!workspace) {
        throw new Error('Discovery workspace is missing.');
      }
      const [participantRow] = await transaction
        .select()
        .from(participants)
        .where(and(
          eq(participants.workspaceId, WORKSPACE_ID),
          eq(participants.id, participantId),
        ))
        .for('update')
        .limit(1);
      if (!participantRow) {
        throw new Error(`Participant not found: ${participantId}`);
      }
      const participant = toParticipant(participantRow);
      if (participant.status === 'retired') {
        throw new Error('A retired participant cannot be re-enabled.');
      }
      const [agentRow] = await transaction
        .select()
        .from(representativeAgents)
        .where(eq(representativeAgents.participantId, participantId))
        .for('update')
        .limit(1);
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
      const [latestEvent] = await transaction
        .select({ sequence: discoveryEvents.sequence })
        .from(discoveryEvents)
        .where(eq(discoveryEvents.workspaceId, WORKSPACE_ID))
        .orderBy(desc(discoveryEvents.sequence))
        .limit(1);
      const [updatedParticipantRow] = await transaction
        .update(participants)
        .set({ status, updatedAt: now })
        .where(eq(participants.id, participantId))
        .returning();
      const [updatedAgentRow] = await transaction
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
          activeWakeClaimToken: null,
          activeWakeNumber: null,
          activeWakeHorizon: null,
          updatedAt: now,
        })
        .where(eq(representativeAgents.id, agentRow.id))
        .returning();
      // Persist lifecycle state and its operator audit record atomically.
      await transaction.insert(discoveryEvents).values({
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
      });

      if (!updatedParticipantRow || !updatedAgentRow) {
        throw new Error('Participant lifecycle update did not persist.');
      }

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

    return await this.database.orm.transaction(async (transaction) => {
      const [workspace] = await transaction
        .select()
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
        .for('update')
        .limit(1);
      if (!workspace) {
        throw new Error('Discovery workspace is missing.');
      }
      const [participantRow] = await transaction
        .select()
        .from(participants)
        .where(and(
          eq(participants.workspaceId, WORKSPACE_ID),
          eq(participants.id, participantId),
        ))
        .for('update')
        .limit(1);
      if (!participantRow) {
        throw new Error(`Participant not found: ${participantId}`);
      }
      const participant = toParticipant(participantRow);
      const [agentRow] = await transaction
        .select()
        .from(representativeAgents)
        .where(eq(representativeAgents.participantId, participantId))
        .for('update')
        .limit(1);
      if (!agentRow) {
        throw new Error(
          `Representative agent not found for participant: ${participantId}`,
        );
      }
      if (participant.status === 'retired') {
        return { participant, agent: toAgent(agentRow) };
      }
      const [latestEvent] = await transaction
        .select({ sequence: discoveryEvents.sequence })
        .from(discoveryEvents)
        .where(eq(discoveryEvents.workspaceId, WORKSPACE_ID))
        .orderBy(desc(discoveryEvents.sequence))
        .limit(1);
      // Retirement is irreversible in this workspace generation: scrub private
      // context in the same transaction that closes the mailbox and records it.
      const [updatedParticipantRow] = await transaction
        .update(participants)
        .set({
          status: 'retired',
          privateContext: '',
          updatedAt: now,
        })
        .where(eq(participants.id, participantId))
        .returning();
      const [updatedAgentRow] = await transaction
        .update(representativeAgents)
        .set({
          status: 'idle',
          mailboxFloorSequence:
            latestEvent?.sequence ?? agentRow.mailboxFloorSequence,
          lastSeenSequence: latestEvent?.sequence ?? agentRow.lastSeenSequence,
          activeWakeId: null,
          activeWakeClaimToken: null,
          activeWakeNumber: null,
          activeWakeHorizon: null,
          updatedAt: now,
        })
        .where(eq(representativeAgents.id, agentRow.id))
        .returning();
      await transaction.insert(discoveryEvents).values({
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
      });

      if (!updatedParticipantRow || !updatedAgentRow) {
        throw new Error('Participant retirement did not persist.');
      }

      return {
        participant: toParticipant(updatedParticipantRow),
        agent: toAgent(updatedAgentRow),
      };
    });
  }

  async findSavedInterest(): Promise<DiscoveryEvent | undefined> {
    const [row] = await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.kind, 'interest_saved'),
        eq(discoveryEvents.targetAgentId, USER_AGENT_ID),
        eq(discoveryEvents.targetParticipantId, LOCAL_USER_ID),
      ))
      .orderBy(desc(discoveryEvents.sequence))
      .limit(1);
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
    const finding = await this.requireParticipantFinding(
      participantId,
      findingSequence,
    );
    const [existing] = await this.database.orm
      .select({ sequence: discoveryEvents.sequence })
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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

  async saveGuidance(content: string): Promise<DiscoveryEvent> {
    const normalizedContent = content.trim();
    if (!normalizedContent || normalizedContent.length > 1_600) {
      throw new Error('Guidance must contain 1 to 1,600 characters.');
    }
    const [interest, representative] = await Promise.all([
      this.findSavedInterest(),
      this.requireUserAgent(),
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
            inArray(discoveryEvents.kind, AGENT_PRINCIPAL_EVENT_KINDS),
            eq(discoveryEvents.targetAgentId, agentId),
          ),
        ),
      ))
      .orderBy(asc(discoveryEvents.sequence)))
      .map(toDiscoveryEvent);
  }

  async readEvent(sequence: number): Promise<DiscoveryEvent | undefined> {
    return (await this.readEventsBySequence([sequence]))[0];
  }

  async listAgentWakeCommunicationEvents(
    agentId: string,
    wakeNumber: number,
  ): Promise<DiscoveryEvent[]> {
    return (await this.database.orm
      .select()
      .from(discoveryEvents)
      .where(and(
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
        eq(discoveryEvents.actorAgentId, agentId),
        eq(discoveryEvents.wakeNumber, wakeNumber),
        inArray(discoveryEvents.kind, ['shared_message', 'direct_message']),
      ))
      .orderBy(asc(discoveryEvents.sequence)))
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

  async beginAgentWake(
    agentId: string,
    wakeId: string,
  ): Promise<AgentWakeContext | undefined> {
    const now = dayjs().toISOString();

    // Selection, horizon assignment, agent ownership, and the audit event must
    // commit together; otherwise two schedulers could consume different views.
    const claim = await this.database.orm.transaction(async (transaction) => {
      const [workspaceRow] = await transaction
        .select()
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
        .for('update')
        .limit(1);
      if (!workspaceRow) {
        throw new Error(
          'Discovery workspace is missing. Run the database migration and restart the service.',
        );
      }

      const [agentRow] = await transaction
        .select()
        .from(representativeAgents)
        .where(and(
          eq(representativeAgents.workspaceId, WORKSPACE_ID),
          eq(representativeAgents.id, agentId),
        ))
        .for('update')
        .limit(1);
      if (!agentRow) {
        throw new Error(`Representative agent not found: ${agentId}`);
      }
      const selectedAgent = toAgent(agentRow);
      if (selectedAgent.status === 'running') {
        throw new Error(`Representative agent is already running: ${agentId}`);
      }

      const [participantRow] = await transaction
        .select()
        .from(participants)
        .where(and(
          eq(participants.workspaceId, WORKSPACE_ID),
          eq(participants.id, selectedAgent.participantId),
        ))
        .limit(1);
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
            inArray(discoveryEvents.kind, AGENT_PRINCIPAL_EVENT_KINDS),
            eq(discoveryEvents.targetAgentId, selectedAgent.id),
          ),
        ),
      ];
      const visibleEvents = (await transaction
        .select()
        .from(discoveryEvents)
        .where(and(...visibleEventConditions))
        .orderBy(asc(discoveryEvents.sequence))
        .limit(40))
        .map(toDiscoveryEvent);
      if (!visibleEvents.length) {
        // A stale claim can become empty after cursor recovery. Clear only claim
        // metadata; never advance the cursor when no event was consumed.
        if (selectedAgent.activeWakeId) {
          await transaction
            .update(representativeAgents)
            .set({
              activeWakeId: null,
              activeWakeClaimToken: null,
              activeWakeNumber: null,
              activeWakeHorizon: null,
              updatedAt: now,
            })
            .where(eq(representativeAgents.id, selectedAgent.id));
        }
        return undefined;
      }

      // Fresh claims take the current visible tail as their immutable horizon;
      // retries reuse every identifier required for event idempotency.
      const activeWakeId = resumingWake
        ? selectedAgent.activeWakeId!
        : wakeId;
      // The wake ID remains stable for idempotent effects; every retry gets a
      // new ownership token so a late worker cannot settle a newer attempt.
      const claimToken = wakeId;
      const horizonSequence = resumingWake
        ? selectedAgent.activeWakeHorizon!
        : visibleEvents.at(-1)!.sequence;
      const wakeNumber = resumingWake
        ? selectedAgent.activeWakeNumber!
        : workspaceRow.currentWake + 1;

      if (!resumingWake) {
        await transaction
          .update(discoveryWorkspaces)
          .set({ currentWake: wakeNumber, updatedAt: now })
          .where(eq(discoveryWorkspaces.id, WORKSPACE_ID));
      }
      await transaction
        .update(representativeAgents)
        .set({
          status: 'running',
          runCount: selectedAgent.runCount + 1,
          activeWakeId,
          activeWakeClaimToken: claimToken,
          activeWakeNumber: wakeNumber,
          activeWakeHorizon: horizonSequence,
          lastRunAt: now,
          updatedAt: now,
        })
        .where(eq(representativeAgents.id, selectedAgent.id));
      if (!resumingWake) {
        await transaction
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
          });
      }
      return {
        agent: {
          ...selectedAgent,
          status: 'running' as const,
          runCount: selectedAgent.runCount + 1,
          activeWakeId,
          activeWakeClaimToken: claimToken,
          activeWakeNumber: wakeNumber,
          activeWakeHorizon: horizonSequence,
          lastRunAt: now,
          updatedAt: now,
        },
        participant: toParticipant(participantRow),
        wakeId: activeWakeId,
        claimToken,
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
    claimToken: string,
    horizonSequence: number,
  ): Promise<void> {
    // This is the sole wake-settlement operation that consumes claimed mail.
    // Failure and interruption leave both the cursor and active claim retryable.
    const agent = await this.requireAgent(agentId);
    const updated = await this.database.orm
      .update(representativeAgents)
      .set({
        status: 'idle',
        lastSeenSequence: Math.max(agent.lastSeenSequence, horizonSequence),
        activeWakeId: null,
        activeWakeClaimToken: null,
        activeWakeNumber: null,
        activeWakeHorizon: null,
        updatedAt: dayjs().toISOString(),
      })
      .where(and(
        eq(representativeAgents.id, agentId),
        eq(representativeAgents.status, 'running'),
        eq(representativeAgents.activeWakeClaimToken, claimToken),
        eq(representativeAgents.activeWakeHorizon, horizonSequence),
      ))
      .returning({ id: representativeAgents.id });
    if (!updated.length) {
      throw new Error(
        `Wake claim is no longer owned by representative agent: ${agentId}`,
      );
    }
  }

  async failAgentWake(agentId: string, claimToken: string): Promise<void> {
    const updated = await this.database.orm
      .update(representativeAgents)
      .set({ status: 'error', updatedAt: dayjs().toISOString() })
      .where(and(
        eq(representativeAgents.id, agentId),
        eq(representativeAgents.status, 'running'),
        eq(representativeAgents.activeWakeClaimToken, claimToken),
      ))
      .returning({ id: representativeAgents.id });
    if (!updated.length) {
      throw new Error(
        `Wake claim is no longer owned by representative agent: ${agentId}`,
      );
    }
  }

  async interruptAgentWake(agentId: string, claimToken: string): Promise<void> {
    const updated = await this.database.orm
      .update(representativeAgents)
      .set({ status: 'idle', updatedAt: dayjs().toISOString() })
      .where(and(
        eq(representativeAgents.id, agentId),
        eq(representativeAgents.status, 'running'),
        eq(representativeAgents.activeWakeClaimToken, claimToken),
      ))
      .returning({ id: representativeAgents.id });
    if (!updated.length) {
      throw new Error(
        `Wake claim is no longer owned by representative agent: ${agentId}`,
      );
    }
  }

  async recoverInterruptedAgentWake(
    agentId: string,
    interruptedExecutionId: string,
  ): Promise<boolean> {
    const now = dayjs().toISOString();
    return await this.database.orm.transaction(async (transaction) => {
      const [agentRow] = await transaction
        .select()
        .from(representativeAgents)
        .where(and(
          eq(representativeAgents.workspaceId, WORKSPACE_ID),
          eq(representativeAgents.id, agentId),
        ))
        .for('update')
        .limit(1);
      if (
        !agentRow
        || agentRow.status !== 'running'
        || agentRow.activeWakeClaimToken !== interruptedExecutionId
      ) {
        return false;
      }

      await transaction
        .update(representativeAgents)
        .set({ status: 'idle', updatedAt: now })
        .where(eq(representativeAgents.id, agentId));
      await transaction.insert(discoveryEvents).values({
        id: `event_${randomUUID()}`,
        workspaceId: WORKSPACE_ID,
        wakeNumber: agentRow.activeWakeNumber ?? 0,
        kind: 'error',
        actorAgentId: agentId,
        idempotencyKey:
          `${agentRow.activeWakeId ?? agentId}:recovered:${interruptedExecutionId}`,
        title: 'Interrupted representative wake recovered',
        content:
          'The prior execution lease expired. Its unread mailbox horizon remains available for a fenced retry.',
        metadata: {
          visibility: 'operator',
          wakeId: agentRow.activeWakeId,
          interruptedExecutionId,
        },
        createdAt: now,
      });
      return true;
    });
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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

  async appendEvent(
    input: AppendDiscoveryEventInput,
  ): Promise<DiscoveryEvent> {
    return await this.database.orm.transaction(async (transaction) => {
      // The unique key is the final concurrency authority. `onConflictDoNothing`
      // allows simultaneous retries from different workers without surfacing a
      // transient constraint error or duplicating the side effect.
      const [workspace] = await transaction
        .select({ currentWake: discoveryWorkspaces.currentWake })
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
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
          workspaceId: WORKSPACE_ID,
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
          eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
          eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
            eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
            eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
            eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
            eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
        eq(discoveryEvents.workspaceId, WORKSPACE_ID),
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
      .where(eq(discoveryWorkspaces.id, WORKSPACE_ID))
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

  private async insertWorkspace(
    transaction: LucidPostgresTransaction,
    backgroundChecksEnabled = true,
  ): Promise<void> {
    const now = dayjs().toISOString();
    const versionId = randomUUID();

    await transaction.insert(discoveryWorkspaces).values({
      id: WORKSPACE_ID,
      versionId,
      currentWake: 0,
      backgroundChecksEnabled,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.insert(participants).values({
      ...LOCAL_PARTICIPANT,
      workspaceId: WORKSPACE_ID,
      // The local user knowingly operates this workspace, so its seed record
      // satisfies the same consent invariant required of other human ingress.
      contextConsentAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.insert(representativeAgents).values({
      ...LOCAL_REPRESENTATIVE,
      workspaceId: WORKSPACE_ID,
      status: 'idle',
      runCount: 0,
      mailboxFloorSequence: 0,
      lastSeenSequence: 0,
      createdAt: now,
      updatedAt: now,
    });
    await transaction.insert(discoveryEvents).values({
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
    });
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
        eq(representativeAgents.workspaceId, WORKSPACE_ID),
        eq(representativeAgents.id, agentId),
      ))
      .limit(1);
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
      isUserAgent: agent.id === USER_AGENT_ID,
    };
  }
}

function toAgent(row: AgentRow): Agent {
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
    replyToSequence: row.replyToSequence ?? undefined,
    idempotencyKey: row.idempotencyKey ?? undefined,
    metadata: row.metadata ?? {},
  };
}

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

function uniqueEvents(events: DiscoveryEvent[]): DiscoveryEvent[] {
  return [...new Map(events.map((event) => [event.sequence, event])).values()]
    .sort((left, right) => left.sequence - right.sequence);
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

function readMetadataSequence(value: unknown): number {
  return Number.isInteger(value) && Number(value) > 0
    ? Number(value)
    : 0;
}

/** PostgreSQL adapter for trusted participant-network administration. */
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
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import type {
  Agent,
  AgentView,
  AppendDiscoveryEventInput,
  DiscoveryEvent,
  DiscoveryWorkspace,
  Participant,
  ParticipantStatus,
  RegisterParticipantInput,
} from '../discovery-types.js';
import {
  LOCAL_USER_ID,
  USER_AGENT_ID,
} from '../local-participant.js';
import {
  toAgent,
  toDiscoveryEvent,
  toDiscoveryWorkspace,
  toParticipant,
} from '../persistence/postgres/records.js';
import {
  postgresDiscoveryEvents as discoveryEvents,
  postgresDiscoveryWorkspaces as discoveryWorkspaces,
  postgresParticipants as participants,
  postgresRepresentativeAgents as representativeAgents,
} from '../persistence/postgres/schema.js';
import { createRepresentativeProfile } from '../representative-profile.js';
import { AGENT_PRINCIPAL_EVENT_KINDS } from '../representative/mailbox-policy.js';
import { LUCID_WORKSPACE_ID } from '../workspace/workspace-identity.js';
import { toParticipantView } from './participant-visibility.js';
import type {
  NetworkDiagnosticsStoreSnapshot,
  ParticipantNetworkStore,
  ParticipantWithAgent,
} from './store.js';

const SNAPSHOT_EVENT_LIMIT = 220;

export class PostgresParticipantNetworkStore
implements ParticipantNetworkStore {
  constructor(private readonly database: PostgresDatabase) {}

  async readNetworkDiagnostics(): Promise<NetworkDiagnosticsStoreSnapshot> {
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
      .where(eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID))
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

  private async listParticipants(): Promise<Participant[]> {
    return (await this.database.orm
      .select()
      .from(participants)
      .where(eq(participants.workspaceId, LUCID_WORKSPACE_ID))
      .orderBy(asc(participants.createdAt)))
      .map(toParticipant);
  }

  private async listAgents(): Promise<Agent[]> {
    return (await this.database.orm
      .select()
      .from(representativeAgents)
      .where(eq(representativeAgents.workspaceId, LUCID_WORKSPACE_ID))
      .orderBy(asc(representativeAgents.sortOrder)))
      .map(toAgent);
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

  async requireAgentByParticipantId(participantId: string): Promise<Agent> {
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
          eq(participants.workspaceId, LUCID_WORKSPACE_ID),
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
        .where(eq(discoveryWorkspaces.id, LUCID_WORKSPACE_ID))
        .for('update')
        .limit(1);
      if (!workspace) {
        throw new Error('Discovery workspace is missing.');
      }
      const [lastAgent] = await transaction
        .select({ sortOrder: representativeAgents.sortOrder })
        .from(representativeAgents)
        .where(eq(representativeAgents.workspaceId, LUCID_WORKSPACE_ID))
        .orderBy(desc(representativeAgents.sortOrder))
        .limit(1);
      const [latestEvent] = await transaction
        .select({ sequence: discoveryEvents.sequence })
        .from(discoveryEvents)
        .where(eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID))
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
          workspaceId: LUCID_WORKSPACE_ID,
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
          workspaceId: LUCID_WORKSPACE_ID,
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
        workspaceId: LUCID_WORKSPACE_ID,
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
        .where(eq(discoveryWorkspaces.id, LUCID_WORKSPACE_ID))
        .for('update')
        .limit(1);
      if (!workspace) {
        throw new Error('Discovery workspace is missing.');
      }
      const [participantRow] = await transaction
        .select()
        .from(participants)
        .where(and(
          eq(participants.workspaceId, LUCID_WORKSPACE_ID),
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
        .where(eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID))
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
        workspaceId: LUCID_WORKSPACE_ID,
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
        .where(eq(discoveryWorkspaces.id, LUCID_WORKSPACE_ID))
        .for('update')
        .limit(1);
      if (!workspace) {
        throw new Error('Discovery workspace is missing.');
      }
      const [participantRow] = await transaction
        .select()
        .from(participants)
        .where(and(
          eq(participants.workspaceId, LUCID_WORKSPACE_ID),
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
        .where(eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID))
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
        workspaceId: LUCID_WORKSPACE_ID,
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

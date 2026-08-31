/**
 * PostgreSQL adapter for agent scheduling and wake ownership.
 *
 * Wake selection, claim fencing, cursor settlement, recovery, and global
 * dispatch state remain in this adapter because their invariants depend on
 * one database transaction. Model execution and task scheduling stay outside.
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
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import {
  LOCAL_USER,
  LOCAL_AGENT,
} from '../local-user.js';
import type {
  Agent,
  AgentWakeClaim,
  AppendDiscoveryEventInput,
  DiscoveryEvent,
  DiscoveryWorkspace,
  User,
} from '../discovery-types.js';
import {
  readMetadataSequence,
  toAgent,
  toDiscoveryEvent,
  toDiscoveryWorkspace,
  toUser,
} from '../persistence/postgres/records.js';
import {
  postgresDiscoveryEvents as discoveryEvents,
  postgresDiscoveryWorkspaces as discoveryWorkspaces,
  postgresUsers as users,
  postgresAgents as agents,
} from '../persistence/postgres/schema.js';
import { LUCID_WORKSPACE_ID } from '../workspace/workspace-identity.js';
import { AGENT_PRINCIPAL_EVENT_KINDS } from './mailbox-policy.js';
import {
  LUCID_BACKGROUND_WORK_GROUP_ID,
} from './heartbeat-task-identity.js';
import type {
  BackgroundChecksResumePreparation,
  PrepareBackgroundChecksResumeInput,
  RecordWakeCompletionInput,
  AgentWakeStore,
} from './store.js';

type LucidPostgresTransaction = Parameters<
  Parameters<PostgresDatabase['orm']['transaction']>[0]
>[0];

export class PostgresAgentWakeStore
implements AgentWakeStore {
  constructor(private readonly database: PostgresDatabase) {}

  async initialize(): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${LUCID_WORKSPACE_ID}))`,
      );
      const [workspace] = await transaction
        .select({ id: discoveryWorkspaces.id })
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, LUCID_WORKSPACE_ID))
        .limit(1);
      if (!workspace) {
        await this.insertWorkspace(transaction);
      }
    });
  }

  async reset(options: { backgroundChecksEnabled: boolean }): Promise<void> {
    await this.database.orm.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${LUCID_WORKSPACE_ID}))`,
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
      .where(eq(discoveryWorkspaces.id, LUCID_WORKSPACE_ID));
    return await this.requireWorkspace();
  }

  /**
   * Establishes Lucid's fresh mailbox boundary before provider admission opens.
   *
   * Every discovery-event append and wake claim takes the workspace row lock,
   * so the persisted marker is a commit-safe boundary rather than a PostgreSQL
   * sequence allocation guess. Retrying one provider transition returns that
   * same marker and cannot advance the boundary twice.
   */
  async prepareBackgroundChecksResume(
    input: PrepareBackgroundChecksResumeInput,
  ): Promise<BackgroundChecksResumePreparation> {
    const admissionGroupId = normalizeBackgroundResumeIdentifier(
      input.admissionGroupId,
      'Admission group ID',
    );
    const transitionId = normalizeBackgroundResumeIdentifier(
      input.transitionId,
      'Resume transition ID',
    );
    if (admissionGroupId !== LUCID_BACKGROUND_WORK_GROUP_ID) {
      throw new Error(
        `Lucid does not own background admission group: ${admissionGroupId}`,
      );
    }

    const idempotencyKey = [
      'background-resume',
      admissionGroupId,
      transitionId,
    ].join(':');
    return await this.database.orm.transaction(async (transaction) => {
      const [workspace] = await transaction
        .select()
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, LUCID_WORKSPACE_ID))
        .for('update')
        .limit(1);
      if (!workspace) {
        throw new Error(
          'Discovery workspace is missing. Run the database migration and restart the service.',
        );
      }

      const [existingBoundary] = await transaction
        .select()
        .from(discoveryEvents)
        .where(and(
          eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
          eq(discoveryEvents.idempotencyKey, idempotencyKey),
        ))
        .limit(1);
      if (existingBoundary) {
        return readBackgroundResumePreparation(
          toDiscoveryEvent(existingBoundary),
          { admissionGroupId, transitionId },
        );
      }

      if (!workspace.backgroundChecksEnabled) {
        return {
          status: 'waiting',
          reason: 'background-checks-disabled',
          runningAgentIds: [],
        };
      }

      const activeAgentRows = await transaction
        .select({
          id: agents.id,
          status: agents.status,
          activeWakeId: agents.activeWakeId,
          activeWakeNumber: agents.activeWakeNumber,
        })
        .from(agents)
        .innerJoin(users, eq(users.id, agents.userId))
        .where(and(
          eq(agents.workspaceId, LUCID_WORKSPACE_ID),
          eq(users.workspaceId, LUCID_WORKSPACE_ID),
          eq(users.status, 'active'),
        ))
        .orderBy(asc(agents.sortOrder));
      const runningAgentIds = activeAgentRows
        .filter(({ status }) => status === 'running')
        .map(({ id }) => id);
      if (runningAgentIds.length > 0) {
        return {
          status: 'waiting',
          reason: 'agent-wake-running',
          runningAgentIds,
        };
      }

      const preparedAt = dayjs().toISOString();
      const unfinishedWakeRows = activeAgentRows.filter((agent) => (
        agent.activeWakeId !== null && agent.activeWakeNumber !== null
      ));
      if (unfinishedWakeRows.length > 0) {
        await transaction.insert(discoveryEvents).values(
          unfinishedWakeRows.map((agent) => ({
            id: `event_${randomUUID()}`,
            workspaceId: LUCID_WORKSPACE_ID,
            wakeNumber: agent.activeWakeNumber!,
            kind: 'error' as const,
            actorAgentId: agent.id,
            idempotencyKey: [
              agent.id,
              agent.activeWakeId,
              'not-retried-after-resume',
              transitionId,
            ].join(':'),
            title: 'Agent wake not retried after fresh resume',
            content:
              'Lucid started from the new resume boundary instead of retrying this unfinished wake.',
            metadata: {
              visibility: 'operator',
              resolution: 'not-retried-after-resume',
              wakeId: agent.activeWakeId,
              previousStatus: agent.status,
              admissionGroupId,
              transitionId,
            },
            createdAt: preparedAt,
          })),
        );
      }
      const [boundaryRow] = await transaction
        .insert(discoveryEvents)
        .values({
          id: `event_${randomUUID()}`,
          workspaceId: LUCID_WORKSPACE_ID,
          wakeNumber: workspace.currentWake,
          kind: 'background_resume_prepared',
          idempotencyKey,
          title: 'Background work resume prepared',
          content:
            'Lucid will consider only product events committed after this resume boundary.',
          metadata: {
            visibility: 'operator',
            admissionGroupId,
            transitionId,
            agentCount: activeAgentRows.length,
          },
          createdAt: preparedAt,
        })
        .returning();
      if (!boundaryRow) {
        throw new Error('Background resume boundary did not persist.');
      }

      const activeAgentIds = activeAgentRows.map(({ id }) => id);
      if (activeAgentIds.length > 0) {
        await transaction
          .update(agents)
          .set({
            status: 'idle',
            mailboxFloorSequence: boundaryRow.sequence,
            lastSeenSequence: boundaryRow.sequence,
            activeWakeId: null,
            activeWakeClaimToken: null,
            activeWakeNumber: null,
            activeWakeHorizon: null,
            updatedAt: preparedAt,
          })
          .where(inArray(agents.id, activeAgentIds));
      }

      return {
        status: 'prepared',
        admissionGroupId,
        transitionId,
        mailboxFloorSequence: boundaryRow.sequence,
        agentCount: activeAgentRows.length,
        preparedAt,
      };
    });
  }

  async listUsers(): Promise<User[]> {
    return (await this.database.orm
      .select()
      .from(users)
      .where(eq(users.workspaceId, LUCID_WORKSPACE_ID))
      .orderBy(asc(users.createdAt)))
      .map(toUser);
  }

  async listAgents(): Promise<Agent[]> {
    return (await this.database.orm
      .select()
      .from(agents)
      .where(eq(agents.workspaceId, LUCID_WORKSPACE_ID))
      .orderBy(asc(agents.sortOrder)))
      .map(toAgent);
  }

  async listActiveAgents(): Promise<Agent[]> {
    const [userList, agentList] = await Promise.all([
      this.listUsers(),
      this.listAgents(),
    ]);
    const activeUserIds = new Set(
      userList
        .filter((user) => user.status === 'active')
        .map((user) => user.id),
    );
    return agentList.filter(
      (agent) => activeUserIds.has(agent.userId),
    );
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
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
        eq(discoveryEvents.actorAgentId, agentId),
        eq(discoveryEvents.wakeNumber, wakeNumber),
        inArray(discoveryEvents.kind, ['shared_message', 'direct_message']),
      ))
      .orderBy(asc(discoveryEvents.sequence)))
      .map(toDiscoveryEvent);
  }

  async beginAgentWake(
    agentId: string,
    wakeId: string,
  ): Promise<AgentWakeClaim | undefined> {
    const now = dayjs().toISOString();

    // Selection, horizon assignment, agent ownership, and the audit event must
    // commit together; otherwise two schedulers could consume different views.
    // Every discovery-event appender takes this workspace row lock before it
    // allocates a sequence, so the event tail below is a commit-safe horizon.
    return await this.database.orm.transaction(async (transaction) => {
      const [workspaceRow] = await transaction
        .select()
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, LUCID_WORKSPACE_ID))
        .for('update')
        .limit(1);
      if (!workspaceRow) {
        throw new Error(
          'Discovery workspace is missing. Run the database migration and restart the service.',
        );
      }

      const [agentRow] = await transaction
        .select()
        .from(agents)
        .where(and(
          eq(agents.workspaceId, LUCID_WORKSPACE_ID),
          eq(agents.id, agentId),
        ))
        .for('update')
        .limit(1);
      if (!agentRow) {
        throw new Error(`Agent not found: ${agentId}`);
      }
      const selectedAgent = toAgent(agentRow);
      if (selectedAgent.status === 'running') {
        throw new Error(`Agent is already running: ${agentId}`);
      }

      const [userRow] = await transaction
        .select()
        .from(users)
        .where(and(
          eq(users.workspaceId, LUCID_WORKSPACE_ID),
          eq(users.id, selectedAgent.userId),
        ))
        .limit(1);
      if (!userRow) {
        throw new Error(`User not found: ${selectedAgent.userId}`);
      }
      if (toUser(userRow).status !== 'active') {
        return undefined;
      }

      const [savedInterest] = await transaction
        .select({ sequence: discoveryEvents.sequence })
        .from(discoveryEvents)
        .where(and(
          eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
          eq(discoveryEvents.kind, 'interest_saved'),
          eq(discoveryEvents.targetAgentId, selectedAgent.id),
          eq(discoveryEvents.targetUserId, selectedAgent.userId),
        ))
        .orderBy(desc(discoveryEvents.sequence))
        .limit(1);

      const resumingWake = Boolean(
        selectedAgent.activeWakeId
        && selectedAgent.activeWakeNumber !== undefined
        && selectedAgent.activeWakeHorizon !== undefined
        && selectedAgent.activeWakeHorizon > selectedAgent.lastSeenSequence,
      );
      // Freeze the product-event tail before reading the mailbox. Events
      // appended after this query must remain above this wake's horizon so a
      // concurrent Interest edit or message cannot be consumed accidentally.
      const [latestEvent] = resumingWake
        ? []
        : await transaction
          .select({ sequence: discoveryEvents.sequence })
          .from(discoveryEvents)
          .where(eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID))
          .orderBy(desc(discoveryEvents.sequence))
          .limit(1);
      const visibleEventConditions = [
        eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
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
          : latestEvent
            ? [lte(discoveryEvents.sequence, latestEvent.sequence)]
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

      // New mailbox input remains independently actionable. A saved Interest
      // is required only when the schedule is asking Lucid to reassess the
      // current world without any new event to process.
      if (!visibleEvents.length && !resumingWake && !savedInterest) {
        if (selectedAgent.activeWakeId) {
          await transaction
            .update(agents)
            .set({
              activeWakeId: null,
              activeWakeClaimToken: null,
              activeWakeNumber: null,
              activeWakeHorizon: null,
              updatedAt: now,
            })
            .where(eq(agents.id, selectedAgent.id));
        }
        return undefined;
      }

      const activeWakeId = resumingWake
        ? selectedAgent.activeWakeId!
        : wakeId;
      const claimToken = wakeId;
      const horizonSequence = resumingWake
        ? selectedAgent.activeWakeHorizon!
        : visibleEvents.at(-1)?.sequence
          ?? latestEvent?.sequence
          ?? savedInterest!.sequence;
      const wakeNumber = resumingWake
        ? selectedAgent.activeWakeNumber!
        : workspaceRow.currentWake + 1;

      if (!resumingWake) {
        await transaction
          .update(discoveryWorkspaces)
          .set({ currentWake: wakeNumber, updatedAt: now })
          .where(eq(discoveryWorkspaces.id, LUCID_WORKSPACE_ID));
      }
      await transaction
        .update(agents)
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
        .where(eq(agents.id, selectedAgent.id));
      if (!resumingWake) {
        await transaction.insert(discoveryEvents).values({
          id: `event_${randomUUID()}`,
          workspaceId: LUCID_WORKSPACE_ID,
          wakeNumber,
          kind: 'agent_wake_started',
          actorAgentId: selectedAgent.id,
          idempotencyKey: `${activeWakeId}:started`,
          title: `${selectedAgent.name} starts an Interest check`,
          content: visibleEvents.length
            ? `${visibleEvents.length} unread ${
                visibleEvents.length === 1 ? 'event is' : 'events are'
              } available during this check.`
            : 'The agent is checking the current Interest without new mailbox input.',
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
        user: toUser(userRow),
        wakeId: activeWakeId,
        claimToken,
        wakeNumber,
        visibleEvents,
        horizonSequence,
      };
    });
  }

  async readClaimedAgentWake(
    agentId: string,
    claimToken: string,
  ): Promise<AgentWakeClaim | undefined> {
    const [agentRow] = await this.database.orm
      .select()
      .from(agents)
      .where(and(
        eq(agents.workspaceId, LUCID_WORKSPACE_ID),
        eq(agents.id, agentId),
        eq(agents.status, 'running'),
        eq(agents.activeWakeClaimToken, claimToken),
      ))
      .limit(1);
    if (
      !agentRow
      || !agentRow.activeWakeId
      || agentRow.activeWakeNumber === null
      || agentRow.activeWakeHorizon === null
    ) {
      return undefined;
    }

    const [userRow, eventRows] = await Promise.all([
      this.database.orm
        .select()
        .from(users)
        .where(and(
          eq(users.workspaceId, LUCID_WORKSPACE_ID),
          eq(users.id, agentRow.userId),
        ))
        .limit(1)
        .then(([row]) => row),
      this.database.orm
        .select()
        .from(discoveryEvents)
        .where(and(
          eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID),
          gt(
            discoveryEvents.sequence,
            Math.max(
              agentRow.lastSeenSequence,
              agentRow.mailboxFloorSequence,
            ),
          ),
          lte(discoveryEvents.sequence, agentRow.activeWakeHorizon),
          or(
            and(
              eq(discoveryEvents.kind, 'shared_message'),
              ne(discoveryEvents.actorAgentId, agentRow.id),
            ),
            and(
              eq(discoveryEvents.kind, 'direct_message'),
              eq(discoveryEvents.targetAgentId, agentRow.id),
            ),
            and(
              inArray(discoveryEvents.kind, AGENT_PRINCIPAL_EVENT_KINDS),
              eq(discoveryEvents.targetAgentId, agentRow.id),
            ),
          ),
        ))
        .orderBy(asc(discoveryEvents.sequence))
        .limit(40),
    ]);
    if (!userRow) {
      throw new Error(`User not found: ${agentRow.userId}`);
    }

    return {
      agent: toAgent(agentRow),
      user: toUser(userRow),
      wakeId: agentRow.activeWakeId,
      claimToken,
      wakeNumber: agentRow.activeWakeNumber,
      visibleEvents: eventRows.map(toDiscoveryEvent),
      horizonSequence: agentRow.activeWakeHorizon,
    };
  }

  async completeAgentWake(
    agentId: string,
    claimToken: string,
    horizonSequence: number,
  ): Promise<void> {
    const agent = await this.requireAgent(agentId);
    const updated = await this.database.orm
      .update(agents)
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
        eq(agents.id, agentId),
        eq(agents.status, 'running'),
        eq(agents.activeWakeClaimToken, claimToken),
        eq(agents.activeWakeHorizon, horizonSequence),
      ))
      .returning({ id: agents.id });
    if (!updated.length) {
      throw new Error(
        `Wake claim is no longer owned by agent: ${agentId}`,
      );
    }
  }

  async failAgentWake(agentId: string, claimToken: string): Promise<void> {
    await this.setClaimStatus(agentId, claimToken, 'error');
  }

  async interruptAgentWake(
    agentId: string,
    claimToken: string,
  ): Promise<void> {
    await this.setClaimStatus(agentId, claimToken, 'idle');
  }

  async recoverInterruptedAgentWake(
    agentId: string,
    interruptedExecutionId: string,
  ): Promise<boolean> {
    const now = dayjs().toISOString();
    return await this.database.orm.transaction(async (transaction) => {
      const [workspace] = await transaction
        .select({ id: discoveryWorkspaces.id })
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, LUCID_WORKSPACE_ID))
        .for('update')
        .limit(1);
      if (!workspace) {
        throw new Error(
          'Discovery workspace is missing. Run the database migration and restart the service.',
        );
      }
      const [agentRow] = await transaction
        .select()
        .from(agents)
        .where(and(
          eq(agents.workspaceId, LUCID_WORKSPACE_ID),
          eq(agents.id, agentId),
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
        .update(agents)
        .set({ status: 'idle', updatedAt: now })
        .where(eq(agents.id, agentId));
      await transaction.insert(discoveryEvents).values({
        id: `event_${randomUUID()}`,
        workspaceId: LUCID_WORKSPACE_ID,
        wakeNumber: agentRow.activeWakeNumber ?? 0,
        kind: 'error',
        actorAgentId: agentId,
        idempotencyKey:
          `${agentRow.activeWakeId ?? agentId}:recovered:${interruptedExecutionId}`,
        title: 'Interrupted agent wake recovered',
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
        or(
          eq(discoveryEvents.replyToSequence, triggerSequence),
          and(
            sql`${discoveryEvents.metadata} @> ${JSON.stringify({
              messageRole: 'request',
            })}::jsonb`,
            sql`${discoveryEvents.metadata} @> ${JSON.stringify({
              sourceEventIds: [triggerSequence],
            })}::jsonb`,
          ),
        ),
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
        eq(discoveryEvents.kind, 'agent_note_updated'),
        eq(discoveryEvents.actorAgentId, agentId),
        eq(discoveryEvents.targetAgentId, agentId),
        gt(discoveryEvents.sequence, sourceSequence),
      )))
      .some(({ metadata }) => (
        readMetadataSequence(metadata?.throughSequence) >= sourceSequence
      ));
  }

  async recordWakeCompletion(
    input: RecordWakeCompletionInput,
  ): Promise<DiscoveryEvent> {
    return await this.appendEvent({
      ...input,
      kind: 'agent_wake_completed',
    });
  }

  private async appendEvent(
    input: AppendDiscoveryEventInput,
  ): Promise<DiscoveryEvent> {
    return await this.database.orm.transaction(async (transaction) => {
      const [workspace] = await transaction
        .select({ currentWake: discoveryWorkspaces.currentWake })
        .from(discoveryWorkspaces)
        .where(eq(discoveryWorkspaces.id, LUCID_WORKSPACE_ID))
        .for('update')
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
          targetUserId: input.targetUserId,
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

  private async setClaimStatus(
    agentId: string,
    claimToken: string,
    status: 'idle' | 'error',
  ): Promise<void> {
    const updated = await this.database.orm
      .update(agents)
      .set({ status, updatedAt: dayjs().toISOString() })
      .where(and(
        eq(agents.id, agentId),
        eq(agents.status, 'running'),
        eq(agents.activeWakeClaimToken, claimToken),
      ))
      .returning({ id: agents.id });
    if (!updated.length) {
      throw new Error(
        `Wake claim is no longer owned by agent: ${agentId}`,
      );
    }
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

  private async requireAgent(id: string): Promise<Agent> {
    const [row] = await this.database.orm
      .select()
      .from(agents)
      .where(and(
        eq(agents.workspaceId, LUCID_WORKSPACE_ID),
        eq(agents.id, id),
      ))
      .limit(1);
    if (!row) {
      throw new Error(`Agent not found: ${id}`);
    }
    return toAgent(row);
  }

  private async requireWorkspace(): Promise<DiscoveryWorkspace> {
    const [row] = await this.database.orm
      .select()
      .from(discoveryWorkspaces)
      .where(eq(discoveryWorkspaces.id, LUCID_WORKSPACE_ID))
      .limit(1);
    if (!row) {
      throw new Error(
        'Discovery workspace is missing. Run the database migration and restart the service.',
      );
    }
    return toDiscoveryWorkspace(row);
  }

  private async insertWorkspace(
    transaction: LucidPostgresTransaction,
    backgroundChecksEnabled = false,
  ): Promise<void> {
    const rows = createInitialWorkspaceRows({
      now: dayjs().toISOString(),
      backgroundChecksEnabled,
    });
    await transaction.insert(discoveryWorkspaces).values(rows.workspace);
    await transaction.insert(users).values(rows.user);
    await transaction.insert(agents).values(rows.agent);
    await transaction.insert(discoveryEvents).values(rows.event);
  }
}

function normalizeBackgroundResumeIdentifier(
  value: string,
  label: string,
): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,159}$/.test(normalized)) {
    throw new Error(
      `${label} must contain 1 to 160 letters, numbers, dots, colons, underscores, or hyphens.`,
    );
  }
  return normalized;
}

function readBackgroundResumePreparation(
  event: DiscoveryEvent,
  expected: Pick<
    PrepareBackgroundChecksResumeInput,
    'admissionGroupId' | 'transitionId'
  >,
): BackgroundChecksResumePreparation {
  const admissionGroupId = event.metadata.admissionGroupId;
  const transitionId = event.metadata.transitionId;
  const agentCount = event.metadata.agentCount;
  if (
    event.kind !== 'background_resume_prepared'
    || admissionGroupId !== expected.admissionGroupId
    || transitionId !== expected.transitionId
    || typeof agentCount !== 'number'
  ) {
    throw new Error(
      `Stored background resume transition is invalid: ${expected.transitionId}`,
    );
  }
  return {
    status: 'prepared',
    admissionGroupId,
    transitionId,
    mailboxFloorSequence: event.sequence,
    agentCount,
    preparedAt: event.createdAt,
  };
}

function createInitialWorkspaceRows(input: {
  now: string;
  backgroundChecksEnabled: boolean;
}) {
  const versionId = randomUUID();
  return {
    workspace: {
      id: LUCID_WORKSPACE_ID,
      versionId,
      currentWake: 0,
      backgroundChecksEnabled: input.backgroundChecksEnabled,
      createdAt: input.now,
      updatedAt: input.now,
    },
    user: {
      ...LOCAL_USER,
      workspaceId: LUCID_WORKSPACE_ID,
      contextConsentAt: input.now,
      createdAt: input.now,
      updatedAt: input.now,
    },
    agent: {
      ...LOCAL_AGENT,
      workspaceId: LUCID_WORKSPACE_ID,
      status: 'idle' as const,
      runCount: 0,
      mailboxFloorSequence: 0,
      lastSeenSequence: 0,
      createdAt: input.now,
      updatedAt: input.now,
    },
    event: {
      id: `event_${randomUUID()}`,
      workspaceId: LUCID_WORKSPACE_ID,
      wakeNumber: 0,
      kind: 'workspace_created' as const,
      title: 'Discovery workspace created',
      content:
        'The local user is represented by Lucid. Other users enter through the network ingress rather than product defaults.',
      metadata: {
        versionId,
        visibility: 'shared' as const,
        source: 'system',
      },
      createdAt: input.now,
    },
  };
}

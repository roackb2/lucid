/** PostgreSQL adapter for trusted user-network administration. */
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
  User,
  UserStatus,
  RegisterUserInput,
} from '../discovery-types.js';
import { userStatusSchema } from '../discovery-types.js';
import {
  LOCAL_USER_ID,
  LOCAL_AGENT_ID,
} from '../local-user.js';
import {
  toAgent,
  toDiscoveryEvent,
  toDiscoveryWorkspace,
  toUser,
} from '../persistence/postgres/records.js';
import {
  postgresDiscoveryEvents as discoveryEvents,
  postgresDiscoveryWorkspaces as discoveryWorkspaces,
  postgresUserIdentityBindings as userIdentityBindings,
  postgresUsers as users,
  postgresAgents as agents,
} from '../persistence/postgres/schema.js';
import { createAgentProfile } from '../agent-profile.js';
import { AGENT_PRINCIPAL_EVENT_KINDS } from '../agent/mailbox-policy.js';
import { LUCID_WORKSPACE_ID } from '../workspace/workspace-identity.js';
import { toUserView } from './user-visibility.js';
import type {
  AuthenticatedUserIdentity,
  EnrollAuthenticatedUserInput,
  NetworkDiagnosticsStoreSnapshot,
  UserNetworkStore,
  UserWithAgent,
  ResolvedUserIdentity,
} from './store.js';

const SNAPSHOT_EVENT_LIMIT = 220;

type LucidPostgresTransaction = Parameters<
  Parameters<PostgresDatabase['orm']['transaction']>[0]
>[0];

type NormalizedUserProfile = {
  displayName: string;
  privateContext: string;
};

export class PostgresUserNetworkStore
implements UserNetworkStore {
  constructor(private readonly database: PostgresDatabase) {}

  async resolveUserIdentity(
    identity: AuthenticatedUserIdentity,
  ): Promise<ResolvedUserIdentity | undefined> {
    const normalized = normalizeAuthenticatedIdentity(identity);
    const [row] = await this.database.orm
      .select({
        userId: users.id,
        status: users.status,
      })
      .from(userIdentityBindings)
      .innerJoin(
        users,
        eq(users.id, userIdentityBindings.userId),
      )
      .where(and(
        eq(userIdentityBindings.issuer, normalized.issuer),
        eq(userIdentityBindings.subject, normalized.subject),
        eq(users.workspaceId, LUCID_WORKSPACE_ID),
      ))
      .limit(1);
    return row
      ? {
          userId: row.userId,
          status: userStatusSchema.parse(row.status),
        }
      : undefined;
  }

  async enrollAuthenticatedUser(
    input: EnrollAuthenticatedUserInput,
  ): Promise<UserWithAgent> {
    const identity = normalizeAuthenticatedIdentity(input);
    const profile = normalizeUserProfile(input);
    if (!input.contextApproved) {
      throw new Error(
        'Confirm that the user knowingly allowed this context to be used.',
      );
    }
    const now = dayjs().toISOString();

    return await this.database.orm.transaction(async (transaction) => {
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtext(${identity.issuer}),
          hashtext(${identity.subject})
        )
      `);
      const existing = await this.findUserWithAgentByIdentity(
        transaction,
        identity,
      );
      if (existing) {
        return { ...existing, created: false };
      }

      const created = await this.createUserWithAgent(transaction, {
        ...profile,
        kind: 'human',
        registrationKey: null,
        contextConsentAt: now,
        now,
      });
      await transaction.insert(userIdentityBindings).values({
        ...identity,
        userId: created.user.id,
        createdAt: now,
      });
      return { ...created, created: true };
    });
  }

  async readNetworkDiagnostics(): Promise<NetworkDiagnosticsStoreSnapshot> {
    const workspace = await this.requireWorkspace();
    const [userList, agentList] = await Promise.all([
      this.listUsers(),
      this.listAgents(),
    ]);
    const userById = new Map(
      userList.map((user) => [user.id, user]),
    );
    const agents = await Promise.all(agentList.map(async (agent) => {
      const user = userById.get(agent.userId);
      if (!user) {
        throw new Error(
          `User ${agent.userId} is missing for agent ${agent.id}.`,
        );
      }
      return await this.toAgentView(agent, user);
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
      users: userList.map(toUserView),
      agents,
      events,
    };
  }

  private async listUsers(): Promise<User[]> {
    return (await this.database.orm
      .select()
      .from(users)
      .where(eq(users.workspaceId, LUCID_WORKSPACE_ID))
      .orderBy(asc(users.createdAt)))
      .map(toUser);
  }

  private async listAgents(): Promise<Agent[]> {
    return (await this.database.orm
      .select()
      .from(agents)
      .where(eq(agents.workspaceId, LUCID_WORKSPACE_ID))
      .orderBy(asc(agents.sortOrder)))
      .map(toAgent);
  }

  private async requireUser(id: string): Promise<User> {
    const [row] = await this.database.orm
      .select()
      .from(users)
      .where(and(
        eq(users.workspaceId, LUCID_WORKSPACE_ID),
        eq(users.id, id),
      ))
      .limit(1);
    if (!row) {
      throw new Error(`User not found: ${id}`);
    }
    return toUser(row);
  }

  async requireAgentByUserId(userId: string): Promise<Agent> {
    const [row] = await this.database.orm
      .select()
      .from(agents)
      .where(and(
        eq(agents.workspaceId, LUCID_WORKSPACE_ID),
        eq(agents.userId, userId),
      ))
      .limit(1);
    if (!row) {
      throw new Error(
        `Agent not found for user: ${userId}`,
      );
    }
    return toAgent(row);
  }

  async registerUser(
    input: RegisterUserInput,
  ): Promise<UserWithAgent> {
    // Validate and normalize trusted ingress before opening the transaction so
    // a malformed simulator or future client cannot leave partial identity.
    const registrationKey = input.registrationKey.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,119}$/.test(registrationKey)) {
      throw new Error(
        'Registration key must contain 1 to 120 letters, numbers, dots, colons, underscores, or hyphens.',
      );
    }
    if (input.kind === 'human' && !input.contextApproved) {
      throw new Error(
        'Confirm that the user knowingly allowed this context to be used.',
      );
    }
    const profile = normalizeUserProfile(input);

    const now = dayjs().toISOString();

    return await this.database.orm.transaction(async (transaction) => {
      // Serialize one stable registration identity across API instances. This
      // makes user + agent creation one idempotent unit rather
      // than relying on a pre-insert existence check.
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${registrationKey}))`,
      );
      const [existingRow] = await transaction
        .select()
        .from(users)
        .where(and(
          eq(users.workspaceId, LUCID_WORKSPACE_ID),
          eq(users.registrationKey, registrationKey),
        ))
        .limit(1);
      if (existingRow) {
        const user = toUser(existingRow);
        if (
          user.kind !== input.kind
          || user.displayName !== profile.displayName
          || user.privateContext !== profile.privateContext
        ) {
          throw new Error(
            `Registration key ${registrationKey} already belongs to a different user profile.`,
          );
        }
        const [existingAgent] = await transaction
          .select()
          .from(agents)
          .where(eq(agents.userId, user.id))
          .limit(1);
        if (!existingAgent) {
          throw new Error(
            `Agent not found for user: ${user.id}`,
          );
        }
        return {
          user,
          agent: toAgent(existingAgent),
          created: false,
        };
      }

      return {
        ...await this.createUserWithAgent(transaction, {
          ...profile,
          registrationKey,
          contextConsentAt: input.kind === 'human' ? now : null,
          kind: input.kind,
          now,
        }),
        created: true,
      };
    });
  }

  private async findUserWithAgentByIdentity(
    transaction: LucidPostgresTransaction,
    identity: AuthenticatedUserIdentity,
  ): Promise<UserWithAgent | undefined> {
    const [row] = await transaction
      .select({
        user: users,
        agent: agents,
      })
      .from(userIdentityBindings)
      .innerJoin(
        users,
        eq(users.id, userIdentityBindings.userId),
      )
      .innerJoin(
        agents,
        eq(agents.userId, users.id),
      )
      .where(and(
        eq(userIdentityBindings.issuer, identity.issuer),
        eq(userIdentityBindings.subject, identity.subject),
        eq(users.workspaceId, LUCID_WORKSPACE_ID),
      ))
      .limit(1);
    return row
      ? { user: toUser(row.user), agent: toAgent(row.agent) }
      : undefined;
  }

  private async createUserWithAgent(
    transaction: LucidPostgresTransaction,
    input: NormalizedUserProfile & {
      registrationKey: string | null;
      kind: RegisterUserInput['kind'];
      contextConsentAt: string | null;
      now: string;
    },
  ): Promise<UserWithAgent> {
    const userId = `user_${randomUUID()}`;
    const agentId = `agent_${randomUUID()}`;
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
      .select({ sortOrder: agents.sortOrder })
      .from(agents)
      .where(eq(agents.workspaceId, LUCID_WORKSPACE_ID))
      .orderBy(desc(agents.sortOrder))
      .limit(1);
    const [latestEvent] = await transaction
      .select({ sequence: discoveryEvents.sequence })
      .from(discoveryEvents)
      .where(eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID))
      .orderBy(desc(discoveryEvents.sequence))
      .limit(1);
    // User, agent, initial mailbox floor, and audit event are
    // one unit. The current tail prevents a new source from reading old mail.
    const agentProfile = createAgentProfile({
      id: agentId,
      userId,
      displayName: input.displayName,
      kind: input.kind,
      sortOrder: (lastAgent?.sortOrder ?? 0) + 1,
    });
    const [userRow] = await transaction
      .insert(users)
      .values({
        id: userId,
        workspaceId: LUCID_WORKSPACE_ID,
        registrationKey: input.registrationKey,
        kind: input.kind,
        status: 'active',
        displayName: input.displayName,
        privateContext: input.privateContext,
        contextConsentAt: input.contextConsentAt,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    const [agentRow] = await transaction
      .insert(agents)
      .values({
        ...agentProfile,
        workspaceId: LUCID_WORKSPACE_ID,
        status: 'idle',
        runCount: 0,
        mailboxFloorSequence: latestEvent?.sequence ?? 0,
        lastSeenSequence: latestEvent?.sequence ?? 0,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .returning();
    await transaction.insert(discoveryEvents).values({
      id: `event_${randomUUID()}`,
      workspaceId: LUCID_WORKSPACE_ID,
      wakeNumber: workspace.currentWake,
      kind: 'user_added',
      targetAgentId: agentId,
      targetUserId: userId,
      title: `${input.displayName} joins the user network`,
      content:
        'Trusted ingress registered private context and created one agent. The context itself is not included in this event.',
      metadata: {
        visibility: 'operator',
        userId,
        agentId,
        userKind: input.kind,
        contextConsentAt: input.contextConsentAt ?? undefined,
      },
      createdAt: input.now,
    });

    if (!userRow || !agentRow) {
      throw new Error('PostgreSQL did not return the created user.');
    }

    return {
      user: toUser(userRow),
      agent: toAgent(agentRow),
    };
  }

  async setUserStatus(
    userId: string,
    status: Extract<UserStatus, 'active' | 'disabled'>,
  ): Promise<UserWithAgent> {
    this.assertManageableUser(userId);
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
      const [userRow] = await transaction
        .select()
        .from(users)
        .where(and(
          eq(users.workspaceId, LUCID_WORKSPACE_ID),
          eq(users.id, userId),
        ))
        .for('update')
        .limit(1);
      if (!userRow) {
        throw new Error(`User not found: ${userId}`);
      }
      const user = toUser(userRow);
      if (user.status === 'retired') {
        throw new Error('A retired user cannot be re-enabled.');
      }
      const [agentRow] = await transaction
        .select()
        .from(agents)
        .where(eq(agents.userId, userId))
        .for('update')
        .limit(1);
      if (!agentRow) {
        throw new Error(
          `Agent not found for user: ${userId}`,
        );
      }
      if (user.status === status) {
        return { user, agent: toAgent(agentRow) };
      }

      // Resuming accepts only messages created after this transaction. Pausing
      // preserves the existing floor because task shutdown already prevents reads.
      const [latestEvent] = await transaction
        .select({ sequence: discoveryEvents.sequence })
        .from(discoveryEvents)
        .where(eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID))
        .orderBy(desc(discoveryEvents.sequence))
        .limit(1);
      const [updatedUserRow] = await transaction
        .update(users)
        .set({ status, updatedAt: now })
        .where(eq(users.id, userId))
        .returning();
      const [updatedAgentRow] = await transaction
        .update(agents)
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
        .where(eq(agents.id, agentRow.id))
        .returning();
      // Persist lifecycle state and its operator audit record atomically.
      await transaction.insert(discoveryEvents).values({
        id: `event_${randomUUID()}`,
        workspaceId: LUCID_WORKSPACE_ID,
        wakeNumber: workspace.currentWake,
        kind: status === 'active'
          ? 'user_enabled'
          : 'user_disabled',
        targetAgentId: agentRow.id,
        targetUserId: userId,
        title: `${user.displayName} is ${status}`,
        content: status === 'active'
          ? 'The agent can receive new messages and run background checks again.'
          : 'The agent is paused and will not receive messages created while disabled.',
        metadata: {
          visibility: 'operator',
          userId,
          agentId: agentRow.id,
          status,
        },
        createdAt: now,
      });

      if (!updatedUserRow || !updatedAgentRow) {
        throw new Error('User lifecycle update did not persist.');
      }

      return {
        user: toUser(updatedUserRow),
        agent: toAgent(updatedAgentRow),
      };
    });
  }

  async retireUser(
    userId: string,
  ): Promise<UserWithAgent> {
    this.assertManageableUser(userId);
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
      const [userRow] = await transaction
        .select()
        .from(users)
        .where(and(
          eq(users.workspaceId, LUCID_WORKSPACE_ID),
          eq(users.id, userId),
        ))
        .for('update')
        .limit(1);
      if (!userRow) {
        throw new Error(`User not found: ${userId}`);
      }
      const user = toUser(userRow);
      const [agentRow] = await transaction
        .select()
        .from(agents)
        .where(eq(agents.userId, userId))
        .for('update')
        .limit(1);
      if (!agentRow) {
        throw new Error(
          `Agent not found for user: ${userId}`,
        );
      }
      if (user.status === 'retired') {
        return { user, agent: toAgent(agentRow) };
      }
      const [latestEvent] = await transaction
        .select({ sequence: discoveryEvents.sequence })
        .from(discoveryEvents)
        .where(eq(discoveryEvents.workspaceId, LUCID_WORKSPACE_ID))
        .orderBy(desc(discoveryEvents.sequence))
        .limit(1);
      // Retirement is irreversible in this workspace generation: scrub private
      // context in the same transaction that closes the mailbox and records it.
      const [updatedUserRow] = await transaction
        .update(users)
        .set({
          status: 'retired',
          privateContext: '',
          updatedAt: now,
        })
        .where(eq(users.id, userId))
        .returning();
      const [updatedAgentRow] = await transaction
        .update(agents)
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
        .where(eq(agents.id, agentRow.id))
        .returning();
      await transaction.insert(discoveryEvents).values({
        id: `event_${randomUUID()}`,
        workspaceId: LUCID_WORKSPACE_ID,
        wakeNumber: workspace.currentWake,
        kind: 'user_retired',
        targetAgentId: agentRow.id,
        targetUserId: userId,
        title: `${user.displayName} is retired`,
        content:
          'Private context was removed from future use. Historical message attribution remains available for the operator audit trail.',
        metadata: {
          visibility: 'operator',
          userId,
          agentId: agentRow.id,
          status: 'retired',
          privateContextRemoved: true,
        },
        createdAt: now,
      });

      if (!updatedUserRow || !updatedAgentRow) {
        throw new Error('User retirement did not persist.');
      }

      return {
        user: toUser(updatedUserRow),
        agent: toAgent(updatedAgentRow),
      };
    });
  }

  async saveUserInput(
    userId: string,
    content: string,
    idempotencyKey: string,
  ): Promise<DiscoveryEvent> {
    const user = await this.requireUser(userId);
    if (user.status !== 'active') {
      throw new Error(
        `User input requires an active user: ${userId}`,
      );
    }
    const agent = await this.requireAgentByUserId(userId);
    const normalizedContent = content.trim();
    if (!normalizedContent || normalizedContent.length > 1_600) {
      throw new Error('User input must contain 1 to 1,600 characters.');
    }
    const normalizedIdempotencyKey = idempotencyKey.trim();
    if (
      !normalizedIdempotencyKey
      || normalizedIdempotencyKey.length > 160
    ) {
      throw new Error('Input idempotency key must contain 1 to 160 characters.');
    }

    return await this.appendEvent({
      kind: 'user_input',
      targetAgentId: agent.id,
      targetUserId: user.id,
      idempotencyKey: normalizedIdempotencyKey,
      title: `${user.displayName} provides new private input`,
      content: normalizedContent,
      metadata: {
        visibility: 'user-and-agent',
        source: user.kind === 'synthetic'
          ? 'network-simulator'
          : 'user',
        userKind: user.kind,
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
    // resume floor established for this user.
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
        userStatus: users.status,
        agent: agents,
      })
      .from(agents)
      .innerJoin(
        users,
        eq(users.id, agents.userId),
      )
      .where(and(
        eq(agents.workspaceId, LUCID_WORKSPACE_ID),
        eq(agents.id, agentId),
      ))
      .limit(1);
    return row?.userStatus === 'active'
      ? toAgent(row.agent)
      : undefined;
  }

  private assertManageableUser(userId: string): void {
    if (userId === LOCAL_USER_ID) {
      throw new Error('The local user cannot be disabled or retired.');
    }
  }

  private async toAgentView(
    agent: Agent,
    user: User,
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
      user: toUserView(user),
      unreadCount: (await this.listEventsVisibleToAgent(
        agent.id,
        agent.lastSeenSequence,
        10_000,
      )).length,
      isCurrentUserAgent: agent.id === LOCAL_AGENT_ID,
    };
  }
}

function normalizeAuthenticatedIdentity(
  identity: AuthenticatedUserIdentity,
): AuthenticatedUserIdentity {
  const { issuer, subject } = identity;
  if (!issuer || issuer.length > 512 || issuer !== issuer.trim()) {
    throw new Error('Identity issuer must contain 1 to 512 characters.');
  }
  if (!subject || subject.length > 512 || subject !== subject.trim()) {
    throw new Error('Identity subject must contain 1 to 512 characters.');
  }
  return { issuer, subject };
}

function normalizeUserProfile(input: {
  displayName: string;
  privateContext: string;
}): NormalizedUserProfile {
  const displayName = input.displayName.trim();
  const privateContext = input.privateContext.trim();
  if (!displayName || displayName.length > 80) {
    throw new Error('User name must contain 1 to 80 characters.');
  }
  if (!privateContext || privateContext.length > 4_000) {
    throw new Error('User context must contain 1 to 4,000 characters.');
  }
  return { displayName, privateContext };
}

/**
 * Trusted ingress and operator boundary for the local user network.
 *
 * External development tools use this service through the loopback-only tRPC
 * router. It persists user identity or private principal input before
 * reconciling/requesting Heddle execution. The user-facing workspace never
 * receives this service's world-wide diagnostics projection.
 */
import { LOCAL_USER_ID } from '../local-user.js';
import type {
  AgentTaskView,
  BackgroundChecksView,
  NetworkDiagnosticsSnapshot,
  RegisterUserInput,
} from '../discovery-types.js';
import type {
  AgentHeartbeatControl,
} from '../agent/heartbeat-control.js';
import type {
  EnrollAuthenticatedUserInput,
  UserNetworkStore,
  UserWithAgent,
} from './store.js';

export class UserNetworkInputError extends Error {}

export type UserEnrollmentReceipt = {
  created: boolean;
  userId: string;
  agentId: string;
  displayName: string;
  kind: RegisterUserInput['kind'];
};

/** Coordinates network ingress with derived agent heartbeat tasks. */
export class UserNetworkService {
  constructor(
    private readonly store: UserNetworkStore,
    private readonly heartbeats: AgentHeartbeatControl,
    private readonly runtime: { model: string; heddleVersion: string },
  ) {}

  async registerUser(
    input: RegisterUserInput,
  ): Promise<UserEnrollmentReceipt> {
    try {
      const registered = await this.store.registerUser(input);
      return await this.completeUserSetup(registered);
    } catch (error) {
      throw new UserNetworkInputError(
        inputErrorMessage(error, 'Lucid could not register this user.'),
      );
    }
  }

  /** Atomically enrolls one verified provider subject as a human user. */
  async enrollAuthenticatedUser(
    input: EnrollAuthenticatedUserInput,
  ): Promise<UserEnrollmentReceipt> {
    try {
      return await this.completeUserSetup(
        await this.store.enrollAuthenticatedUser(input),
      );
    } catch (error) {
      throw new UserNetworkInputError(
        inputErrorMessage(error, 'Lucid could not enroll this user.'),
      );
    }
  }

  async submitUserInput(input: {
    userId: string;
    content: string;
    idempotencyKey: string;
  }): Promise<{
    userId: string;
    agentId: string;
    eventId: string;
    sequence: number;
  }> {
    try {
      const agent = await this.store.requireAgentByUserId(
        input.userId,
      );
      // Durable input is committed before Heddle is notified. A failed wake
      // request leaves unread mail that startup or a later trigger can recover.
      const event = await this.store.saveUserInput(
        input.userId,
        input.content,
        input.idempotencyKey,
      );
      await this.heartbeats.triggerAgent(agent.id);
      return {
        userId: input.userId,
        agentId: agent.id,
        eventId: event.id,
        sequence: event.sequence,
      };
    } catch (error) {
      throw new UserNetworkInputError(
        inputErrorMessage(error, 'Lucid could not accept user input.'),
      );
    }
  }

  async setUserEnabled(
    userId: string,
    enabled: boolean,
  ): Promise<NetworkDiagnosticsSnapshot> {
    if (userId === LOCAL_USER_ID) {
      throw new UserNetworkInputError(
        'The local user manages listening from the product workspace.',
      );
    }
    try {
      const agent = await this.store.requireAgentByUserId(
        userId,
      );
      if (!enabled) {
        await this.heartbeats.disableAgentTasks([agent.id]);
      }
      await this.store.setUserStatus(
        userId,
        enabled ? 'active' : 'disabled',
      );
      if (enabled) {
        try {
          await this.heartbeats.enableAgentTask(agent.id);
        } catch (error) {
          await this.store.setUserStatus(
            userId,
            'disabled',
          );
          await this.heartbeats.reconcileAgentTasks();
          throw error;
        }
      } else {
        await this.heartbeats.reconcileAgentTasks();
      }
      return await this.diagnostics();
    } catch (error) {
      await this.heartbeats.reconcileAgentTasks();
      throw new UserNetworkInputError(
        inputErrorMessage(error, 'Lucid could not change user status.'),
      );
    }
  }

  /**
   * Changes only the Heddle task preference for active synthetic peers.
   * Their Lucid user lifecycle and mailbox eligibility remain untouched.
   */
  async setSyntheticPeerAgentTasksEnabled(
    enabled: boolean,
    expectedCount?: number,
  ): Promise<NetworkDiagnosticsSnapshot> {
    try {
      const [network, backgroundChecks] = await Promise.all([
        this.store.readNetworkDiagnostics(),
        this.heartbeats.snapshot(),
      ]);
      const peerAgentIds = network.agents
        .filter(({ user }) => (
          user.kind === 'synthetic' && user.status === 'active'
        ))
        .map(({ id }) => id);

      if (
        expectedCount !== undefined
        && peerAgentIds.length !== expectedCount
      ) {
        throw new Error(
          `Expected ${expectedCount} active synthetic peer Agents, found ${peerAgentIds.length}.`,
        );
      }
      if (!peerAgentIds.length) {
        throw new Error('No active synthetic peer Agents exist.');
      }

      if (enabled) {
        await this.enableAgentTasksWithCompensation(
          peerAgentIds,
          backgroundChecks.tasks,
        );
      } else {
        await this.heartbeats.disableAgentTasks(peerAgentIds);
      }
      return await this.diagnostics();
    } catch (error) {
      throw new UserNetworkInputError(inputErrorMessage(
        error,
        'Lucid could not change synthetic peer Agent tasks.',
      ));
    }
  }

  async retireUser(
    userId: string,
  ): Promise<NetworkDiagnosticsSnapshot> {
    if (userId === LOCAL_USER_ID) {
      throw new UserNetworkInputError(
        'The local user cannot be retired.',
      );
    }
    try {
      const agent = await this.store.requireAgentByUserId(
        userId,
      );
      await this.heartbeats.disableAgentTasks([agent.id]);
      await this.store.retireUser(userId);
      await this.heartbeats.reconcileAgentTasks();
      return await this.diagnostics();
    } catch (error) {
      await this.heartbeats.reconcileAgentTasks();
      throw new UserNetworkInputError(
        inputErrorMessage(error, 'Lucid could not retire this user.'),
      );
    }
  }

  async reset(): Promise<NetworkDiagnosticsSnapshot> {
    await this.heartbeats.resetWorkspace();
    return await this.diagnostics();
  }

  /** Returns the operator-safe execution projection without private events. */
  async backgroundChecks(): Promise<BackgroundChecksView> {
    return await this.heartbeats.snapshot();
  }

  /** Changes the durable service-wide dispatch gate, not user preferences. */
  async setGlobalBackgroundChecksEnabled(
    enabled: boolean,
  ): Promise<BackgroundChecksView> {
    await this.heartbeats.setGlobalBackgroundChecksEnabled(enabled);
    return await this.heartbeats.snapshot();
  }

  async diagnostics(): Promise<NetworkDiagnosticsSnapshot> {
    const [network, backgroundChecks] = await Promise.all([
      this.store.readNetworkDiagnostics(),
      this.heartbeats.snapshot(),
    ]);
    return {
      ...network,
      backgroundChecks,
      runtime: this.runtime,
    };
  }

  private async completeUserSetup(
    registered: UserWithAgent,
  ): Promise<UserEnrollmentReceipt> {
    try {
      await this.heartbeats.reconcileAgentTasks();
    } catch (error) {
      if (!registered.created) {
        throw error;
      }
      // Never leave a newly visible principal routable without an execution
      // task. If compensation also fails, report both failures explicitly.
      try {
        await this.store.setUserStatus(
          registered.user.id,
          'disabled',
        );
        await this.heartbeats.reconcileAgentTasks();
      } catch (compensationError) {
        throw new AggregateError(
          [error, compensationError],
          'Agent setup failed and Lucid could not disable the user safely.',
        );
      }
      throw new Error(
        'The user was saved disabled because agent setup failed.',
        { cause: error },
      );
    }
    return {
      created: registered.created === true,
      userId: registered.user.id,
      agentId: registered.agent.id,
      displayName: registered.user.displayName,
      kind: registered.user.kind,
    };
  }

  private async enableAgentTasksWithCompensation(
    agentIds: string[],
    tasks: AgentTaskView[],
  ): Promise<void> {
    const taskByAgentId = new Map(
      tasks.map((task) => [task.agentId, task]),
    );
    const agentIdsToEnable = agentIds.filter((agentId) => {
      const task = taskByAgentId.get(agentId);
      return task?.enabled !== true || task.status === 'blocked';
    });
    const enabledAgentIds: string[] = [];

    try {
      for (const agentId of agentIdsToEnable) {
        await this.heartbeats.enableAgentTask(agentId);
        enabledAgentIds.push(agentId);
      }
    } catch (error) {
      try {
        await this.heartbeats.disableAgentTasks(enabledAgentIds);
      } catch (compensationError) {
        throw new AggregateError(
          [error, compensationError],
          'Synthetic peer Agent task enable failed and rollback did not complete.',
        );
      }
      throw error;
    }
  }
}

function inputErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

/**
 * Trusted ingress and operator boundary for the local participant network.
 *
 * External development tools use this service through the loopback-only tRPC
 * router. It persists participant identity or private principal input before
 * reconciling/requesting Heddle execution. The user-facing workspace never
 * receives this service's world-wide diagnostics projection.
 */
import { LOCAL_USER_ID } from '../local-participant.js';
import type {
  BackgroundChecksView,
  NetworkDiagnosticsSnapshot,
  RegisterParticipantInput,
} from '../discovery-types.js';
import type {
  RepresentativeAgentHeartbeatService,
} from '../representative/heartbeat-service.js';
import type {
  EnrollAuthenticatedParticipantInput,
  ParticipantNetworkStore,
  ParticipantWithAgent,
} from './store.js';

export class ParticipantNetworkInputError extends Error {}

export type ParticipantEnrollmentReceipt = {
  created: boolean;
  participantId: string;
  representativeAgentId: string;
  displayName: string;
  kind: RegisterParticipantInput['kind'];
};

/** Coordinates network ingress with derived representative heartbeat tasks. */
export class ParticipantNetworkService {
  constructor(
    private readonly store: ParticipantNetworkStore,
    private readonly heartbeats: RepresentativeAgentHeartbeatService,
    private readonly runtime: { model: string; heddleVersion: string },
  ) {}

  async registerParticipant(
    input: RegisterParticipantInput,
  ): Promise<ParticipantEnrollmentReceipt> {
    try {
      const registered = await this.store.registerParticipant(input);
      return await this.completeParticipantSetup(registered);
    } catch (error) {
      throw new ParticipantNetworkInputError(
        inputErrorMessage(error, 'Lucid could not register this participant.'),
      );
    }
  }

  /** Atomically enrolls one verified provider subject as a human participant. */
  async enrollAuthenticatedParticipant(
    input: EnrollAuthenticatedParticipantInput,
  ): Promise<ParticipantEnrollmentReceipt> {
    try {
      return await this.completeParticipantSetup(
        await this.store.enrollAuthenticatedParticipant(input),
      );
    } catch (error) {
      throw new ParticipantNetworkInputError(
        inputErrorMessage(error, 'Lucid could not enroll this participant.'),
      );
    }
  }

  async submitParticipantInput(input: {
    participantId: string;
    content: string;
    idempotencyKey: string;
  }): Promise<{
    participantId: string;
    representativeAgentId: string;
    eventId: string;
    sequence: number;
  }> {
    try {
      const agent = await this.store.requireAgentByParticipantId(
        input.participantId,
      );
      // Durable input is committed before Heddle is notified. A failed wake
      // request leaves unread mail that startup or a later trigger can recover.
      const event = await this.store.saveParticipantInput(
        input.participantId,
        input.content,
        input.idempotencyKey,
      );
      await this.heartbeats.triggerAgent(agent.id);
      return {
        participantId: input.participantId,
        representativeAgentId: agent.id,
        eventId: event.id,
        sequence: event.sequence,
      };
    } catch (error) {
      throw new ParticipantNetworkInputError(
        inputErrorMessage(error, 'Lucid could not accept participant input.'),
      );
    }
  }

  async setParticipantEnabled(
    participantId: string,
    enabled: boolean,
  ): Promise<NetworkDiagnosticsSnapshot> {
    if (participantId === LOCAL_USER_ID) {
      throw new ParticipantNetworkInputError(
        'The local participant manages listening from the product workspace.',
      );
    }
    try {
      const agent = await this.store.requireAgentByParticipantId(
        participantId,
      );
      if (!enabled) {
        await this.heartbeats.disableAgentTasks([agent.id]);
      }
      await this.store.setParticipantStatus(
        participantId,
        enabled ? 'active' : 'disabled',
      );
      if (enabled) {
        try {
          await this.heartbeats.enableAgentTask(agent.id);
        } catch (error) {
          await this.store.setParticipantStatus(
            participantId,
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
      throw new ParticipantNetworkInputError(
        inputErrorMessage(error, 'Lucid could not change participant status.'),
      );
    }
  }

  async retireParticipant(
    participantId: string,
  ): Promise<NetworkDiagnosticsSnapshot> {
    if (participantId === LOCAL_USER_ID) {
      throw new ParticipantNetworkInputError(
        'The local participant cannot be retired.',
      );
    }
    try {
      const agent = await this.store.requireAgentByParticipantId(
        participantId,
      );
      await this.heartbeats.disableAgentTasks([agent.id]);
      await this.store.retireParticipant(participantId);
      await this.heartbeats.reconcileAgentTasks();
      return await this.diagnostics();
    } catch (error) {
      await this.heartbeats.reconcileAgentTasks();
      throw new ParticipantNetworkInputError(
        inputErrorMessage(error, 'Lucid could not retire this participant.'),
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

  /** Changes the durable service-wide dispatch gate, not participant preferences. */
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

  private async completeParticipantSetup(
    registered: ParticipantWithAgent,
  ): Promise<ParticipantEnrollmentReceipt> {
    try {
      await this.heartbeats.reconcileAgentTasks();
    } catch (error) {
      if (!registered.created) {
        throw error;
      }
      // Never leave a newly visible principal routable without an execution
      // task. If compensation also fails, report both failures explicitly.
      try {
        await this.store.setParticipantStatus(
          registered.participant.id,
          'disabled',
        );
        await this.heartbeats.reconcileAgentTasks();
      } catch (compensationError) {
        throw new AggregateError(
          [error, compensationError],
          'Representative setup failed and Lucid could not disable the participant safely.',
        );
      }
      throw new Error(
        'The participant was saved disabled because representative setup failed.',
        { cause: error },
      );
    }
    return {
      created: registered.created === true,
      participantId: registered.participant.id,
      representativeAgentId: registered.agent.id,
      displayName: registered.participant.displayName,
      kind: registered.participant.kind,
    };
  }
}

function inputErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback;
}

/**
 * tRPC transport boundary for participant-scoped discovery and loopback-only
 * development ingress. Sequencing and compensation remain in domain services.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  DiscoveryInputError,
  DiscoveryWorkspaceService,
} from './lucid/discovery-workspace-service.js';
import {
  ParticipantNetworkInputError,
  ParticipantNetworkService,
} from './lucid/participant-network-service.js';
import { trpc } from './trpc.js';

const interestInputSchema = z.object({
  content: z.string().trim().min(1).max(1_600),
});

const feedbackInputSchema = z.object({
  findingSequence: z.number().int().positive(),
  content: z.string().trim().min(1).max(1_600),
});

const backgroundChecksInputSchema = z.object({
  enabled: z.boolean(),
});

const participantRegistrationSchema = z.discriminatedUnion('kind', [
  z.object({
    registrationKey: z.string().trim().min(1).max(120),
    kind: z.literal('synthetic'),
    displayName: z.string().trim().min(1).max(80),
    privateContext: z.string().trim().min(1).max(4_000),
  }),
  z.object({
    registrationKey: z.string().trim().min(1).max(120),
    kind: z.literal('human'),
    displayName: z.string().trim().min(1).max(80),
    privateContext: z.string().trim().min(1).max(4_000),
    contextApproved: z.literal(true),
  }),
]);

const participantInputSchema = z.object({
  participantId: z.string().trim().min(1),
  content: z.string().trim().min(1).max(1_600),
  idempotencyKey: z.string().trim().min(1).max(160),
});

const participantEnabledInputSchema = z.object({
  participantId: z.string().trim().min(1),
  enabled: z.boolean(),
});

const participantIdSchema = z.object({
  participantId: z.string().trim().min(1),
});

const loopbackProcedure = trpc.procedure.use(({ ctx, next }) => {
  if (!isLoopbackAddress(ctx.remoteAddress)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Lucid development APIs accept loopback requests only.',
    });
  }
  return next();
});

export function createAppRouter(
  discoveryWorkspace: DiscoveryWorkspaceService,
  participantNetwork: ParticipantNetworkService,
) {
  return trpc.router({
    system: trpc.router({
      health: trpc.procedure.query(() => ({
        status: 'ok' as const,
        service: 'lucid-discovery',
      })),
    }),
    discovery: trpc.router({
      snapshot: trpc.procedure.query(() => discoveryWorkspace.snapshot()),
      saveInterest: trpc.procedure
        .input(interestInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryWorkspace.saveInterest(input.content),
        )),
      runNow: trpc.procedure.mutation(() => resolveDiscoveryError(
        () => discoveryWorkspace.runNow(),
      )),
      retryCurrentWake: trpc.procedure.mutation(() => resolveDiscoveryError(
        () => discoveryWorkspace.retryCurrentWake(),
      )),
      setBackgroundChecksEnabled: trpc.procedure
        .input(backgroundChecksInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryWorkspace.setBackgroundChecksEnabled(input.enabled),
        )),
      submitFeedback: trpc.procedure
        .input(feedbackInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryWorkspace.submitFeedback(
            input.findingSequence,
            input.content,
          ),
        )),
    }),
    development: trpc.router({
      registerParticipant: loopbackProcedure
        .input(participantRegistrationSchema)
        .mutation(({ input }) => resolveParticipantNetworkError(
          () => participantNetwork.registerParticipant(input),
        )),
      submitParticipantInput: loopbackProcedure
        .input(participantInputSchema)
        .mutation(({ input }) => resolveParticipantNetworkError(
          () => participantNetwork.submitParticipantInput(input),
        )),
      setParticipantEnabled: loopbackProcedure
        .input(participantEnabledInputSchema)
        .mutation(({ input }) => resolveParticipantNetworkError(
          () => participantNetwork.setParticipantEnabled(
            input.participantId,
            input.enabled,
          ),
        )),
      retireParticipant: loopbackProcedure
        .input(participantIdSchema)
        .mutation(({ input }) => resolveParticipantNetworkError(
          () => participantNetwork.retireParticipant(input.participantId),
        )),
      diagnostics: loopbackProcedure.query(() => (
        participantNetwork.diagnostics()
      )),
      reset: loopbackProcedure.mutation(() => (
        participantNetwork.reset()
      )),
    }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

async function resolveDiscoveryError<T>(
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DiscoveryInputError) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error.message,
      });
    }
    throw error;
  }
}

async function resolveParticipantNetworkError<T>(
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ParticipantNetworkInputError) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error.message,
      });
    }
    throw error;
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1'
    || address === '::1'
    || address === '::ffff:127.0.0.1';
}

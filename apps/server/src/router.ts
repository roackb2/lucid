/**
 * tRPC transport boundary for participant-scoped discovery, a narrow operator
 * surface, and loopback-only development ingress. Sequencing and compensation
 * remain in domain services.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  isLoopbackAddress,
} from './auth/authenticator.js';
import { principalHasRole } from './auth/request-principal.js';
import {
  DiscoveryInputError,
  DiscoveryWorkspaceService,
} from './lucid/workspace/service.js';
import {
  ParticipantNetworkInputError,
  ParticipantNetworkService,
} from './lucid/network/service.js';
import { LOCAL_USER_ID } from './lucid/local-participant.js';
import { trpc } from './trpc.js';

const interestInputSchema = z.object({
  content: z.string().trim().min(1).max(1_600),
});

const feedbackInputSchema = z.object({
  findingSequence: z.number().int().positive(),
  content: z.string().trim().min(1).max(1_600),
});

const guidanceInputSchema = z.object({
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

const participantProcedure = trpc.procedure.use(({ ctx, next }) => {
  if (!ctx.principal) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Lucid authentication is required.',
    });
  }
  if (
    !principalHasRole(ctx.principal, 'participant')
    || ctx.principal.participantId !== LOCAL_USER_ID
  ) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This principal cannot access the discovery workspace.',
    });
  }
  return next();
});

const operatorProcedure = trpc.procedure.use(({ ctx, next }) => {
  if (!ctx.principal) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Lucid authentication is required.',
    });
  }
  if (!principalHasRole(ctx.principal, 'operator')) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Lucid operator access is required.',
    });
  }
  return next();
});

const developmentOperatorProcedure = operatorProcedure.use(({ ctx, next }) => {
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
      snapshot: participantProcedure.query(() => discoveryWorkspace.snapshot()),
      saveInterest: participantProcedure
        .input(interestInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryWorkspace.saveInterest(input.content),
        )),
      runNow: participantProcedure.mutation(() => resolveDiscoveryError(
        () => discoveryWorkspace.runNow(),
      )),
      retryCurrentWake: participantProcedure.mutation(() => resolveDiscoveryError(
        () => discoveryWorkspace.retryCurrentWake(),
      )),
      setBackgroundChecksEnabled: participantProcedure
        .input(backgroundChecksInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryWorkspace.setBackgroundChecksEnabled(input.enabled),
        )),
      submitFeedback: participantProcedure
        .input(feedbackInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryWorkspace.submitFeedback(
            input.findingSequence,
            input.content,
          ),
        )),
      submitGuidance: participantProcedure
        .input(guidanceInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryWorkspace.submitGuidance(input.content),
        )),
    }),
    operator: trpc.router({
      backgroundChecks: operatorProcedure.query(() => (
        participantNetwork.backgroundChecks()
      )),
      setGlobalBackgroundChecksEnabled: operatorProcedure
        .input(backgroundChecksInputSchema)
        .mutation(({ input }) => (
          participantNetwork.setGlobalBackgroundChecksEnabled(input.enabled)
        )),
    }),
    development: trpc.router({
      registerParticipant: developmentOperatorProcedure
        .input(participantRegistrationSchema)
        .mutation(({ input }) => resolveParticipantNetworkError(
          () => participantNetwork.registerParticipant(input),
        )),
      submitParticipantInput: developmentOperatorProcedure
        .input(participantInputSchema)
        .mutation(({ input }) => resolveParticipantNetworkError(
          () => participantNetwork.submitParticipantInput(input),
        )),
      setParticipantEnabled: developmentOperatorProcedure
        .input(participantEnabledInputSchema)
        .mutation(({ input }) => resolveParticipantNetworkError(
          () => participantNetwork.setParticipantEnabled(
            input.participantId,
            input.enabled,
          ),
        )),
      retireParticipant: developmentOperatorProcedure
        .input(participantIdSchema)
        .mutation(({ input }) => resolveParticipantNetworkError(
          () => participantNetwork.retireParticipant(input.participantId),
        )),
      diagnostics: developmentOperatorProcedure.query(() => (
        participantNetwork.diagnostics()
      )),
      reset: developmentOperatorProcedure.mutation(() => (
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

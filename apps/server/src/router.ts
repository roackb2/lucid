/**
 * tRPC transport boundary for the discovery workspace.
 * It validates wire input and maps expected user errors to transport errors;
 * sequencing and compensation remain in DiscoveryWorkspaceService.
 */
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  DiscoveryInputError,
  DiscoveryWorkspaceService,
} from './lucid/discovery-workspace-service.js';
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

const assistedParticipantInputSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  privateContext: z.string().trim().min(1).max(4_000),
  contextApproved: z.literal(true),
});

const participantEnabledInputSchema = z.object({
  participantId: z.string().trim().min(1),
  enabled: z.boolean(),
});

const participantInputSchema = z.object({
  participantId: z.string().trim().min(1),
});

const updateAssistedParticipantContextInputSchema = participantInputSchema.extend({
  privateContext: z.string().trim().min(1).max(4_000),
  contextApproved: z.literal(true),
});

export function createAppRouter(
  discoveryWorkspace: DiscoveryWorkspaceService,
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
      setBackgroundChecksEnabled: trpc.procedure
        .input(backgroundChecksInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryWorkspace.setBackgroundChecksEnabled(input.enabled),
        )),
      createAssistedParticipant: trpc.procedure
        .input(assistedParticipantInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryWorkspace.createAssistedParticipant(input),
        )),
      assistedParticipantContext: trpc.procedure
        .input(participantInputSchema)
        .query(({ input }) => resolveDiscoveryError(
          () => discoveryWorkspace.assistedParticipantContext(
            input.participantId,
          ),
        )),
      updateAssistedParticipantContext: trpc.procedure
        .input(updateAssistedParticipantContextInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryWorkspace.updateAssistedParticipantContext(input),
        )),
      pauseSimulatedParticipants: trpc.procedure.mutation(
        () => resolveDiscoveryError(
          () => discoveryWorkspace.pauseSimulatedParticipants(),
        ),
      ),
      setParticipantEnabled: trpc.procedure
        .input(participantEnabledInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryWorkspace.setParticipantEnabled(
            input.participantId,
            input.enabled,
          ),
        )),
      retireParticipant: trpc.procedure
        .input(participantInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryWorkspace.retireParticipant(input.participantId),
        )),
      submitFeedback: trpc.procedure
        .input(feedbackInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryWorkspace.submitFeedback(
            input.findingSequence,
            input.content,
          ),
        )),
      resetWorkspace: trpc.procedure.mutation(() => resolveDiscoveryError(
        () => discoveryWorkspace.resetWorkspace(),
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

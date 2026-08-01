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

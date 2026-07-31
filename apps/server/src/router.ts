import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  DiscoveryInputError,
  DiscoveryRunBusyError,
  DiscoveryRunService,
} from './lucid/discovery-run-service.js';
import { trpc } from './trpc.js';

const interestInputSchema = z.object({
  content: z.string().trim().min(1).max(1_600),
});

const feedbackInputSchema = z.object({
  findingSequence: z.number().int().positive(),
  content: z.string().trim().min(1).max(1_600),
});

export function createAppRouter(discoveryRuns: DiscoveryRunService) {
  return trpc.router({
    system: trpc.router({
      health: trpc.procedure.query(() => ({
        status: 'ok' as const,
        service: 'lucid-discovery',
      })),
    }),
    discovery: trpc.router({
      snapshot: trpc.procedure.query(() => discoveryRuns.snapshot()),
      saveInterest: trpc.procedure
        .input(interestInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryRuns.saveInterest(input.content),
        )),
      startRun: trpc.procedure.mutation(() => resolveDiscoveryError(
        () => discoveryRuns.startRun(),
      )),
      submitFeedback: trpc.procedure
        .input(feedbackInputSchema)
        .mutation(({ input }) => resolveDiscoveryError(
          () => discoveryRuns.submitFeedback(
            input.findingSequence,
            input.content,
          ),
        )),
      cancelRun: trpc.procedure.mutation(() => ({
        cancelled: discoveryRuns.cancelRun(),
      })),
      resetWorkspace: trpc.procedure.mutation(() => resolveDiscoveryError(
        () => discoveryRuns.resetWorkspace(),
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
    if (error instanceof DiscoveryRunBusyError) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: error.message,
      });
    }
    if (error instanceof DiscoveryInputError) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error.message,
      });
    }
    throw error;
  }
}

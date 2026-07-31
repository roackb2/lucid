import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  LucidBusyError,
  LucidInputError,
  LucidService,
} from './lucid/service.js';
import { trpc } from './trpc.js';

const intentInputSchema = z.object({
  content: z.string().trim().min(1).max(1_600),
});

const feedbackInputSchema = z.object({
  returnSequence: z.number().int().positive(),
  content: z.string().trim().min(1).max(1_600),
});

export function createAppRouter(lucid: LucidService) {
  return trpc.router({
    system: trpc.router({
      health: trpc.procedure.query(() => ({
        status: 'ok' as const,
        service: 'lucid-first-return',
      })),
    }),
    lucid: trpc.router({
      snapshot: trpc.procedure.query(() => lucid.snapshot()),
      setIntent: trpc.procedure
        .input(intentInputSchema)
        .mutation(({ input }) => resolveLucidError(
          () => lucid.setIntent(input.content),
        )),
      startJourney: trpc.procedure.mutation(() => resolveLucidError(
        () => lucid.startJourney(),
      )),
      feedback: trpc.procedure
        .input(feedbackInputSchema)
        .mutation(({ input }) => resolveLucidError(
          () => lucid.submitFeedback(input.returnSequence, input.content),
        )),
      cancel: trpc.procedure.mutation(() => ({
        cancelled: lucid.cancelJourney(),
      })),
      reset: trpc.procedure.mutation(() => resolveLucidError(
        () => lucid.reset(),
      )),
    }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

function resolveLucidError<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof LucidBusyError) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: error.message,
      });
    }
    if (error instanceof LucidInputError) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error.message,
      });
    }
    throw error;
  }
}

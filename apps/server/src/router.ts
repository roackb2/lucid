import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import {
  DreamTerrariumService,
  TerrariumBusyError,
} from './terrarium/service.js';
import { trpc } from './trpc.js';

const advanceInputSchema = z.object({
  steps: z.number().int().min(1).max(3),
});

const seedInputSchema = z.object({
  content: z.string().trim().min(1).max(1_200),
});

export function createAppRouter(terrarium: DreamTerrariumService) {
  return trpc.router({
    system: trpc.router({
      health: trpc.procedure.query(() => ({
        status: 'ok' as const,
        service: 'lucid-dream-terrarium',
      })),
    }),
    terrarium: trpc.router({
      snapshot: trpc.procedure.query(() => terrarium.snapshot()),
      seed: trpc.procedure
        .input(seedInputSchema)
        .mutation(({ input }) => terrarium.seed(input.content)),
      advance: trpc.procedure
        .input(advanceInputSchema)
        .mutation(({ input }) => resolveBusyError(
          () => terrarium.startCycle(input.steps),
        )),
      cancel: trpc.procedure.mutation(() => ({
        cancelled: terrarium.cancelCycle(),
      })),
      reset: trpc.procedure.mutation(() => resolveBusyError(
        () => terrarium.reset(),
      )),
    }),
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

function resolveBusyError<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof TerrariumBusyError) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: error.message,
      });
    }
    throw error;
  }
}

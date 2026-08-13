/**
 * tRPC transport boundary for user-scoped discovery, a narrow operator
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
  UserNetworkInputError,
  UserNetworkService,
} from './lucid/network/service.js';
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

const userRegistrationSchema = z.discriminatedUnion('kind', [
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

const userInputSchema = z.object({
  userId: z.string().trim().min(1),
  content: z.string().trim().min(1).max(1_600),
  idempotencyKey: z.string().trim().min(1).max(160),
});

const userEnabledInputSchema = z.object({
  userId: z.string().trim().min(1),
  enabled: z.boolean(),
});

const userIdSchema = z.object({
  userId: z.string().trim().min(1),
});

const userEnrollmentSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  privateContext: z.string().trim().min(1).max(4_000),
  contextApproved: z.literal(true),
});

const authenticatedProcedure = trpc.procedure.use(({ ctx, next }) => {
  if (!ctx.principal) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Lucid authentication is required.',
    });
  }
  return next({ ctx: { ...ctx, principal: ctx.principal } });
});

const userProcedure = trpc.procedure.use(({ ctx, next }) => {
  if (!ctx.principal) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Lucid authentication is required.',
    });
  }
  if (
    !principalHasRole(ctx.principal, 'user')
    || !ctx.principal.userId
  ) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'This principal cannot access the discovery workspace.',
    });
  }
  return next({
    ctx: {
      ...ctx,
      principal: {
        ...ctx.principal,
        userId: ctx.principal.userId,
      },
    },
  });
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
  userNetwork: UserNetworkService,
  options: { allowSelfEnrollment?: boolean } = {},
) {
  return trpc.router({
    system: trpc.router({
      health: trpc.procedure.query(() => ({
        status: 'ok' as const,
        service: 'lucid-discovery',
      })),
    }),
    identity: trpc.router({
      session: authenticatedProcedure.query(({ ctx }) => ({
        status: ctx.principal.userId
          ? 'active' as const
          : 'onboarding-required' as const,
        userId: ctx.principal.userId,
        enrollmentAllowed: options.allowSelfEnrollment === true,
      })),
      enroll: authenticatedProcedure
        .input(userEnrollmentSchema)
        .mutation(({ ctx, input }) => {
          const identity = ctx.principal.externalIdentity;
          if (!options.allowSelfEnrollment || !identity) {
            throw new TRPCError({
              code: 'FORBIDDEN',
              message: 'This deployment does not permit self-enrollment.',
            });
          }
          return resolveUserNetworkError(
            () => userNetwork.enrollAuthenticatedUser({
              ...identity,
              ...input,
            }),
          );
        }),
    }),
    discovery: trpc.router({
      snapshot: userProcedure.query(({ ctx }) => (
        discoveryWorkspace.snapshot(ctx.principal.userId)
      )),
      saveInterest: userProcedure
        .input(interestInputSchema)
        .mutation(({ ctx, input }) => resolveDiscoveryError(
          () => discoveryWorkspace.saveInterest(
            ctx.principal.userId,
            input.content,
          ),
        )),
      runNow: userProcedure.mutation(({ ctx }) => resolveDiscoveryError(
        () => discoveryWorkspace.runNow(ctx.principal.userId),
      )),
      retryCurrentWake: userProcedure.mutation(({ ctx }) => resolveDiscoveryError(
        () => discoveryWorkspace.retryCurrentWake(ctx.principal.userId),
      )),
      setBackgroundChecksEnabled: userProcedure
        .input(backgroundChecksInputSchema)
        .mutation(({ ctx, input }) => resolveDiscoveryError(
          () => discoveryWorkspace.setBackgroundChecksEnabled(
            ctx.principal.userId,
            input.enabled,
          ),
        )),
      submitFeedback: userProcedure
        .input(feedbackInputSchema)
        .mutation(({ ctx, input }) => resolveDiscoveryError(
          () => discoveryWorkspace.submitFeedback(
            ctx.principal.userId,
            input.findingSequence,
            input.content,
          ),
        )),
      submitGuidance: userProcedure
        .input(guidanceInputSchema)
        .mutation(({ ctx, input }) => resolveDiscoveryError(
          () => discoveryWorkspace.submitGuidance(
            ctx.principal.userId,
            input.content,
          ),
        )),
    }),
    operator: trpc.router({
      backgroundChecks: operatorProcedure.query(() => (
        userNetwork.backgroundChecks()
      )),
      setGlobalBackgroundChecksEnabled: operatorProcedure
        .input(backgroundChecksInputSchema)
        .mutation(({ input }) => (
          userNetwork.setGlobalBackgroundChecksEnabled(input.enabled)
        )),
    }),
    development: trpc.router({
      registerUser: developmentOperatorProcedure
        .input(userRegistrationSchema)
        .mutation(({ input }) => resolveUserNetworkError(
          () => userNetwork.registerUser(input),
        )),
      submitUserInput: developmentOperatorProcedure
        .input(userInputSchema)
        .mutation(({ input }) => resolveUserNetworkError(
          () => userNetwork.submitUserInput(input),
        )),
      setUserEnabled: developmentOperatorProcedure
        .input(userEnabledInputSchema)
        .mutation(({ input }) => resolveUserNetworkError(
          () => userNetwork.setUserEnabled(
            input.userId,
            input.enabled,
          ),
        )),
      retireUser: developmentOperatorProcedure
        .input(userIdSchema)
        .mutation(({ input }) => resolveUserNetworkError(
          () => userNetwork.retireUser(input.userId),
        )),
      diagnostics: developmentOperatorProcedure.query(() => (
        userNetwork.diagnostics()
      )),
      reset: developmentOperatorProcedure.mutation(() => (
        userNetwork.reset()
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

async function resolveUserNetworkError<T>(
  operation: () => T | Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof UserNetworkInputError) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: error.message,
      });
    }
    throw error;
  }
}

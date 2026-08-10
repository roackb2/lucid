import type {
  DiscoveryWorkspaceSnapshot,
} from '../../lucid/discovery-types.js';
import type {
  LucidMcpInvocationScope,
  ScopedWorkspaceProjectionReader,
} from './types.js';

export type SingleWorkspaceIdentity = Pick<
  LucidMcpInvocationScope,
  'tenantId' | 'subjectId' | 'productSessionId'
>;

export class WorkspaceProjectionScopeError extends Error {
  readonly name = 'WorkspaceProjectionScopeError';

  constructor() {
    super('The capability cannot access this Lucid workspace.');
  }
}

/**
 * Binds Lucid's current singleton workspace to one configured pilot identity.
 * This is an explicit single-tenant adapter; a multi-tenant product must replace
 * it with a store that resolves the workspace from the verified scope.
 */
export class SingleWorkspaceProjectionReader
implements ScopedWorkspaceProjectionReader {
  constructor(
    private readonly identity: SingleWorkspaceIdentity,
    private readonly source: {
      snapshot(): Promise<DiscoveryWorkspaceSnapshot>;
    },
  ) {}

  async readWorkspaceProjection(input: {
    scope: LucidMcpInvocationScope;
    signal: AbortSignal;
  }): Promise<DiscoveryWorkspaceSnapshot> {
    input.signal.throwIfAborted();
    this.assertScope(input.scope);
    const snapshot = await this.source.snapshot();
    input.signal.throwIfAborted();
    return snapshot;
  }

  private assertScope(scope: LucidMcpInvocationScope): void {
    if (
      scope.tenantId !== this.identity.tenantId
      || scope.subjectId !== this.identity.subjectId
      || scope.productSessionId !== this.identity.productSessionId
    ) {
      throw new WorkspaceProjectionScopeError();
    }
  }
}

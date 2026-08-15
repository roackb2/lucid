import type { McpInvocationScope } from '@heddleagent/execution-host-client/mcp';
import type {
  DiscoveryWorkspaceSnapshot,
} from '../../lucid/discovery-types.js';
import type {
  ScopedWorkspaceProjectionReader,
} from './types.js';

export type UserWorkspaceIdentity = Pick<
  McpInvocationScope,
  'tenantId' | 'productSessionId'
>;

export class WorkspaceProjectionScopeError extends Error {
  readonly name = 'WorkspaceProjectionScopeError';

  constructor() {
    super('The capability cannot access this Lucid workspace.');
  }
}

/**
 * Binds the shared Lucid network to the authenticated user carried in a
 * verified execution capability. The source performs the user-scoped
 * projection; tenant and product-session values stay deployment-owned.
 */
export class UserWorkspaceProjectionReader
implements ScopedWorkspaceProjectionReader {
  constructor(
    private readonly identity: UserWorkspaceIdentity,
    private readonly source: {
      snapshot(userId: string): Promise<DiscoveryWorkspaceSnapshot>;
    },
  ) {}

  async readWorkspaceProjection(input: {
    scope: McpInvocationScope;
    signal: AbortSignal;
  }): Promise<DiscoveryWorkspaceSnapshot> {
    input.signal.throwIfAborted();
    this.assertScope(input.scope);
    const snapshot = await this.source.snapshot(input.scope.subjectId);
    input.signal.throwIfAborted();
    return snapshot;
  }

  private assertScope(scope: McpInvocationScope): void {
    if (
      scope.tenantId !== this.identity.tenantId
      || scope.productSessionId !== this.identity.productSessionId
    ) {
      throw new WorkspaceProjectionScopeError();
    }
  }
}

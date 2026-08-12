import type { McpInvocationScope } from '@roackb2/heddle-adopter/mcp';
import type {
  DiscoveryWorkspaceSnapshot,
} from '../../lucid/discovery-types.js';
import type {
  ScopedWorkspaceProjectionReader,
} from './types.js';

export type ParticipantWorkspaceIdentity = Pick<
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
 * Binds the shared Lucid network to the authenticated participant carried in a
 * verified execution capability. The source performs the participant-scoped
 * projection; tenant and product-session values stay deployment-owned.
 */
export class ParticipantWorkspaceProjectionReader
implements ScopedWorkspaceProjectionReader {
  constructor(
    private readonly identity: ParticipantWorkspaceIdentity,
    private readonly source: {
      snapshot(participantId: string): Promise<DiscoveryWorkspaceSnapshot>;
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

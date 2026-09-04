import type { McpInvocationScope } from '@heddleagent/execution-host-client/mcp';
import type {
  InformationNetworkPublishingService,
} from '../../lucid/information-network/publishing.js';
import type {
  ScopedInformationNetworkPublisher,
} from './types.js';

export type InformationNetworkPublisherIdentity = Pick<
  McpInvocationScope,
  'tenantId' | 'productSessionId'
>;

export class InformationNetworkPublisherScopeError extends Error {
  readonly name = 'InformationNetworkPublisherScopeError';

  constructor() {
    super('The capability cannot publish to this Lucid Information Network.');
  }
}

/** Binds one signed heartbeat invocation to Lucid's publication transaction. */
export class CapabilityScopedInformationNetworkPublisher
implements ScopedInformationNetworkPublisher {
  constructor(
    private readonly identity: InformationNetworkPublisherIdentity,
    private readonly publishing: Pick<
      InformationNetworkPublishingService,
      'publishTextPost'
    >,
  ) {}

  async publishTextPost(
    input: Parameters<
      ScopedInformationNetworkPublisher['publishTextPost']
    >[0],
  ) {
    input.signal.throwIfAborted();
    this.#assertScope(input.scope);
    const receipt = await this.publishing.publishTextPost({
      userId: input.scope.subjectId,
      executionId: input.scope.invocationId,
      draft: input.draft,
    });
    input.signal.throwIfAborted();
    return receipt;
  }

  #assertScope(scope: McpInvocationScope): void {
    if (
      scope.tenantId !== this.identity.tenantId
      || scope.productSessionId !== this.identity.productSessionId
      || scope.workflow !== 'heartbeat-task'
    ) {
      throw new InformationNetworkPublisherScopeError();
    }
  }
}

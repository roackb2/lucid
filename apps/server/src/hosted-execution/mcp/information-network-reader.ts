import type { McpInvocationScope } from '@heddleagent/execution-host-client/mcp';
import type {
  InformationNetworkService,
} from '../../lucid/information-network/service.js';
import type { ScopedInformationNetworkReader } from './types.js';

export type InformationNetworkReaderIdentity = Pick<
  McpInvocationScope,
  'tenantId' | 'productSessionId'
>;

export class InformationNetworkReaderScopeError extends Error {
  readonly name = 'InformationNetworkReaderScopeError';

  constructor() {
    super('The capability cannot read from this Lucid Information Network.');
  }
}

/** Binds Network reads to one signed Lucid heartbeat invocation. */
export class CapabilityScopedInformationNetworkReader
implements ScopedInformationNetworkReader {
  constructor(
    private readonly identity: InformationNetworkReaderIdentity,
    private readonly informationNetwork: Pick<
      InformationNetworkService,
      'searchPosts' | 'post'
    >,
  ) {}

  async searchPosts(
    input: Parameters<ScopedInformationNetworkReader['searchPosts']>[0],
  ) {
    input.signal.throwIfAborted();
    this.#assertScope(input.scope);
    const result = await this.informationNetwork.searchPosts({
      query: input.query,
      limit: input.limit,
    });
    input.signal.throwIfAborted();
    return result;
  }

  async readPost(
    input: Parameters<ScopedInformationNetworkReader['readPost']>[0],
  ) {
    input.signal.throwIfAborted();
    this.#assertScope(input.scope);
    const result = await this.informationNetwork.post(input.postId);
    input.signal.throwIfAborted();
    return result;
  }

  #assertScope(scope: McpInvocationScope): void {
    if (
      scope.tenantId !== this.identity.tenantId
      || scope.productSessionId !== this.identity.productSessionId
      || scope.workflow !== 'heartbeat-task'
    ) {
      throw new InformationNetworkReaderScopeError();
    }
  }
}

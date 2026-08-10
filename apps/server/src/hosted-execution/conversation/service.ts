import type { ExecutionAuthority } from '@roackb2/heddle-adopter/authority';
import {
  CONVERSATION_TURN_WORKFLOW,
} from '@roackb2/heddle-adopter/contracts';
import type { ExecutionHost } from '@roackb2/heddle-adopter/http-sse';
import { pick } from 'lodash';
import { LUCID_PRODUCT_MCP_TOOLS } from '../mcp/types.js';
import type {
  HostedConversationEvent,
  HostedConversationModelCredentialProvider,
  HostedConversationTurnInput,
  HostedConversationTurnRunner,
} from './types.js';

export class HostedConversationConfigurationError extends Error {}

/**
 * Product application service for one externally hosted conversation turn.
 *
 * It fixes Lucid's MCP policy, mints invocation authority, resolves model
 * credentials through a narrow port, and streams the provider-neutral host
 * contract without owning HTTP routes or durable product settlement.
 */
export class HostedConversationTurnService
implements HostedConversationTurnRunner {
  constructor(
    private readonly authority: ExecutionAuthority,
    private readonly executionHost: ExecutionHost,
    private readonly modelCredentials: HostedConversationModelCredentialProvider,
  ) {}

  async *streamTurn(
    input: HostedConversationTurnInput,
  ): AsyncIterable<HostedConversationEvent> {
    input.signal?.throwIfAborted();
    const issued = await this.authority.issue({
      ...pick(input, ['scope', 'runtimeSessionId', 'invocationId']),
      workflow: CONVERSATION_TURN_WORKFLOW,
      mcp: { allowedTools: LUCID_PRODUCT_MCP_TOOLS },
    });
    const mcpCapability = issued.mcpCapability();
    if (!mcpCapability) {
      throw new HostedConversationConfigurationError(
        'Hosted Lucid conversations require an MCP-capable execution authority.',
      );
    }

    const modelApiKey = await this.modelCredentials.resolveModelApiKey(
      pick(input, ['scope', 'invocationId', 'signal']),
    );
    input.signal?.throwIfAborted();

    yield* this.executionHost.streamConversationTurn({
      ...pick(input, [
        'invocationId',
        'runtimeSessionId',
        'prompt',
        'deadlineAt',
        'signal',
      ]),
      executionAssertion: issued.executionAssertion(),
      mcpCapability,
      modelApiKey,
    });
  }
}

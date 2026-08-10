import {
  assertMcpCapabilityActive,
  McpCapabilityVerificationError,
  type VerifiedMcpCapability,
} from '@roackb2/heddle-adopter/mcp';
import { z } from 'zod';
import type {
  McpToolRegistrationContext,
  McpToolset,
} from './streamable-http-service.js';
import {
  READ_WORKSPACE_SNAPSHOT_TOOL,
  type LucidProductMcpToolName,
  type ScopedWorkspaceProjectionReader,
} from './types.js';

/**
 * The model-visible Lucid capabilities exposed to the Execution Host.
 *
 * Add product tools here; protocol parsing, authentication transport, and MCP
 * resource lifecycle belong to StreamableHttpMcpService.
 */
export class LucidProductToolset implements McpToolset<LucidProductMcpToolName> {
  readonly serverInfo = Object.freeze({
    name: 'lucid-product',
    version: '1.0.0',
  });

  private readonly now: () => Date;

  constructor(
    private readonly workspaceReader: ScopedWorkspaceProjectionReader,
    options: { now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  /** Registers exactly the product tools authorized by the signed capability. */
  registerAllowedTools(
    context: McpToolRegistrationContext<LucidProductMcpToolName>,
  ): void {
    const registrations = {
      [READ_WORKSPACE_SNAPSHOT_TOOL]: () => (
        this.registerReadWorkspaceSnapshotTool(context)
      ),
    } satisfies Record<LucidProductMcpToolName, () => void>;

    context.capability.allowedTools.forEach((tool) => registrations[tool]());
  }

  private registerReadWorkspaceSnapshotTool(
    context: McpToolRegistrationContext<LucidProductMcpToolName>,
  ): void {
    context.server.registerTool(
      READ_WORKSPACE_SNAPSHOT_TOOL,
      {
        description:
          'Read the participant-scoped Lucid workspace, current assignment, working direction, findings, and background-check status.',
        inputSchema: z.object({}).strict(),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      async (_input, extra) => this.executeReadWorkspaceSnapshotTool(
        context.capability,
        AbortSignal.any([context.requestSignal, extra.signal]),
      ),
    );
  }

  private async executeReadWorkspaceSnapshotTool(
    capability: VerifiedMcpCapability<LucidProductMcpToolName>,
    signal: AbortSignal,
  ) {
    try {
      signal.throwIfAborted();
      assertMcpCapabilityActive(capability, this.now());
      const snapshot = await this.workspaceReader.readWorkspaceProjection({
        scope: capability.scope,
        signal,
      });
      signal.throwIfAborted();
      assertMcpCapabilityActive(capability, this.now());
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(snapshot),
        }],
      };
    } catch (error) {
      const message = signal.aborted
        ? 'Lucid workspace reading was cancelled.'
        : error instanceof McpCapabilityVerificationError
          ? 'Lucid MCP authority expired.'
          : 'Lucid workspace projection is unavailable.';
      return {
        isError: true,
        content: [{ type: 'text' as const, text: message }],
      };
    }
  }
}

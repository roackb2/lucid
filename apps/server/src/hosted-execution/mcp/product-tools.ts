import {
  defineNodeMcpJsonTool,
  NodeMcpJsonToolset,
} from '@roackb2/heddle-adopter/mcp/node';
import { z } from 'zod';
import {
  READ_WORKSPACE_SNAPSHOT_TOOL,
  type HostedWorkspaceProjection,
  type LucidProductMcpToolName,
  type ScopedWorkspaceProjectionReader,
} from './types.js';

/**
 * Builds the exact model-visible Lucid capabilities exposed to the Execution
 * Host. Generic capability checks, cancellation, safe failures, JSON result
 * projection, HTTP, and MCP resource lifecycle stay in heddle-adopter.
 */
export function createLucidProductToolset(
  workspaceReader: ScopedWorkspaceProjectionReader,
  options: { now?: () => Date } = {},
): NodeMcpJsonToolset<LucidProductMcpToolName> {
  return new NodeMcpJsonToolset({
    serverInfo: {
      name: 'lucid-product',
      version: '1.0.0',
    },
    tools: [defineNodeMcpJsonTool({
      name: READ_WORKSPACE_SNAPSHOT_TOOL,
      description:
        'Read the participant-scoped Lucid workspace, current assignment, working direction, findings, participant background-check preference, and operator dispatch gate.',
      inputSchema: z.object({}).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      failureMessage: 'Lucid workspace projection is unavailable.',
      execute: async (_input, { capability, signal }) => (
        toHostedWorkspaceProjection(
          await workspaceReader.readWorkspaceProjection({
            scope: capability.scope,
            signal,
          }),
        )
      ),
    })],
    ...options,
  });
}

function toHostedWorkspaceProjection(
  snapshot: Awaited<ReturnType<
    ScopedWorkspaceProjectionReader['readWorkspaceProjection']
  >>,
): HostedWorkspaceProjection {
  const {
    backgroundChecksEnabled: _operatorDispatchEnabled,
    ...workspace
  } = snapshot.workspace;
  const {
    enabled: participantChecksEnabled,
    dispatchEnabled: operatorDispatchEnabled,
    ...backgroundChecks
  } = snapshot.backgroundChecks;

  return {
    ...snapshot,
    workspace,
    backgroundChecks: {
      ...backgroundChecks,
      participantChecksEnabled,
      operatorDispatchEnabled,
    },
  };
}

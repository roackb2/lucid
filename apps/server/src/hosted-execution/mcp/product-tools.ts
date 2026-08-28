import {
  defineNodeMcpJsonTool,
  NodeMcpJsonToolset,
} from '@heddleagent/execution-host-client/mcp/node';
import { z } from 'zod';
import {
  postSharedMessageInputSchema,
  readAvailableMessagesInputSchema,
} from '../../lucid/agent/communication/tool-service.js';
import {
  POST_SHARED_MESSAGE_TOOL,
  READ_AVAILABLE_MESSAGES_TOOL,
  READ_WORKSPACE_SNAPSHOT_TOOL,
  type HostedWorkspaceProjection,
  type LucidProductMcpToolName,
  type ScopedAgentWorkToolExecutor,
  type ScopedWorkspaceProjectionReader,
} from './types.js';

/**
 * Builds the exact model-visible Lucid capabilities exposed to the Execution
 * Host. Generic capability checks, cancellation, safe failures, JSON result
 * projection, HTTP, and MCP resource lifecycle stay in the Heddle integration
 * package.
 */
export function createLucidProductToolset(
  workspaceReader: ScopedWorkspaceProjectionReader,
  agentWork: ScopedAgentWorkToolExecutor,
  options: { now?: () => Date } = {},
): NodeMcpJsonToolset<LucidProductMcpToolName> {
  return new NodeMcpJsonToolset({
    serverInfo: {
      name: 'lucid-product',
      version: '1.0.0',
    },
    tools: [
      defineNodeMcpJsonTool({
        name: READ_WORKSPACE_SNAPSHOT_TOOL,
        description:
          'Read the user-scoped Lucid workspace, current Interest, Agent understanding and Activity, Findings, background-check preference, and operator dispatch gate.',
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
      }),
      defineNodeMcpJsonTool({
        name: READ_AVAILABLE_MESSAGES_TOOL,
        description:
          'Read only the messages inside the current durable Lucid work horizon.',
        inputSchema: readAvailableMessagesInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        failureMessage: 'Lucid agent messages are unavailable.',
        execute: async (arguments_, { capability, signal }) => (
          await agentWork.executeAgentWorkTool({
            scope: capability.scope,
            toolName: READ_AVAILABLE_MESSAGES_TOOL,
            arguments: arguments_,
            signal,
          })
        ),
      }),
      defineNodeMcpJsonTool({
        name: POST_SHARED_MESSAGE_TOOL,
        description:
          'Publish the required privacy-minimized Lucid network request for the current claimed work.',
        inputSchema: postSharedMessageInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        failureMessage: 'Lucid could not publish the shared message.',
        execute: async (arguments_, { capability, signal }) => (
          await agentWork.executeAgentWorkTool({
            scope: capability.scope,
            toolName: POST_SHARED_MESSAGE_TOOL,
            arguments: arguments_,
            signal,
          })
        ),
      }),
    ],
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
    enabled: userChecksEnabled,
    dispatchEnabled: operatorDispatchEnabled,
    ...backgroundChecks
  } = snapshot.backgroundChecks;

  return {
    ...snapshot,
    workspace,
    backgroundChecks: {
      ...backgroundChecks,
      userChecksEnabled,
      operatorDispatchEnabled,
    },
  };
}

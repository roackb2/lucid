import {
  defineNodeMcpJsonTool,
  NodeMcpJsonToolset,
} from '@heddleagent/execution-host-client/mcp/node';
import { z } from 'zod';
import {
  directMessageInputSchema,
  findingInputSchema,
  noActionInputSchema,
  postSharedMessageInputSchema,
  readAvailableMessagesInputSchema,
  readOpenRequestsInputSchema,
  workingNoteInputSchema,
} from '../../lucid/agent/communication/tool-service.js';
import {
  sourceBackedTextPostDraftSchema,
} from '../../lucid/information-network/publishing.js';
import {
  FINISH_WITHOUT_ACTION_TOOL,
  POST_SHARED_MESSAGE_TOOL,
  READ_AVAILABLE_MESSAGES_TOOL,
  READ_OPEN_REQUESTS_TOOL,
  READ_WORKSPACE_SNAPSHOT_TOOL,
  READ_WORKING_CONTEXT_TOOL,
  REPORT_FINDING_TOOL,
  SEND_DIRECT_MESSAGE_TOOL,
  UPDATE_WORKING_NOTE_TOOL,
  type HostedWorkspaceProjection,
  type LucidProductMcpToolName,
  PUBLISH_TEXT_POST_TOOL,
  type ScopedAgentWorkToolExecutor,
  type ScopedInformationNetworkPublisher,
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
  informationNetworkPublisher: ScopedInformationNetworkPublisher,
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
        name: READ_WORKING_CONTEXT_TOOL,
        description:
          'Read the private, bounded working context attached to the current Lucid work claim, including principal inputs, prior findings and the latest working note.',
        inputSchema: z.object({}).strict(),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        failureMessage: 'Lucid working context is unavailable.',
        execute: async (_arguments, { capability, signal }) => (
          await agentWork.executeAgentWorkTool({
            scope: capability.scope,
            toolName: READ_WORKING_CONTEXT_TOOL,
            arguments: {},
            signal,
          })
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
        name: READ_OPEN_REQUESTS_TOOL,
        description:
          'Read unanswered peer-authored requests visible inside the current Lucid work claim.',
        inputSchema: readOpenRequestsInputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        failureMessage: 'Lucid open requests are unavailable.',
        execute: async (arguments_, { capability, signal }) => (
          await agentWork.executeAgentWorkTool({
            scope: capability.scope,
            toolName: READ_OPEN_REQUESTS_TOOL,
            arguments: arguments_,
            signal,
          })
        ),
      }),
      defineNodeMcpJsonTool({
        name: UPDATE_WORKING_NOTE_TOOL,
        description:
          'Update the private working note required by guidance in the current claimed Lucid work.',
        inputSchema: workingNoteInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        failureMessage: 'Lucid could not update the working note.',
        execute: async (arguments_, { capability, signal }) => (
          await agentWork.executeAgentWorkTool({
            scope: capability.scope,
            toolName: UPDATE_WORKING_NOTE_TOOL,
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
      defineNodeMcpJsonTool({
        name: SEND_DIRECT_MESSAGE_TOOL,
        description:
          'Send one private reply to an encountered peer when the current user context provides a specific answer.',
        inputSchema: directMessageInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        failureMessage: 'Lucid could not send the direct message.',
        execute: async (arguments_, { capability, signal }) => (
          await agentWork.executeAgentWorkTool({
            scope: capability.scope,
            toolName: SEND_DIRECT_MESSAGE_TOOL,
            arguments: arguments_,
            signal,
          })
        ),
      }),
      defineNodeMcpJsonTool({
        name: REPORT_FINDING_TOOL,
        description:
          'Deliver one specific, peer-sourced connection privately to the current Lucid user with durable provenance.',
        inputSchema: findingInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        failureMessage: 'Lucid could not report the finding.',
        execute: async (arguments_, { capability, signal }) => (
          await agentWork.executeAgentWorkTool({
            scope: capability.scope,
            toolName: REPORT_FINDING_TOOL,
            arguments: arguments_,
            signal,
          })
        ),
      }),
      defineNodeMcpJsonTool({
        name: PUBLISH_TEXT_POST_TOOL,
        description:
          'Publish one source-backed text Post as the Profile represented by the current claimed Lucid Agent wake.',
        inputSchema: sourceBackedTextPostDraftSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        failureMessage: 'Lucid could not publish the text Post.',
        execute: async (draft, { capability, signal }) => (
          await informationNetworkPublisher.publishTextPost({
            scope: capability.scope,
            draft,
            signal,
          })
        ),
      }),
      defineNodeMcpJsonTool({
        name: FINISH_WITHOUT_ACTION_TOOL,
        description:
          'Record an explicit no-action result when the claimed Lucid messages contain no specific match or useful contribution.',
        inputSchema: noActionInputSchema,
        annotations: {
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
        failureMessage: 'Lucid could not record the no-action result.',
        execute: async (arguments_, { capability, signal }) => (
          await agentWork.executeAgentWorkTool({
            scope: capability.scope,
            toolName: FINISH_WITHOUT_ACTION_TOOL,
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

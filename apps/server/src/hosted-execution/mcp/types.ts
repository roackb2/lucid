import type { McpInvocationScope } from '@heddleagent/execution-host-client/mcp';
import type { DiscoveryWorkspaceSnapshot } from '../../lucid/discovery-types.js';
import {
  AGENT_WORK_COMMUNICATION_TOOLS,
  FINISH_WITHOUT_ACTION_TOOL,
  POST_SHARED_MESSAGE_TOOL,
  READ_AVAILABLE_MESSAGES_TOOL,
  READ_OPEN_REQUESTS_TOOL,
  REPORT_FINDING_TOOL,
  SEND_DIRECT_MESSAGE_TOOL,
  UPDATE_WORKING_NOTE_TOOL,
} from '../../lucid/agent/communication/tool-service.js';
import {
  READ_AGENT_WORKING_CONTEXT_TOOL,
  type AgentWorkToolName,
} from '../../lucid/agent/work-service.js';
import {
  PUBLISH_TEXT_POST_TOOL,
} from '../../lucid/information-network/publishing.js';
import type {
  PublishAgentTextPostReceipt,
  SourceBackedTextPostDraft,
} from '../../lucid/information-network/types.js';

export {
  FINISH_WITHOUT_ACTION_TOOL,
  POST_SHARED_MESSAGE_TOOL,
  READ_AVAILABLE_MESSAGES_TOOL,
  READ_OPEN_REQUESTS_TOOL,
  REPORT_FINDING_TOOL,
  SEND_DIRECT_MESSAGE_TOOL,
  UPDATE_WORKING_NOTE_TOOL,
  PUBLISH_TEXT_POST_TOOL,
};

/** Stable workflow-specific product tool names exposed through signed MCP. */
export const READ_WORKSPACE_SNAPSHOT_TOOL = 'read_workspace_snapshot';
export const READ_WORKING_CONTEXT_TOOL = READ_AGENT_WORKING_CONTEXT_TOOL;

export const LUCID_CONVERSATION_MCP_TOOLS = Object.freeze([
  READ_WORKSPACE_SNAPSHOT_TOOL,
] as const);

export const LUCID_HEARTBEAT_MCP_TOOLS = Object.freeze([
  READ_WORKING_CONTEXT_TOOL,
  ...AGENT_WORK_COMMUNICATION_TOOLS,
] as const);

/**
 * Stable raw MCP names which Lucid is willing to expose. A signed capability
 * may only select names from this list; model input can never expand it.
 */
export const LUCID_PRODUCT_MCP_TOOLS = Object.freeze([
  ...LUCID_CONVERSATION_MCP_TOOLS,
  ...LUCID_HEARTBEAT_MCP_TOOLS,
  PUBLISH_TEXT_POST_TOOL,
] as const);

export type LucidProductMcpToolName =
  typeof LUCID_PRODUCT_MCP_TOOLS[number];

/**
 * Model-facing workspace projection with explicit background-check gates.
 *
 * The product domain stores the operator gate on the workspace while the UI
 * view also exposes the user's task preference. Returning both legacy
 * fields made one healthy paused state look contradictory to the agent.
 */
export type HostedWorkspaceProjection = Omit<
  DiscoveryWorkspaceSnapshot,
  'workspace' | 'backgroundChecks'
> & {
  workspace: Omit<
    DiscoveryWorkspaceSnapshot['workspace'],
    'backgroundChecksEnabled'
  >;
  backgroundChecks: Omit<
    DiscoveryWorkspaceSnapshot['backgroundChecks'],
    'enabled' | 'dispatchEnabled'
  > & {
    userChecksEnabled: boolean;
    operatorDispatchEnabled: boolean;
  };
};

/**
 * Product-owned read port. Implementations must resolve the workspace from the
 * verified scope and must not accept identity as model-controlled tool input.
 */
export interface ScopedWorkspaceProjectionReader {
  readWorkspaceProjection(input: {
    scope: McpInvocationScope;
    signal: AbortSignal;
  }): Promise<DiscoveryWorkspaceSnapshot>;
}

/** Product work tools resolve identity only from the verified capability. */
export interface ScopedAgentWorkToolExecutor {
  executeAgentWorkTool(input: {
    scope: McpInvocationScope;
    toolName: AgentWorkToolName;
    arguments: unknown;
    signal: AbortSignal;
  }): Promise<unknown>;
}

/** Source-backed publication resolves authorship from verified execution scope. */
export interface ScopedInformationNetworkPublisher {
  publishTextPost(input: {
    scope: McpInvocationScope;
    draft: SourceBackedTextPostDraft;
    signal: AbortSignal;
  }): Promise<PublishAgentTextPostReceipt>;
}

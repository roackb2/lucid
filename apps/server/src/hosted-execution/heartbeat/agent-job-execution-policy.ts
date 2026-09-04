import type { AgentJobKind } from '../../lucid/agent/jobs/types.js';
import { PUBLISH_TEXT_POST_TOOL } from '../../lucid/information-network/publishing.js';
import {
  LUCID_HEARTBEAT_MCP_TOOLS,
  type LucidProductMcpToolName,
} from '../mcp/types.js';

export type AgentJobExecutionPolicy = {
  runtimeToolPolicy: Readonly<{ allow: readonly string[] }>;
  allowedProductTools: readonly LucidProductMcpToolName[];
};

/**
 * Code-owned capability boundary for each supported Lucid job behavior.
 *
 * Jobs persist user intent, never authority. Adding a new job kind therefore
 * requires an explicit review of both Runtime built-ins and product tools.
 */
export const AGENT_JOB_EXECUTION_POLICIES = Object.freeze({
  'interest-discovery': Object.freeze({
    runtimeToolPolicy: Object.freeze({ allow: Object.freeze([]) }),
    allowedProductTools: LUCID_HEARTBEAT_MCP_TOOLS,
  }),
  'information-network-publishing': Object.freeze({
    runtimeToolPolicy: Object.freeze({
      allow: Object.freeze(['web_search']),
    }),
    allowedProductTools: Object.freeze([PUBLISH_TEXT_POST_TOOL] as const),
  }),
} satisfies Record<AgentJobKind, AgentJobExecutionPolicy>);

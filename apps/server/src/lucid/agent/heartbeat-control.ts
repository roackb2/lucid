import type {
  BackgroundChecksView,
} from '../discovery-types.js';

/** Product operations supported by either heartbeat execution topology. */
export interface AgentHeartbeatControl {
  stop(): Promise<void>;
  snapshot(): Promise<BackgroundChecksView>;
  snapshotForAgent(agentId: string): Promise<BackgroundChecksView>;
  triggerAgent(agentId: string): Promise<void>;
  setGlobalBackgroundChecksEnabled(enabled: boolean): Promise<void>;
  resetWorkspace(): Promise<void>;
  reconcileAgentTasks(): Promise<void>;
  enableAgentTask(agentId: string): Promise<void>;
  disableAgentTasks(agentIds: string[]): Promise<void>;
}

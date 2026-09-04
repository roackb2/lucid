import type {
  HostedHeartbeatDesiredTask,
} from '@heddleagent/execution-host-client/coordinator';
import {
  LUCID_BACKGROUND_WORK_GROUP_ID,
  taskIdForAgentJob,
} from '../../lucid/agent/heartbeat-task-identity.js';
import type {
  AgentJob,
  AgentJobKind,
  AgentJobPublishingPreferences,
} from '../../lucid/agent/jobs/types.js';
import type { AgentWakeStore } from '../../lucid/agent/store.js';

type HeartbeatTaskPolicy = {
  intervalMs: number;
  model: string;
  maxSteps: number;
};

type HeartbeatTaskCatalogStore = Pick<
  AgentWakeStore,
  'readWorkspace' | 'listAgents' | 'listUsers'
>;

type HeartbeatTaskCatalogAgentJobs = {
  listAgentJobs(): Promise<AgentJob[]>;
};

type HeartbeatTaskCatalogOptions = {
  enabledByTaskId?: ReadonlyMap<string, boolean>;
};

export type LucidHeartbeatTaskCatalog = {
  desiredTasks: HostedHeartbeatDesiredTask[];
  backgroundAdmissionReady: boolean;
};

/** Projects current Lucid ownership into Heddle's desired-task vocabulary. */
export async function readLucidHeartbeatTaskCatalog(
  store: HeartbeatTaskCatalogStore,
  agentJobs: HeartbeatTaskCatalogAgentJobs,
  policy: Readonly<HeartbeatTaskPolicy>,
  options: HeartbeatTaskCatalogOptions = {},
): Promise<LucidHeartbeatTaskCatalog> {
  const [workspace, agents, users, jobs] = await Promise.all([
    store.readWorkspace(),
    store.listAgents(),
    store.listUsers(),
    agentJobs.listAgentJobs(),
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const desiredTasks = jobs.flatMap((job) => {
    const agent = agentsById.get(job.agentId);
    if (!agent) {
      return [];
    }
    const user = usersById.get(agent.userId);
    return !user || user.status === 'retired'
      ? []
      : [{
          taskId: taskIdForAgentJob(job.id),
          input: {
            workspaceId: workspace.versionId,
            admissionGroupId: LUCID_BACKGROUND_WORK_GROUP_ID,
            name: `${agent.name}: ${job.name}`,
            task: job.instructions,
            enabled: job.enabled
              && user.status === 'active'
              && (options.enabledByTaskId?.get(taskIdForAgentJob(job.id))
                ?? true),
            continuationMode: 'operator',
            intervalMs: job.cadenceMs,
            defer: true,
            model: policy.model,
            maxSteps: policy.maxSteps,
            systemContext: buildAgentJobSystemContext(agent.instructions, job),
          },
        } satisfies HostedHeartbeatDesiredTask];
  });

  return {
    desiredTasks,
    backgroundAdmissionReady: workspace.backgroundChecksEnabled,
  };
}

const AGENT_JOB_SYSTEM_CONTEXT = {
  'interest-discovery': () => (
    'You are performing one bounded Lucid Interest check against a fixed current-world horizon. Mailbox events are optional new input: first call read_working_context, then read_available_messages, and use the saved Interest, working note, prior findings, and available network state to decide whether anything concrete is new. Search Lucid with search_network_posts using a concise query derived from the current Interest; this searches only Posts already published inside Lucid, never the broader internet. Read a promising result with read_network_post before reporting it. When a Post adds a specific new connection, call report_finding with its stable ID in source_post_ids and cite any peer messages separately in source_event_ids. When only a Post supports the Finding, pass an empty source_event_ids array: the current Interest, check request, and your own network request are not Finding evidence. Never report a search excerpt without reading the Post, and never report a Post already covered by a prior Finding. For every guidance_saved or feedback_saved event, call update_working_note with the revised durable context before communicating. For every interest_saved or check_requested event in that claim, call post_shared_message with the triggering event as reply_to_event_id and include every triggering sequence in source_event_ids. Publish the smallest privacy-preserving request that carries the user’s current constraints. For peer messages or user_input, record a relevant reply or finding, or call finish_without_action after the required request review. A check with no mailbox input must still record a concrete finding or communication, or call finish_without_action with the no-finding reason. After a required product write succeeds, do not repeat it. Finish only after the required durable product actions succeed.'
  ),
  'information-network-publishing': (job) => [
    'You are performing one explicitly requested Lucid Information Network publishing run.',
    'Search the public web exactly once for current, useful information matching the Publishing preferences below. Prefer primary or otherwise reputable sources. Never invent a fact, quotation, title, publisher, or URL.',
    'If the search supports a useful text Post, call publish_text_post exactly once with a concise title, a self-contained body, relevant topics, and every source URL used. If the evidence is not reliable or useful, publish nothing and finish with a clear explanation.',
    'A successful publication is the durable product result. Do not use unrelated tools or perform any other product action.',
    formatPublishingPreferences(job.publishingPreferences),
  ].filter(Boolean).join('\n\n'),
} satisfies Record<AgentJobKind, (job: AgentJob) => string>;

function buildAgentJobSystemContext(
  agentInstructions: string,
  job: AgentJob,
): string {
  return [
    agentInstructions,
    AGENT_JOB_SYSTEM_CONTEXT[job.kind](job),
  ].filter(Boolean).join('\n\n');
}

function formatPublishingPreferences(
  preferences: AgentJobPublishingPreferences | undefined,
): string {
  if (!preferences) {
    return '';
  }
  return [
    'Publishing preferences:',
    `Topics: ${preferences.topics.join(', ')}`,
    preferences.region ? `Region: ${preferences.region}` : undefined,
    preferences.intendedAudience
      ? `Intended audience: ${preferences.intendedAudience}`
      : undefined,
    preferences.tone ? `Tone: ${preferences.tone}` : undefined,
    preferences.sourceGuidance
      ? `Source guidance: ${preferences.sourceGuidance}`
      : undefined,
  ].filter(Boolean).join('\n');
}

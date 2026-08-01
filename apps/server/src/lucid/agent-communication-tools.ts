/**
 * Host-enforced communication boundary for one representative-agent wake.
 *
 * The model receives ordinary-language tools, while this module enforces the
 * facts prompts cannot guarantee: mailbox visibility, the claimed event
 * horizon, causal provenance, per-wake action limits, and retry idempotency.
 * It records delivery and never evaluates whether a claim is true or valuable.
 */
import uniq from 'lodash/uniq.js';
import { z } from 'zod';
import type {
  ToolDefinition,
  ToolPolicyHostContext,
  ToolResult,
} from '@roackb2/heddle';
import {
  LOCAL_USER_ID,
  USER_AGENT_ID,
} from './default-participants.js';
import type { DiscoveryRepository } from './discovery-repository.js';
import type {
  Agent,
  DiscoveryEvent,
  Participant,
} from './discovery-types.js';

const readMessagesInputSchema = z.object({
  after_sequence: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(30).default(15),
});
const sharedMessageInputSchema = z.object({
  content: z.string().trim().min(1).max(900),
  source_event_ids: z.array(z.number().int().positive()).min(1).max(8),
});
const directMessageInputSchema = z.object({
  target_agent_id: z.string().trim().min(1),
  content: z.string().trim().min(1).max(700),
  source_event_ids: z.array(z.number().int().positive()).min(1).max(8),
});
const findingInputSchema = z.object({
  content: z.string().trim().min(1).max(1_200),
  source_event_ids: z.array(z.number().int().positive()).min(1).max(8),
});
const noActionInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

const READ_DISCOVERY_STATE_POLICY = {
  authority: {
    kind: 'host-tool',
    id: 'lucid:discovery-events',
  },
  transport: {
    kind: 'in-process',
    network: false,
  },
  environment: 'local',
  operations: ['read'],
} satisfies ToolPolicyHostContext;

const WRITE_DISCOVERY_STATE_POLICY = {
  ...READ_DISCOVERY_STATE_POLICY,
  operations: ['write'],
} satisfies ToolPolicyHostContext;

/**
 * Grants one representative agent a bounded set of communication operations
 * for one wake. It validates visibility and causal references before
 * writing events, but never scores message truth or usefulness.
 */
export class AgentCommunicationToolService {
  private mutations = 0;

  constructor(
    private readonly repository: DiscoveryRepository,
    private readonly agent: Agent,
    private readonly participant: Participant,
    private readonly wakeId: string,
    private readonly wakeNumber: number,
    private readonly horizonSequence: number,
  ) {}

  async definitions(): Promise<ToolDefinition[]> {
    // Only currently active representatives are addressable. The participant
    // lifecycle therefore constrains both discovery and tool schemas.
    const agents = await this.repository.listActiveAgents();
    const commonTools: ToolDefinition[] = [
      {
        name: 'read_available_messages',
        description:
          'Read shared messages, direct messages, and user input visible to this agent after an event sequence.',
        concurrency: 'parallel-safe',
        capabilities: ['lucid.discovery.read'],
        hostPolicy: READ_DISCOVERY_STATE_POLICY,
        parameters: {
          type: 'object',
          properties: {
            after_sequence: {
              type: 'integer',
              minimum: 0,
              description: 'Defaults to this agent’s durable unread cursor.',
            },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: 30,
              default: 15,
            },
          },
          additionalProperties: false,
        },
        execute: async (input) => this.readAvailableMessages(input),
      },
      {
        name: 'post_shared_message',
        description:
          'Send a concise message to every representative agent. Disclose only the user or participant context needed to find a match.',
        capabilities: ['lucid.discovery.write'],
        hostPolicy: WRITE_DISCOVERY_STATE_POLICY,
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 900 },
            source_event_ids: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: { type: 'integer', minimum: 1 },
              description:
                'Visible event sequences that caused this message and identify its causal thread.',
            },
          },
          required: ['content', 'source_event_ids'],
          additionalProperties: false,
        },
        execute: async (input) => this.postSharedMessage(input),
      },
      {
        name: 'send_direct_message',
        description:
          'Send one private message to another representative agent.',
        capabilities: ['lucid.discovery.write'],
        hostPolicy: WRITE_DISCOVERY_STATE_POLICY,
        parameters: {
          type: 'object',
          properties: {
            target_agent_id: {
              type: 'string',
              enum: agents
                .filter((candidate) => candidate.id !== this.agent.id)
                .map((candidate) => candidate.id),
            },
            content: { type: 'string', minLength: 1, maxLength: 700 },
            source_event_ids: {
              type: 'array',
              minItems: 1,
              maxItems: 8,
              items: { type: 'integer', minimum: 1 },
            },
          },
          required: ['target_agent_id', 'content', 'source_event_ids'],
          additionalProperties: false,
        },
        execute: async (input) => this.sendDirectMessage(input),
      },
      {
        name: 'finish_without_action',
        description:
          'Finish this wake without sending a message. Use this when there is no specific match or useful contribution.',
        capabilities: ['lucid.discovery.write'],
        hostPolicy: WRITE_DISCOVERY_STATE_POLICY,
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string', minLength: 1, maxLength: 500 },
          },
          required: ['reason'],
          additionalProperties: false,
        },
        execute: async (input) => this.finishWithoutAction(input),
      },
    ];

    return this.canReportFinding()
      ? [...commonTools, this.createReportFindingTool()]
      : commonTools;
  }

  private createReportFindingTool(): ToolDefinition {
    return {
      name: 'report_finding',
      description:
        'Report one finding to the local user. It must depend on at least one visible message authored by another agent. Sources prove delivery, not truth.',
      capabilities: ['lucid.discovery.write'],
      hostPolicy: WRITE_DISCOVERY_STATE_POLICY,
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', minLength: 1, maxLength: 1_200 },
          source_event_ids: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            items: { type: 'integer', minimum: 1 },
            description:
              'Visible peer-authored event sequences that caused this finding.',
          },
        },
        required: ['content', 'source_event_ids'],
        additionalProperties: false,
      },
      execute: async (input) => this.reportFinding(input),
    };
  }

  private async readAvailableMessages(input: unknown): Promise<ToolResult> {
    const parsed = readMessagesInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }

    // Reads remain capped at the horizon captured before model execution; tool
    // calls cannot smuggle messages that arrived during this wake into context.
    const [events, agents] = await Promise.all([
      this.repository.listEventsVisibleToAgent(
        this.agent.id,
        parsed.data.after_sequence ?? this.agent.lastSeenSequence,
        parsed.data.limit,
        this.horizonSequence,
      ),
      this.repository.listAgents(),
    ]);
    const agentById = new Map(agents.map((agent) => [agent.id, agent]));

    return {
      ok: true,
      output: {
        events: events.map((event) => projectEvent(event, agentById)),
      },
    };
  }

  private async postSharedMessage(input: unknown): Promise<ToolResult> {
    const parsed = sharedMessageInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }
    const sourceEventIds = uniq(parsed.data.source_event_ids);
    const validationFailure = await this.validateSources(sourceEventIds);
    if (validationFailure) {
      return validationFailure;
    }
    const repeatedContribution = await this.validateThreadContribution(
      sourceEventIds,
    );
    if (repeatedContribution) {
      return repeatedContribution;
    }
    const actionIndex = this.reserveMutation();
    if (typeof actionIndex !== 'number') {
      return actionIndex;
    }

    return eventResult(await this.repository.appendEvent({
      wakeNumber: this.wakeNumber,
      kind: 'shared_message',
      actorAgentId: this.agent.id,
      parentSequence: sourceEventIds[0],
      idempotencyKey: this.actionIdempotencyKey(actionIndex),
      title: `${this.agent.name} posts a shared message`,
      content: parsed.data.content,
      metadata: {
        visibility: 'shared',
        wakeId: this.wakeId,
        sourceEventIds,
      },
    }));
  }

  private async sendDirectMessage(input: unknown): Promise<ToolResult> {
    const parsed = directMessageInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }
    const target = (await this.repository.listActiveAgents())
      .find((candidate) => candidate.id === parsed.data.target_agent_id);
    if (!target) {
      return { ok: false, error: 'The requested agent does not exist.' };
    }
    if (target.id === this.agent.id) {
      return { ok: false, error: 'An agent cannot message itself.' };
    }

    const sourceEventIds = uniq(parsed.data.source_event_ids);
    const validationFailure = await this.validateSources(sourceEventIds);
    if (validationFailure) {
      return validationFailure;
    }
    const repeatedContribution = await this.validateThreadContribution(
      sourceEventIds,
    );
    if (repeatedContribution) {
      return repeatedContribution;
    }
    const actionIndex = this.reserveMutation();
    if (typeof actionIndex !== 'number') {
      return actionIndex;
    }

    return eventResult(await this.repository.appendEvent({
      wakeNumber: this.wakeNumber,
      kind: 'direct_message',
      actorAgentId: this.agent.id,
      targetAgentId: target.id,
      parentSequence: sourceEventIds[0],
      idempotencyKey: this.actionIdempotencyKey(actionIndex),
      title: `${this.agent.name} messages ${target.name}`,
      content: parsed.data.content,
      metadata: {
        visibility: 'target-agent',
        wakeId: this.wakeId,
        sourceEventIds,
      },
    }));
  }

  private async reportFinding(input: unknown): Promise<ToolResult> {
    // Reporting is a privilege of the local user's representative, independent
    // of whether another participant is also a real assisted human.
    if (!this.canReportFinding()) {
      return {
        ok: false,
        error: 'Only the local user’s representative agent can report findings.',
      };
    }

    const parsed = findingInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }
    const sourceEventIds = uniq(parsed.data.source_event_ids);
    const sourceFailure = await this.validateSources(sourceEventIds);
    if (sourceFailure) {
      return sourceFailure;
    }
    // Provenance must be both visible and peer-authored. This proves the network
    // path that produced a finding, not the truth of the underlying message.
    const visibleSources = await this.repository.readVisibleEventsBySequence(
      this.agent.id,
      sourceEventIds,
    );
    const hasPeerMessage = visibleSources.some((event) => (
      event.actorAgentId
      && event.actorAgentId !== this.agent.id
      && ['shared_message', 'direct_message'].includes(event.kind)
    ));
    if (!hasPeerMessage) {
      return {
        ok: false,
        error:
          'A finding must cite at least one visible shared or direct message from another agent.',
      };
    }
    if (await this.repository.hasFindingUsingAnySource(sourceEventIds)) {
      return {
        ok: false,
        error: 'A finding already used one or more of these source messages.',
      };
    }
    const actionIndex = this.reserveMutation();
    if (typeof actionIndex !== 'number') {
      return actionIndex;
    }

    return eventResult(await this.repository.appendEvent({
      wakeNumber: this.wakeNumber,
      kind: 'finding_reported',
      actorAgentId: this.agent.id,
      targetParticipantId: LOCAL_USER_ID,
      parentSequence: sourceEventIds[0],
      idempotencyKey: this.actionIdempotencyKey(actionIndex),
      title: 'Lucid found a possible match',
      content: parsed.data.content,
      metadata: {
        visibility: 'user',
        wakeId: this.wakeId,
        sourceEventIds,
      },
    }));
  }

  private async finishWithoutAction(input: unknown): Promise<ToolResult> {
    const parsed = noActionInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }
    const actionIndex = this.reserveMutation();
    if (typeof actionIndex !== 'number') {
      return actionIndex;
    }

    return eventResult(await this.repository.appendEvent({
      wakeNumber: this.wakeNumber,
      kind: 'agent_wake_no_action',
      actorAgentId: this.agent.id,
      idempotencyKey: this.actionIdempotencyKey(actionIndex),
      title: `${this.agent.name} finishes without sending a message`,
      content: parsed.data.reason,
      metadata: {
        visibility: 'operator',
        wakeId: this.wakeId,
      },
    }));
  }

  private canReportFinding(): boolean {
    return this.agent.id === USER_AGENT_ID;
  }

  private reserveMutation(): number | ToolResult {
    // Reserve before writing so every accepted action gets a stable ordinal for
    // idempotency and a model cannot exceed the host-enforced wake budget.
    if (this.mutations >= 2) {
      return {
        ok: false,
        error:
          'This agent wake already used its two communication actions.',
      };
    }
    this.mutations += 1;
    return this.mutations;
  }

  private actionIdempotencyKey(actionIndex: number): string {
    return `${this.wakeId}:action:${actionIndex}`;
  }

  private async validateSources(
    sourceEventIds: number[],
  ): Promise<ToolResult | undefined> {
    if (!sourceEventIds.length) {
      return undefined;
    }
    // Reject future events first, then verify ordinary mailbox visibility. Both
    // checks are required because a sequence can exist yet be outside this wake.
    const laterEvents = sourceEventIds.filter(
      (sequence) => sequence > this.horizonSequence,
    );
    if (laterEvents.length) {
      return {
        ok: false,
        error: `Source event sequences arrived after this wake was claimed: ${laterEvents.join(', ')}`,
      };
    }
    const visibleSequences = new Set(
      (await this.repository
        .readVisibleEventsBySequence(this.agent.id, sourceEventIds))
        .map((event) => event.sequence),
    );
    const unavailable = sourceEventIds.filter(
      (sequence) => !visibleSequences.has(sequence),
    );
    return unavailable.length
      ? {
          ok: false,
          error: `Unknown or invisible source event sequences: ${unavailable.join(', ')}`,
        }
      : undefined;
  }

  private async validateThreadContribution(
    sourceEventIds: number[],
  ): Promise<ToolResult | undefined> {
    // The repository follows persisted provenance to the causal root; prompt
    // instructions alone cannot stop an agent-to-agent reply loop reliably.
    const alreadyContributed = await this.repository
      .hasAgentContributedToCausalThread(
        this.agent.id,
        sourceEventIds,
        this.wakeId,
      );
    return alreadyContributed
      ? {
          ok: false,
          error:
            'This representative already communicated in the same causal thread. Finish without action unless a new user request starts a new thread.',
        }
      : undefined;
  }
}

function invalidInput(error: z.ZodError): ToolResult {
  return {
    ok: false,
    error: error.issues.map((issue) => issue.message).join('; '),
  };
}

function eventResult(event: DiscoveryEvent): ToolResult {
  return {
    ok: true,
    output: {
      event: {
        sequence: event.sequence,
        kind: event.kind,
        title: event.title,
      },
    },
  };
}

function projectEvent(
  event: DiscoveryEvent,
  agentById: Map<string, Agent>,
) {
  return {
    sequence: event.sequence,
    wakeNumber: event.wakeNumber,
    kind: event.kind,
    actor: event.actorAgentId
      ? agentById.get(event.actorAgentId)?.name ?? event.actorAgentId
      : 'The user or system',
    target: event.targetAgentId
      ? agentById.get(event.targetAgentId)?.name ?? event.targetAgentId
      : undefined,
    title: event.title,
    content: event.content,
    metadata: event.metadata,
  };
}

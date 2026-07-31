import uniq from 'lodash/uniq.js';
import { z } from 'zod';
import type { ToolDefinition, ToolResult } from '@roackb2/heddle';
import { HOME_PRINCIPAL_ID } from './default-network.js';
import type { LucidRepository } from './repository.js';
import type {
  Agent,
  JourneyPhase,
  NetworkEvent,
  Principal,
} from './types.js';

const readNetworkInputSchema = z.object({
  after_sequence: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(30).default(15),
});
const sharedPostInputSchema = z.object({
  content: z.string().trim().min(1).max(900),
  source_event_ids: z.array(z.number().int().positive()).max(8).default([]),
});
const directMessageInputSchema = z.object({
  target_agent_id: z.string().trim().min(1),
  content: z.string().trim().min(1).max(700),
  source_event_ids: z.array(z.number().int().positive()).max(8).default([]),
});
const returnInputSchema = z.object({
  content: z.string().trim().min(1).max(1_200),
  source_event_ids: z.array(z.number().int().positive()).min(1).max(8),
});
const restInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

/**
 * Owns one agent's scoped authority during one journey wake. It validates
 * model input, visibility and source paths before consuming the two-action
 * mutation budget. It never scores the truth or value of message content.
 */
export class AgentNetworkToolService {
  private mutations = 0;

  constructor(
    private readonly repository: LucidRepository,
    private readonly agent: Agent,
    private readonly principal: Principal,
    private readonly phase: JourneyPhase,
    private readonly journeyId: string,
    private readonly tick: number,
  ) {}

  definitions(): ToolDefinition[] {
    const tools: ToolDefinition[] = [
      {
        name: 'read_network',
        description:
          'Read shared posts, direct messages, and principal messages visible to this agent after an event sequence.',
        concurrency: 'parallel-safe',
        capabilities: ['lucid.network.read'],
        parameters: {
          type: 'object',
          properties: {
            after_sequence: {
              type: 'integer',
              minimum: 0,
              description: 'Defaults to this agent’s durable last-seen cursor.',
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
        execute: async (input) => this.readNetwork(input),
      },
      {
        name: 'post_to_commons',
        description:
          'Share a concise ordinary-language message with every agent. Reveal only the principal context necessary for the encounter.',
        capabilities: ['lucid.network.write'],
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 900 },
            source_event_ids: {
              type: 'array',
              maxItems: 8,
              items: { type: 'integer', minimum: 1 },
              description: 'Visible event sequences that caused or support this message.',
            },
          },
          required: ['content'],
          additionalProperties: false,
        },
        execute: async (input) => this.postToCommons(input),
      },
      {
        name: 'send_message',
        description:
          'Send one private ordinary-language message to another agent.',
        capabilities: ['lucid.network.write'],
        parameters: {
          type: 'object',
          properties: {
            target_agent_id: {
              type: 'string',
              enum: this.repository
                .listAgents()
                .filter((candidate) => candidate.id !== this.agent.id)
                .map((candidate) => candidate.id),
            },
            content: { type: 'string', minLength: 1, maxLength: 700 },
            source_event_ids: {
              type: 'array',
              maxItems: 8,
              items: { type: 'integer', minimum: 1 },
            },
          },
          required: ['target_agent_id', 'content'],
          additionalProperties: false,
        },
        execute: async (input) => this.sendMessage(input),
      },
      {
        name: 'rest',
        description:
          'End this wake without creating public noise. Quiet is a valid network action.',
        capabilities: ['lucid.network.write'],
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string', minLength: 1, maxLength: 500 },
          },
          required: ['reason'],
          additionalProperties: false,
        },
        execute: async (input) => this.rest(input),
      },
    ];

    const phaseTools = this.phase === 'returning'
      ? tools.filter(({ name }) => ['read_network', 'rest'].includes(name))
      : tools;

    return this.canReturnToPrincipal()
      ? [
          ...phaseTools,
          {
            name: 'return_to_principal',
            description:
              'Bring one encounter home. It must depend on at least one visible message authored by another agent. This records a delivery path, not a truth or confidence score.',
            capabilities: ['lucid.network.write'],
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
                    'Visible peer-authored event sequences that caused this return.',
                },
              },
              required: ['content', 'source_event_ids'],
              additionalProperties: false,
            },
            execute: async (input) => this.returnToPrincipal(input),
          },
        ]
      : phaseTools;
  }

  private readNetwork(input: unknown): ToolResult {
    const parsed = readNetworkInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }

    const events = this.repository.listVisibleEvents(
      this.agent.id,
      parsed.data.after_sequence ?? this.agent.lastSeenSequence,
      parsed.data.limit,
    );
    const agentsById = new Map(
      this.repository.listAgents().map((agent) => [agent.id, agent]),
    );

    return {
      ok: true,
      output: {
        events: events.map((event) => projectEvent(event, agentsById)),
      },
    };
  }

  private postToCommons(input: unknown): ToolResult {
    const parsed = sharedPostInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }
    const sources = uniq(parsed.data.source_event_ids);
    const sourceFailure = this.validateSources(sources);
    if (sourceFailure) {
      return sourceFailure;
    }
    const budgetFailure = this.reserveMutation();
    if (budgetFailure) {
      return budgetFailure;
    }

    return eventResult(this.repository.appendEvent({
      tick: this.tick,
      kind: 'shared_post',
      actorAgentId: this.agent.id,
      parentSequence: sources[0],
      title: `${this.agent.name} speaks in the commons`,
      content: parsed.data.content,
      metadata: {
        visibility: 'shared',
        journeyId: this.journeyId,
        phase: this.phase,
        sourceEventIds: sources,
      },
    }));
  }

  private sendMessage(input: unknown): ToolResult {
    const parsed = directMessageInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }

    const target = this.repository
      .listAgents()
      .find((candidate) => candidate.id === parsed.data.target_agent_id);
    if (!target) {
      return { ok: false, error: 'The requested agent does not exist.' };
    }
    if (target.id === this.agent.id) {
      return { ok: false, error: 'An agent cannot send a message to itself.' };
    }
    const sources = uniq(parsed.data.source_event_ids);
    const sourceFailure = this.validateSources(sources);
    if (sourceFailure) {
      return sourceFailure;
    }
    const budgetFailure = this.reserveMutation();
    if (budgetFailure) {
      return budgetFailure;
    }

    return eventResult(this.repository.appendEvent({
      tick: this.tick,
      kind: 'direct_message',
      actorAgentId: this.agent.id,
      targetAgentId: target.id,
      parentSequence: sources[0],
      title: `${this.agent.name} sends a private thread to ${target.name}`,
      content: parsed.data.content,
      metadata: {
        visibility: 'target-agent',
        journeyId: this.journeyId,
        phase: this.phase,
        sourceEventIds: sources,
      },
    }));
  }

  private returnToPrincipal(input: unknown): ToolResult {
    if (!this.canReturnToPrincipal()) {
      return { ok: false, error: 'This agent cannot return content in the current phase.' };
    }
    if (this.repository.hasReturnForJourney(this.journeyId)) {
      return { ok: false, error: 'This journey already has a return.' };
    }

    const parsed = returnInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }
    const sources = uniq(parsed.data.source_event_ids);
    const sourceFailure = this.validateSources(sources);
    if (sourceFailure) {
      return sourceFailure;
    }

    const visibleSources = this.repository.readVisibleEventsBySequence(
      this.agent.id,
      sources,
    );
    const hasPeerEncounter = visibleSources.some((event) => (
      event.actorAgentId
      && event.actorAgentId !== this.agent.id
      && ['shared_post', 'direct_message'].includes(event.kind)
    ));
    if (!hasPeerEncounter) {
      return {
        ok: false,
        error:
          'A return must cite at least one visible shared post or direct message authored by another agent.',
      };
    }
    const budgetFailure = this.reserveMutation();
    if (budgetFailure) {
      return budgetFailure;
    }

    return eventResult(this.repository.appendEvent({
      tick: this.tick,
      kind: 'return',
      actorAgentId: this.agent.id,
      targetPrincipalId: HOME_PRINCIPAL_ID,
      parentSequence: sources[0],
      title: `${this.agent.name} brings one encounter home`,
      content: parsed.data.content,
      metadata: {
        visibility: 'principal',
        journeyId: this.journeyId,
        quiet: false,
        sourceEventIds: sources,
      },
    }));
  }

  private rest(input: unknown): ToolResult {
    const parsed = restInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }
    const budgetFailure = this.reserveMutation();
    if (budgetFailure) {
      return budgetFailure;
    }

    return eventResult(this.repository.appendEvent({
      tick: this.tick,
      kind: 'rest',
      actorAgentId: this.agent.id,
      title: `${this.agent.name} chooses quiet`,
      content: parsed.data.reason,
      metadata: {
        visibility: 'operator',
        journeyId: this.journeyId,
        phase: this.phase,
      },
    }));
  }

  private canReturnToPrincipal(): boolean {
    return this.phase === 'returning' && this.principal.kind === 'human';
  }

  private reserveMutation(): ToolResult | undefined {
    if (this.mutations >= 2) {
      return {
        ok: false,
        error:
          'This wake already used its two network-changing actions. Reflect and finish.',
      };
    }
    this.mutations += 1;
    return undefined;
  }

  private validateSources(sourceEventIds: number[]): ToolResult | undefined {
    if (!sourceEventIds.length) {
      return undefined;
    }
    const existingSequences = new Set(
      this.repository
        .readVisibleEventsBySequence(this.agent.id, sourceEventIds)
        .map((event) => event.sequence),
    );
    const missing = sourceEventIds.filter((sequence) => !existingSequences.has(sequence));
    return missing.length
      ? { ok: false, error: `Unknown or invisible source event sequences: ${missing.join(', ')}` }
      : undefined;
  }
}

function invalidInput(error: z.ZodError): ToolResult {
  return {
    ok: false,
    error: error.issues.map((issue) => issue.message).join('; '),
  };
}

function eventResult(event: NetworkEvent): ToolResult {
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
  event: NetworkEvent,
  agentsById: Map<string, Agent>,
) {
  return {
    sequence: event.sequence,
    tick: event.tick,
    kind: event.kind,
    actor: event.actorAgentId
      ? agentsById.get(event.actorAgentId)?.name ?? event.actorAgentId
      : 'The principal or network',
    target: event.targetAgentId
      ? agentsById.get(event.targetAgentId)?.name ?? event.targetAgentId
      : undefined,
    title: event.title,
    content: event.content,
    metadata: event.metadata,
  };
}

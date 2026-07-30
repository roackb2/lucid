import uniq from 'lodash/uniq.js';
import { z } from 'zod';
import type { ToolDefinition, ToolResult } from '@roackb2/heddle';
import type { TerrariumRepository } from './repository.js';
import type { Dreamer, WorldEvent } from './types.js';

const readWorldInputSchema = z.object({
  after_sequence: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(30).default(15),
});
const publishInputSchema = z.object({
  content: z.string().trim().min(1).max(900),
  source_event_ids: z.array(z.number().int().positive()).max(8).default([]),
});
const messageInputSchema = z.object({
  target_dreamer_id: z.string().trim().min(1),
  content: z.string().trim().min(1).max(700),
  source_event_ids: z.array(z.number().int().positive()).max(8).default([]),
});
const beliefInputSchema = z.object({
  claim: z.string().trim().min(1).max(700),
  confidence: z.number().int().min(0).max(100),
  source_event_ids: z.array(z.number().int().positive()).max(8).default([]),
});
const restInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

/**
 * Owns one Dreamer's scoped authority during one wake cycle. It validates all
 * model-provided input, enforces the per-cycle mutation budget, and exposes
 * only Lucid world behavior to Heddle.
 */
export class DreamerWorldToolService {
  private mutations = 0;

  constructor(
    private readonly repository: TerrariumRepository,
    private readonly dreamer: Dreamer,
    private readonly tick: number,
  ) {}

  definitions(): ToolDefinition[] {
    return [
      {
        name: 'read_world',
        description: 'Read visible public events and private messages for this Dreamer after an event sequence.',
        concurrency: 'parallel-safe',
        capabilities: ['lucid.world.read'],
        parameters: {
          type: 'object',
          properties: {
            after_sequence: {
              type: 'integer',
              minimum: 0,
              description: 'Return visible events after this sequence. Defaults to the Dreamer last-seen cursor.',
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
        execute: async (input) => this.readWorld(input),
      },
      {
        name: 'publish_to_world',
        description: 'Publish a concise public post that every Dreamer can see.',
        capabilities: ['lucid.world.write'],
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 900 },
            source_event_ids: {
              type: 'array',
              maxItems: 8,
              items: { type: 'integer', minimum: 1 },
              description: 'Event sequence numbers that support or inspired the post.',
            },
          },
          required: ['content'],
          additionalProperties: false,
        },
        execute: async (input) => this.publish(input),
      },
      {
        name: 'send_message',
        description: 'Send a private message to one other Dreamer.',
        capabilities: ['lucid.world.write'],
        parameters: {
          type: 'object',
          properties: {
            target_dreamer_id: {
              type: 'string',
              enum: this.repository
                .listDreamers()
                .filter((candidate) => candidate.id !== this.dreamer.id)
                .map((candidate) => candidate.id),
            },
            content: { type: 'string', minLength: 1, maxLength: 700 },
            source_event_ids: {
              type: 'array',
              maxItems: 8,
              items: { type: 'integer', minimum: 1 },
            },
          },
          required: ['target_dreamer_id', 'content'],
          additionalProperties: false,
        },
        execute: async (input) => this.sendMessage(input),
      },
      {
        name: 'record_belief',
        description: 'Privately record a current belief, confidence from 0 to 100, and supporting event sequences.',
        capabilities: ['lucid.world.write'],
        parameters: {
          type: 'object',
          properties: {
            claim: { type: 'string', minLength: 1, maxLength: 700 },
            confidence: { type: 'integer', minimum: 0, maximum: 100 },
            source_event_ids: {
              type: 'array',
              maxItems: 8,
              items: { type: 'integer', minimum: 1 },
            },
          },
          required: ['claim', 'confidence'],
          additionalProperties: false,
        },
        execute: async (input) => this.recordBelief(input),
      },
      {
        name: 'rest',
        description: 'End this wake cycle without adding public noise. Record a concise reason for the operator.',
        capabilities: ['lucid.world.write'],
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
  }

  private readWorld(input: unknown): ToolResult {
    const parsed = readWorldInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }

    const events = this.repository.listVisibleEvents(
      this.dreamer.id,
      parsed.data.after_sequence ?? this.dreamer.lastSeenSequence,
      parsed.data.limit,
    );
    const dreamersById = new Map(
      this.repository.listDreamers().map((dreamer) => [dreamer.id, dreamer]),
    );

    return {
      ok: true,
      output: {
        events: events.map((event) => projectEvent(event, dreamersById)),
      },
    };
  }

  private publish(input: unknown): ToolResult {
    const parsed = publishInputSchema.safeParse(input);
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
    const event = this.repository.appendEvent({
      tick: this.tick,
      kind: 'post',
      actorDreamerId: this.dreamer.id,
      parentSequence: sources[0],
      title: `${this.dreamer.name} posts to the commons`,
      content: parsed.data.content,
      metadata: { sourceEventIds: sources },
    });
    return eventResult(event);
  }

  private sendMessage(input: unknown): ToolResult {
    const parsed = messageInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }

    const target = this.repository
      .listDreamers()
      .find((candidate) => candidate.id === parsed.data.target_dreamer_id);
    if (!target) {
      return { ok: false, error: 'The requested Dreamer does not exist.' };
    }
    if (target.id === this.dreamer.id) {
      return { ok: false, error: 'A Dreamer cannot send a private message to itself.' };
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
    const event = this.repository.appendEvent({
      tick: this.tick,
      kind: 'message',
      actorDreamerId: this.dreamer.id,
      targetDreamerId: target.id,
      parentSequence: sources[0],
      title: `${this.dreamer.name} sends a private thread to ${target.name}`,
      content: parsed.data.content,
      metadata: { sourceEventIds: sources },
    });
    return eventResult(event);
  }

  private recordBelief(input: unknown): ToolResult {
    const parsed = beliefInputSchema.safeParse(input);
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
    const event = this.repository.appendEvent({
      tick: this.tick,
      kind: 'belief',
      actorDreamerId: this.dreamer.id,
      parentSequence: sources[0],
      title: `${this.dreamer.name} revises a private belief`,
      content: parsed.data.claim,
      metadata: {
        confidence: parsed.data.confidence,
        sourceEventIds: sources,
      },
    });
    return eventResult(event);
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
      actorDreamerId: this.dreamer.id,
      title: `${this.dreamer.name} chooses quiet`,
      content: parsed.data.reason,
    }));
  }

  private reserveMutation(): ToolResult | undefined {
    if (this.mutations >= 2) {
      return {
        ok: false,
        error: 'This wake cycle has already used its two world-changing actions. Reflect and finish.',
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
        .readVisibleEventsBySequence(this.dreamer.id, sourceEventIds)
        .map((event) => event.sequence),
    );
    const missing = sourceEventIds.filter((sequence) => !existingSequences.has(sequence));
    return missing.length
      ? { ok: false, error: `Unknown source event sequences: ${missing.join(', ')}` }
      : undefined;
  }
}

function invalidInput(error: z.ZodError): ToolResult {
  return {
    ok: false,
    error: error.issues.map((issue) => issue.message).join('; '),
  };
}

function eventResult(event: WorldEvent): ToolResult {
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
  event: WorldEvent,
  dreamersById: Map<string, Dreamer>,
) {
  return {
    sequence: event.sequence,
    tick: event.tick,
    kind: event.kind,
    actor: event.actorDreamerId
      ? dreamersById.get(event.actorDreamerId)?.name ?? event.actorDreamerId
      : 'The operator',
    target: event.targetDreamerId
      ? dreamersById.get(event.targetDreamerId)?.name ?? event.targetDreamerId
      : undefined,
    title: event.title,
    content: event.content,
    metadata: event.metadata,
  };
}

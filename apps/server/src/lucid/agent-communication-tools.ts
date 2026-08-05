/**
 * Host-enforced communication boundary for one representative-agent wake.
 *
 * The model receives ordinary-language tools, while this module enforces the
 * facts prompts cannot guarantee: mailbox visibility, the claimed event
 * horizon, reply routing, content provenance, per-wake action limits, and
 * retry idempotency.
 * It records delivery and never evaluates whether a claim is true or valuable.
 */
import uniq from 'lodash/uniq.js';
import { z } from 'zod';
import type {
  ToolDefinition,
  ToolPolicyHostContext,
  ToolResult,
} from '@roackb2/heddle';
import type { DiscoveryRepository } from './discovery-repository.js';
import type {
  Agent,
  DiscoveryEvent,
  NetworkMessageRole,
  Participant,
} from './discovery-types.js';

const readMessagesInputSchema = z.object({
  after_sequence: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(30).default(15),
});
const sharedMessageInputSchema = z.object({
  reply_to_event_id: z.number().int().positive(),
  content: z.string().trim().min(1).max(900),
  source_event_ids: z.array(z.number().int().positive()).max(8),
});
const directMessageInputSchema = z.object({
  target_agent_id: z.string().trim().min(1),
  reply_to_event_id: z.number().int().positive(),
  content: z.string().trim().min(1).max(700),
  source_event_ids: z.array(z.number().int().positive()).max(8),
});
const findingInputSchema = z.object({
  content: z.string().trim().min(1).max(1_200),
  source_event_ids: z.array(z.number().int().positive()).min(1).max(8),
});
const workingNoteInputSchema = z.object({
  content: z.string().trim().min(1).max(2_400),
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
  writeScope: {
    kind: 'domain',
    resources: ['lucid:discovery-events'],
  },
} satisfies ToolPolicyHostContext;

/**
 * Grants one representative agent a bounded set of communication operations
 * for one wake. It validates visibility, reply targets, and declared content
 * sources before writing events, but never scores message truth or usefulness.
 */
export class AgentCommunicationToolService {
  private mutations = 0;
  private workingNoteUpdated = false;
  private addressableAgentIds = new Set<string>();
  private pendingRequiredRequestSourceIds = new Set<number>();

  constructor(
    private readonly repository: DiscoveryRepository,
    private readonly agent: Agent,
    private readonly participant: Participant,
    private readonly wakeId: string,
    private readonly wakeNumber: number,
    private readonly horizonSequence: number,
    private readonly requiredRequestSourceIds: number[] = [],
  ) {}

  async definitions(): Promise<ToolDefinition[]> {
    // A representative discovers peers from delivered messages, never from a
    // global directory. Shared messages provide the initial introduction.
    const [
      activeAgents,
      visibleEvents,
      persistedMutations,
      satisfiedSources,
    ] = await Promise.all([
      this.repository.listActiveAgents(),
      this.repository.listEventsVisibleToAgent(
        this.agent.id,
        0,
        1_000,
        this.horizonSequence,
      ),
      this.repository.countAgentWakeCommunicationActions(
        this.agent.id,
        this.wakeNumber,
      ),
      Promise.all(uniq(this.requiredRequestSourceIds).map(
        async (sequence) => ({
          sequence,
          satisfied: await this.repository.hasAgentPublishedRequestForTrigger(
            this.agent.id,
            sequence,
          ),
        }),
      )),
    ]);
    // A retry creates a new tool-service instance. Rehydrate both the action
    // ordinal and the mandatory-request state before exposing any write tool.
    this.mutations = persistedMutations;
    this.pendingRequiredRequestSourceIds = new Set(
      satisfiedSources
        .filter(({ satisfied }) => !satisfied)
        .map(({ sequence }) => sequence),
    );
    const encounteredAgentIds = new Set(visibleEvents.flatMap((event) => (
      event.actorAgentId && event.actorAgentId !== this.agent.id
        ? [event.actorAgentId]
        : []
    )));
    const addressableAgents = activeAgents.filter(
      (candidate) => encounteredAgentIds.has(candidate.id),
    );
    this.addressableAgentIds = new Set(
      addressableAgents.map(({ id }) => id),
    );
    const commonTools: ToolDefinition[] = [
      {
        name: 'read_available_messages',
        description:
          'Read shared messages, direct messages, and private principal input visible to this agent after an event sequence.',
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
        name: 'update_working_note',
        description:
          'Replace this representative’s private working note when new participant input, feedback, or a concrete finding changes the ongoing assignment. Preserve what matters, what to avoid, and what to try next in ordinary language. The note is an interpretation, not verified fact.',
        capabilities: ['lucid.discovery.write'],
        hostPolicy: WRITE_DISCOVERY_STATE_POLICY,
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', minLength: 1, maxLength: 2_400 },
          },
          required: ['content'],
          additionalProperties: false,
        },
        execute: async (input) => this.updateWorkingNote(input),
      },
      {
        name: 'post_shared_message',
        description:
          'Publish a concise network request, substantive response, or contribution. reply_to_event_id identifies the request or principal event this message continues. source_event_ids identify the information used in the content. A request representing check_requested must carry its current working constraints instead of only repeating the original interest. When answering a peer request, contribute this participant’s own context instead of relaying another representative’s answer. Never post merely to say that no match or example is available.',
        capabilities: ['lucid.discovery.write'],
        hostPolicy: WRITE_DISCOVERY_STATE_POLICY,
        parameters: {
          type: 'object',
          properties: {
            reply_to_event_id: {
              type: 'integer',
              minimum: 1,
              description:
                'The visible request or principal event this message directly answers or represents.',
            },
            content: { type: 'string', minLength: 1, maxLength: 900 },
            source_event_ids: {
              type: 'array',
              minItems: 0,
              maxItems: 8,
              items: { type: 'integer', minimum: 1 },
              description:
                'Visible events whose information is used in the message. Include every peer message being repeated or summarized. Use an empty array when the contribution comes only from this participant’s supplied private context. These references establish provenance, not the reply thread.',
            },
          },
          required: ['reply_to_event_id', 'content', 'source_event_ids'],
          additionalProperties: false,
        },
        execute: async (input) => this.postSharedMessage(input),
      },
      ...(addressableAgents.length ? [{
        name: 'send_direct_message',
        description:
          'Send one private reply to an encountered representative when this participant’s context provides a specific answer or follow-up.',
        capabilities: ['lucid.discovery.write'],
        hostPolicy: WRITE_DISCOVERY_STATE_POLICY,
        parameters: {
          type: 'object',
          properties: {
            target_agent_id: {
              type: 'string',
              enum: addressableAgents.map((candidate) => candidate.id),
            },
            reply_to_event_id: {
              type: 'integer',
              minimum: 1,
              description: 'The visible peer message this direct message answers.',
            },
            content: { type: 'string', minLength: 1, maxLength: 700 },
            source_event_ids: {
              type: 'array',
              minItems: 0,
              maxItems: 8,
              items: { type: 'integer', minimum: 1 },
              description:
                'Visible events whose information is used in the response. Use an empty array when the response comes only from this participant’s supplied private context.',
            },
          },
          required: [
            'target_agent_id',
            'reply_to_event_id',
            'content',
            'source_event_ids',
          ],
          additionalProperties: false,
        },
        execute: async (input) => this.sendDirectMessage(input),
      } satisfies ToolDefinition] : []),
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

    return [...commonTools, this.createReportFindingTool()];
  }

  private createReportFindingTool(): ToolDefinition {
    return {
      name: 'report_finding',
      description:
        'Deliver one specific peer-sourced connection privately to this agent’s own participant. This does not reply to the source agent. State what the source contributed and why it may relate, without declaring it useful, validated, or a successful match. Sources prove delivery, not truth.',
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

  private async updateWorkingNote(input: unknown): Promise<ToolResult> {
    const parsed = workingNoteInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }
    if (this.workingNoteUpdated) {
      return {
        ok: false,
        error: 'The private working note can be replaced only once per wake.',
      };
    }

    // This internal state update has its own retry-stable key and does not
    // consume the two-action communication budget. Its horizon metadata lets
    // later readers distinguish the derived note from raw source events.
    const event = await this.repository.appendEvent({
      wakeNumber: this.wakeNumber,
      kind: 'representative_note_updated',
      actorAgentId: this.agent.id,
      targetAgentId: this.agent.id,
      targetParticipantId: this.participant.id,
      idempotencyKey: `${this.wakeId}:working-note`,
      title: `${this.agent.name} updates its private working note`,
      content: parsed.data.content,
      metadata: {
        visibility: 'participant-and-agent',
        wakeId: this.wakeId,
        throughSequence: this.horizonSequence,
        derived: true,
      },
    });
    this.workingNoteUpdated = true;
    return eventResult(event);
  }

  private async postSharedMessage(input: unknown): Promise<ToolResult> {
    const parsed = sharedMessageInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }
    const sourceEventIds = uniq(parsed.data.source_event_ids);
    const prerequisiteFailure = this.validateRequiredRequestSources(
      parsed.data.reply_to_event_id,
      sourceEventIds,
    );
    if (prerequisiteFailure) {
      return prerequisiteFailure;
    }
    const validationFailure = await this.validateSources(sourceEventIds);
    if (validationFailure) {
      return validationFailure;
    }
    const replyToEvent = await this.validateReplyTo(
      parsed.data.reply_to_event_id,
    );
    if (!replyToEvent.ok) {
      return replyToEvent.error;
    }
    const referenceFailure = this.validateTextEventReferences(
      parsed.data.content,
      parsed.data.reply_to_event_id,
      sourceEventIds,
    );
    if (referenceFailure) {
      return referenceFailure;
    }
    const repeatedContribution = await this.validateThreadContribution(
      parsed.data.reply_to_event_id,
    );
    if (repeatedContribution) {
      return repeatedContribution;
    }
    const idempotencyKey = this.reserveSharedMessage(sourceEventIds);
    if (typeof idempotencyKey !== 'string') {
      return idempotencyKey;
    }

    const event = await this.repository.appendEvent({
      wakeNumber: this.wakeNumber,
      kind: 'shared_message',
      actorAgentId: this.agent.id,
      replyToSequence: parsed.data.reply_to_event_id,
      idempotencyKey,
      title: `${this.agent.name} posts a shared message`,
      content: parsed.data.content,
      metadata: {
        visibility: 'shared',
        wakeId: this.wakeId,
        sourceEventIds,
        messageRole: networkMessageRoleFor(replyToEvent.event),
      },
    });
    sourceEventIds.forEach((sequence) => {
      this.pendingRequiredRequestSourceIds.delete(sequence);
    });
    return eventResult(event);
  }

  private async sendDirectMessage(input: unknown): Promise<ToolResult> {
    const parsed = directMessageInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }
    const prerequisiteFailure = this.requireNetworkRequestFirst();
    if (prerequisiteFailure) {
      return prerequisiteFailure;
    }
    if (!this.addressableAgentIds.has(parsed.data.target_agent_id)) {
      return {
        ok: false,
        error:
          'Direct messages can be sent only to a peer encountered through a visible message.',
      };
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
    const replyToEvent = await this.validateReplyTo(
      parsed.data.reply_to_event_id,
    );
    if (!replyToEvent.ok) {
      return replyToEvent.error;
    }
    if (
      !['shared_message', 'direct_message'].includes(replyToEvent.event.kind)
      || replyToEvent.event.actorAgentId !== target.id
    ) {
      return {
        ok: false,
        error:
          'A direct message must reply to a visible message authored by its target representative.',
      };
    }
    const referenceFailure = this.validateTextEventReferences(
      parsed.data.content,
      parsed.data.reply_to_event_id,
      sourceEventIds,
    );
    if (referenceFailure) {
      return referenceFailure;
    }
    const repeatedContribution = await this.validateThreadContribution(
      parsed.data.reply_to_event_id,
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
      replyToSequence: parsed.data.reply_to_event_id,
      idempotencyKey: this.actionIdempotencyKey(actionIndex),
      title: `${this.agent.name} messages ${target.name}`,
      content: parsed.data.content,
      metadata: {
        visibility: 'target-agent',
        wakeId: this.wakeId,
        sourceEventIds,
        messageRole: 'response',
      },
    }));
  }

  private async reportFinding(input: unknown): Promise<ToolResult> {
    const parsed = findingInputSchema.safeParse(input);
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }
    const prerequisiteFailure = this.requireNetworkRequestFirst();
    if (prerequisiteFailure) {
      return prerequisiteFailure;
    }
    const sourceEventIds = uniq(parsed.data.source_event_ids);
    const sourceFailure = await this.validateSources(sourceEventIds);
    if (sourceFailure) {
      return sourceFailure;
    }
    const referenceFailure = this.validateTextEventReferences(
      parsed.data.content,
      undefined,
      sourceEventIds,
    );
    if (referenceFailure) {
      return referenceFailure;
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
    if (await this.repository.hasParticipantFindingUsingAnyOrigin(
      this.participant.id,
      sourceEventIds,
    )) {
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
      targetParticipantId: this.participant.id,
      idempotencyKey: this.actionIdempotencyKey(actionIndex),
      title: `New finding for ${this.participant.displayName}`,
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
    const prerequisiteFailure = this.requireNetworkRequestFirst();
    if (prerequisiteFailure) {
      return prerequisiteFailure;
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

  private reserveSharedMessage(
    sourceEventIds: number[],
  ): string | ToolResult {
    const requiredSources = [...this.pendingRequiredRequestSourceIds];
    const satisfiesRequiredRequest = requiredSources.length > 0
      && requiredSources.every((sequence) => sourceEventIds.includes(sequence));

    if (satisfiesRequiredRequest && this.mutations >= 2) {
      // Older Lucid versions could persist two actions before discovering that
      // the required request was missing. Give that invalid wake one stable
      // repair slot; new wakes cannot reach this branch because writes are now
      // gated before they consume the ordinary two-action budget.
      const sourceKey = requiredSources
        .sort((left, right) => left - right)
        .join('-');
      return `${this.wakeId}:required-request:${sourceKey}`;
    }

    const actionIndex = this.reserveMutation();
    return typeof actionIndex === 'number'
      ? this.actionIdempotencyKey(actionIndex)
      : actionIndex;
  }

  private validateRequiredRequestSources(
    replyToSequence: number,
    sourceEventIds: number[],
  ): ToolResult | undefined {
    const requiredSources = [...this.pendingRequiredRequestSourceIds]
      .sort((left, right) => left - right);
    const missingSources = requiredSources
      .filter((sequence) => !sourceEventIds.includes(sequence));
    if (missingSources.length) {
      return this.requiredNetworkRequestError();
    }
    const latestRequiredSource = requiredSources.at(-1);
    return latestRequiredSource && replyToSequence !== latestRequiredSource
      ? {
          ok: false,
          error:
            `The required network request must reply to the latest assignment or check event: #${latestRequiredSource}.`,
        }
      : undefined;
  }

  private requireNetworkRequestFirst(): ToolResult | undefined {
    return this.pendingRequiredRequestSourceIds.size
      ? this.requiredNetworkRequestError()
      : undefined;
  }

  private requiredNetworkRequestError(): ToolResult {
    const sourceReferences = [...this.pendingRequiredRequestSourceIds]
      .sort((left, right) => left - right)
      .map((sequence) => `#${sequence}`)
      .join(', ');
    return {
      ok: false,
      error:
        `First use post_shared_message and cite every required assignment or check event: ${sourceReferences}. Other communication actions remain unavailable until that network request is recorded.`,
    };
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

  private async validateReplyTo(
    replyToSequence: number,
  ): Promise<
    | { ok: true; event: DiscoveryEvent }
    | { ok: false; error: ToolResult }
  > {
    if (replyToSequence > this.horizonSequence) {
      return {
        ok: false,
        error: {
          ok: false,
          error:
            `Reply target arrived after this wake was claimed: ${replyToSequence}`,
        },
      };
    }
    const event = (await this.repository.readVisibleEventsBySequence(
      this.agent.id,
      [replyToSequence],
    ))[0];
    return event
      ? { ok: true, event }
      : {
          ok: false,
          error: {
            ok: false,
            error: `Unknown or invisible reply target: ${replyToSequence}`,
          },
        };
  }

  private validateTextEventReferences(
    content: string,
    replyToSequence: number | undefined,
    sourceEventIds: number[],
  ): ToolResult | undefined {
    const declaredReferences = new Set([
      ...(replyToSequence ? [replyToSequence] : []),
      ...sourceEventIds,
    ]);
    const missingReferences = readTextEventReferences(content)
      .filter((sequence) => !declaredReferences.has(sequence));
    return missingReferences.length
      ? {
          ok: false,
          error:
            `Message text references events that are neither the reply target nor content sources: ${missingReferences.map((sequence) => `#${sequence}`).join(', ')}`,
        }
      : undefined;
  }

  private async validateThreadContribution(
    replyToSequence: number,
  ): Promise<ToolResult | undefined> {
    // The repository follows the persisted reply chain to the request root;
    // content provenance cannot accidentally merge unrelated conversations.
    const alreadyContributed = await this.repository
      .hasAgentContributedToRequestThread(
        this.agent.id,
        replyToSequence,
        this.wakeId,
      );
    return alreadyContributed
      ? {
          ok: false,
          error:
            'This representative already communicated in the same request thread. Finish without action unless a new user request starts a new thread.',
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
    replyToSequence: event.replyToSequence,
    title: event.title,
    content: event.content,
    metadata: event.metadata,
  };
}

function networkMessageRoleFor(
  replyToEvent: DiscoveryEvent,
): NetworkMessageRole {
  if (
    replyToEvent.kind === 'interest_saved'
    || replyToEvent.kind === 'check_requested'
  ) {
    return 'request';
  }
  if (
    replyToEvent.kind === 'shared_message'
    || replyToEvent.kind === 'direct_message'
  ) {
    return 'response';
  }
  return 'contribution';
}

function readTextEventReferences(content: string): number[] {
  return uniq([...content.matchAll(/(?:^|[^\w])#(\d+)\b/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isSafeInteger));
}

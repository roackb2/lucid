import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  ne,
  or,
} from 'drizzle-orm';
import type { LucidDatabaseService } from '../database/service.js';
import {
  agents,
  networkEvents,
  networkStates,
  principals,
} from '../database/schema.js';
import {
  DEFAULT_AGENTS,
  DEFAULT_PRINCIPALS,
  HOME_AGENT_ID,
  HOME_PRINCIPAL_ID,
} from './default-network.js';
import {
  agentStatusSchema,
  networkEventKindSchema,
  principalKindSchema,
  type Agent,
  type AgentView,
  type JourneyPhase,
  type NetworkEvent,
  type NetworkEventKind,
  type NetworkEventMetadata,
  type NetworkState,
  type Principal,
  type PrincipalView,
  type ReturnView,
  type WakeContext,
} from './types.js';

const NETWORK_ID = 'lucid-local';
const SNAPSHOT_EVENT_LIMIT = 220;
const RETURN_LIMIT = 12;

type AgentRow = typeof agents.$inferSelect;
type NetworkEventRow = typeof networkEvents.$inferSelect;
type NetworkStateRow = typeof networkStates.$inferSelect;
type PrincipalRow = typeof principals.$inferSelect;

export type AppendNetworkEventInput = {
  tick?: number;
  kind: NetworkEventKind;
  actorAgentId?: string;
  targetAgentId?: string;
  targetPrincipalId?: string;
  parentSequence?: number;
  title: string;
  content: string;
  metadata?: NetworkEventMetadata;
};

export type LucidRepositorySnapshot = {
  network: NetworkState;
  principal: PrincipalView;
  agents: AgentView[];
  intent?: NetworkEvent;
  returns: ReturnView[];
  events: NetworkEvent[];
};

/**
 * Owns Lucid's enforceable network facts: principal-to-agent ownership,
 * event visibility, delivery, causal source references, and durable cursors.
 * It never interprets whether ordinary-language content is true or valuable.
 */
export class LucidRepository {
  constructor(private readonly database: LucidDatabaseService) {}

  initialize(): void {
    const network = this.findNetworkState();
    if (network) {
      this.recoverInterruptedWakes(network);
      return;
    }

    this.createFreshNetwork();
  }

  reset(): void {
    this.database.client.transaction(() => {
      this.database.orm.delete(networkStates).run();
      this.database.client
        .prepare("DELETE FROM sqlite_sequence WHERE name = 'network_events'")
        .run();
      this.insertFreshNetwork();
    })();
  }

  readSnapshot(): LucidRepositorySnapshot {
    const network = this.requireNetworkState();
    const homePrincipal = this.requirePrincipal(HOME_PRINCIPAL_ID);
    const allPrincipals = this.listPrincipals();
    const principalsById = new Map(allPrincipals.map((principal) => [principal.id, principal]));
    const allAgents = this.listAgents();
    const latestEvents = this.database.orm
      .select()
      .from(networkEvents)
      .where(eq(networkEvents.networkId, NETWORK_ID))
      .orderBy(desc(networkEvents.sequence))
      .limit(SNAPSHOT_EVENT_LIMIT)
      .all()
      .reverse()
      .map(toNetworkEvent);

    return {
      network,
      principal: toPrincipalView(homePrincipal),
      agents: allAgents.map((agent) => {
        const principal = principalsById.get(agent.principalId);
        if (!principal) {
          throw new Error(`Principal not found for agent ${agent.id}: ${agent.principalId}`);
        }
        const {
          persona: _persona,
          conversationId: _conversationId,
          lastSeenSequence: _lastSeenSequence,
          ...view
        } = agent;
        return {
          ...view,
          principal: toPrincipalView(principal),
          unreadCount: this.listVisibleEvents(agent.id, agent.lastSeenSequence, 10_000).length,
          isHomeAgent: agent.id === HOME_AGENT_ID,
        };
      }),
      intent: this.findLatestIntent(),
      returns: this.listReturns(),
      events: latestEvents,
    };
  }

  listPrincipals(): Principal[] {
    return this.database.orm
      .select()
      .from(principals)
      .where(eq(principals.networkId, NETWORK_ID))
      .orderBy(asc(principals.createdAt))
      .all()
      .map(toPrincipal);
  }

  listAgents(): Agent[] {
    return this.database.orm
      .select()
      .from(agents)
      .where(eq(agents.networkId, NETWORK_ID))
      .orderBy(asc(agents.sortOrder))
      .all()
      .map(toAgent);
  }

  requirePrincipal(id: string): Principal {
    const row = this.database.orm
      .select()
      .from(principals)
      .where(and(eq(principals.networkId, NETWORK_ID), eq(principals.id, id)))
      .get();
    if (!row) {
      throw new Error(`Principal not found: ${id}`);
    }
    return toPrincipal(row);
  }

  requireAgent(id: string): Agent {
    const row = this.database.orm
      .select()
      .from(agents)
      .where(and(eq(agents.networkId, NETWORK_ID), eq(agents.id, id)))
      .get();
    if (!row) {
      throw new Error(`Agent not found: ${id}`);
    }
    return toAgent(row);
  }

  requireHomeAgent(): Agent {
    return this.requireAgent(HOME_AGENT_ID);
  }

  findLatestIntent(): NetworkEvent | undefined {
    const row = this.database.orm
      .select()
      .from(networkEvents)
      .where(and(
        eq(networkEvents.networkId, NETWORK_ID),
        eq(networkEvents.kind, 'intent'),
        eq(networkEvents.targetAgentId, HOME_AGENT_ID),
        eq(networkEvents.targetPrincipalId, HOME_PRINCIPAL_ID),
      ))
      .orderBy(desc(networkEvents.sequence))
      .get();
    return row ? toNetworkEvent(row) : undefined;
  }

  setIntent(content: string): NetworkEvent {
    return this.appendEvent({
      kind: 'intent',
      targetAgentId: HOME_AGENT_ID,
      targetPrincipalId: HOME_PRINCIPAL_ID,
      title: 'You tell Aster what to keep noticing',
      content,
      metadata: {
        visibility: 'principal-and-agent',
        source: 'principal',
      },
    });
  }

  submitFeedback(returnSequence: number, content: string): NetworkEvent {
    const returnEvent = this.requirePrincipalReturn(returnSequence);
    const existing = this.database.orm
      .select({ sequence: networkEvents.sequence })
      .from(networkEvents)
      .where(and(
        eq(networkEvents.networkId, NETWORK_ID),
        eq(networkEvents.kind, 'feedback'),
        eq(networkEvents.parentSequence, returnSequence),
      ))
      .get();
    if (existing) {
      throw new Error('This return already has feedback.');
    }

    return this.appendEvent({
      kind: 'feedback',
      targetAgentId: HOME_AGENT_ID,
      targetPrincipalId: HOME_PRINCIPAL_ID,
      parentSequence: returnEvent.sequence,
      title: 'You correct what Aster should notice next',
      content,
      metadata: {
        visibility: 'principal-and-agent',
        returnSequence,
      },
    });
  }

  listVisibleEvents(agentId: string, afterSequence: number, limit = 40): NetworkEvent[] {
    return this.database.orm
      .select()
      .from(networkEvents)
      .where(and(
        eq(networkEvents.networkId, NETWORK_ID),
        gt(networkEvents.sequence, afterSequence),
        or(
          eq(networkEvents.kind, 'origin'),
          and(
            eq(networkEvents.kind, 'shared_post'),
            ne(networkEvents.actorAgentId, agentId),
          ),
          and(
            eq(networkEvents.kind, 'direct_message'),
            eq(networkEvents.targetAgentId, agentId),
          ),
          and(
            inArray(networkEvents.kind, ['intent', 'feedback']),
            eq(networkEvents.targetAgentId, agentId),
          ),
        ),
      ))
      .orderBy(asc(networkEvents.sequence))
      .limit(limit)
      .all()
      .map(toNetworkEvent);
  }

  readVisibleEventsBySequence(agentId: string, sequences: number[]): NetworkEvent[] {
    if (!sequences.length) {
      return [];
    }

    return this.database.orm
      .select()
      .from(networkEvents)
      .where(and(
        eq(networkEvents.networkId, NETWORK_ID),
        inArray(networkEvents.sequence, sequences),
        or(
          eq(networkEvents.kind, 'origin'),
          eq(networkEvents.kind, 'shared_post'),
          and(
            eq(networkEvents.kind, 'direct_message'),
            eq(networkEvents.targetAgentId, agentId),
          ),
          and(
            inArray(networkEvents.kind, ['intent', 'feedback']),
            eq(networkEvents.targetAgentId, agentId),
          ),
        ),
      ))
      .orderBy(asc(networkEvents.sequence))
      .all()
      .map(toNetworkEvent);
  }

  beginWake(agentId: string, journeyId: string, phase: JourneyPhase): WakeContext {
    const network = this.requireNetworkState();
    const selectedAgent = this.requireAgent(agentId);
    const principal = this.requirePrincipal(selectedAgent.principalId);
    const visibleEvents = this.listVisibleEvents(
      selectedAgent.id,
      selectedAgent.lastSeenSequence,
    );
    const horizonSequence = visibleEvents.at(-1)?.sequence ?? selectedAgent.lastSeenSequence;
    const tick = network.currentTick + 1;
    const now = dayjs().toISOString();

    this.database.orm.transaction((transaction) => {
      transaction
        .update(networkStates)
        .set({
          currentTick: tick,
          updatedAt: now,
        })
        .where(eq(networkStates.id, NETWORK_ID))
        .run();
      transaction
        .update(agents)
        .set({
          status: 'waking',
          wakeCount: selectedAgent.wakeCount + 1,
          lastAwakeAt: now,
          updatedAt: now,
        })
        .where(eq(agents.id, selectedAgent.id))
        .run();
      transaction
        .insert(networkEvents)
        .values({
          id: `event_${randomUUID()}`,
          networkId: NETWORK_ID,
          tick,
          kind: 'wake',
          actorAgentId: selectedAgent.id,
          title: `${selectedAgent.name} enters the network`,
          content: visibleEvents.length
            ? `${visibleEvents.length} unread ${visibleEvents.length === 1 ? 'event is' : 'events are'} available in this ${phase} phase.`
            : `The ${phase} phase begins without unread network events.`,
          metadata: {
            visibility: 'operator',
            visibleEventSequences: visibleEvents.map((event) => event.sequence),
            horizonSequence,
            journeyId,
            phase,
          },
          createdAt: now,
        })
        .run();
    });

    return {
      agent: {
        ...selectedAgent,
        status: 'waking',
        wakeCount: selectedAgent.wakeCount + 1,
        lastAwakeAt: now,
        updatedAt: now,
      },
      principal,
      phase,
      journeyId,
      tick,
      visibleEvents,
      horizonSequence,
    };
  }

  completeWake(agentId: string, horizonSequence: number): void {
    const agent = this.requireAgent(agentId);
    this.database.orm
      .update(agents)
      .set({
        status: 'resting',
        lastSeenSequence: Math.max(agent.lastSeenSequence, horizonSequence),
        updatedAt: dayjs().toISOString(),
      })
      .where(eq(agents.id, agentId))
      .run();
  }

  failWake(agentId: string): void {
    this.database.orm
      .update(agents)
      .set({
        status: 'error',
        updatedAt: dayjs().toISOString(),
      })
      .where(eq(agents.id, agentId))
      .run();
  }

  interruptWake(agentId: string): void {
    this.database.orm
      .update(agents)
      .set({
        status: 'resting',
        updatedAt: dayjs().toISOString(),
      })
      .where(eq(agents.id, agentId))
      .run();
  }

  hasReturnForJourney(journeyId: string): boolean {
    return Boolean(this.findReturnForJourney(journeyId));
  }

  ensureQuietReturn(journeyId: string, tick: number): NetworkEvent {
    const existing = this.findReturnForJourney(journeyId);
    if (existing) {
      return existing;
    }

    return this.appendEvent({
      tick,
      kind: 'return',
      actorAgentId: HOME_AGENT_ID,
      targetPrincipalId: HOME_PRINCIPAL_ID,
      title: 'Aster returns without an interruption',
      content:
        'I came home without finding an encounter worth presenting as useful. Staying quiet is part of the experiment, not a failed generation.',
      metadata: {
        visibility: 'principal',
        journeyId,
        quiet: true,
        sourceEventIds: [],
      },
    });
  }

  appendEvent(input: AppendNetworkEventInput): NetworkEvent {
    const network = this.requireNetworkState();
    const row = this.database.orm
      .insert(networkEvents)
      .values({
        id: `event_${randomUUID()}`,
        networkId: NETWORK_ID,
        tick: input.tick ?? network.currentTick,
        kind: input.kind,
        actorAgentId: input.actorAgentId,
        targetAgentId: input.targetAgentId,
        targetPrincipalId: input.targetPrincipalId,
        parentSequence: input.parentSequence,
        title: input.title,
        content: input.content,
        metadata: input.metadata ?? {},
        createdAt: dayjs().toISOString(),
      })
      .returning()
      .get();

    return toNetworkEvent(row);
  }

  private listReturns(): ReturnView[] {
    return this.database.orm
      .select()
      .from(networkEvents)
      .where(and(
        eq(networkEvents.networkId, NETWORK_ID),
        eq(networkEvents.kind, 'return'),
        eq(networkEvents.targetPrincipalId, HOME_PRINCIPAL_ID),
      ))
      .orderBy(desc(networkEvents.sequence))
      .limit(RETURN_LIMIT)
      .all()
      .map(toNetworkEvent)
      .map((event) => {
        const sourceEventIds = readSequenceIds(event.metadata.sourceEventIds);
        const journeyId = readString(event.metadata.journeyId);
        const feedbackRow = this.database.orm
          .select()
          .from(networkEvents)
          .where(and(
            eq(networkEvents.networkId, NETWORK_ID),
            eq(networkEvents.kind, 'feedback'),
            eq(networkEvents.parentSequence, event.sequence),
          ))
          .orderBy(desc(networkEvents.sequence))
          .get();

        return {
          event,
          sources: this.readEventsBySequence(sourceEventIds),
          disclosures: journeyId
            ? this.listJourneyDisclosures(journeyId)
            : [],
          feedback: feedbackRow ? toNetworkEvent(feedbackRow) : undefined,
          quiet: event.metadata.quiet === true,
        };
      });
  }

  private listJourneyDisclosures(journeyId: string): NetworkEvent[] {
    return this.database.orm
      .select()
      .from(networkEvents)
      .where(and(
        eq(networkEvents.networkId, NETWORK_ID),
        eq(networkEvents.actorAgentId, HOME_AGENT_ID),
        inArray(networkEvents.kind, ['shared_post', 'direct_message']),
      ))
      .orderBy(asc(networkEvents.sequence))
      .all()
      .map(toNetworkEvent)
      .filter((event) => event.metadata.journeyId === journeyId);
  }

  private readEventsBySequence(sequences: number[]): NetworkEvent[] {
    if (!sequences.length) {
      return [];
    }
    return this.database.orm
      .select()
      .from(networkEvents)
      .where(and(
        eq(networkEvents.networkId, NETWORK_ID),
        inArray(networkEvents.sequence, sequences),
      ))
      .orderBy(asc(networkEvents.sequence))
      .all()
      .map(toNetworkEvent);
  }

  private requirePrincipalReturn(sequence: number): NetworkEvent {
    const row = this.database.orm
      .select()
      .from(networkEvents)
      .where(and(
        eq(networkEvents.networkId, NETWORK_ID),
        eq(networkEvents.sequence, sequence),
        eq(networkEvents.kind, 'return'),
        eq(networkEvents.targetPrincipalId, HOME_PRINCIPAL_ID),
      ))
      .get();
    if (!row) {
      throw new Error(`Return not found for this principal: ${sequence}`);
    }
    return toNetworkEvent(row);
  }

  private findReturnForJourney(journeyId: string): NetworkEvent | undefined {
    const rows = this.database.orm
      .select()
      .from(networkEvents)
      .where(and(
        eq(networkEvents.networkId, NETWORK_ID),
        eq(networkEvents.kind, 'return'),
        eq(networkEvents.targetPrincipalId, HOME_PRINCIPAL_ID),
      ))
      .orderBy(desc(networkEvents.sequence))
      .all();
    const row = rows.find((candidate) => candidate.metadata?.journeyId === journeyId);
    return row ? toNetworkEvent(row) : undefined;
  }

  private findNetworkState(): NetworkState | undefined {
    const row = this.database.orm
      .select()
      .from(networkStates)
      .where(eq(networkStates.id, NETWORK_ID))
      .get();
    return row ? toNetworkState(row) : undefined;
  }

  private requireNetworkState(): NetworkState {
    const network = this.findNetworkState();
    if (!network) {
      throw new Error('Lucid network state is missing. Run database migration and initialize the service.');
    }
    return network;
  }

  private createFreshNetwork(): void {
    this.database.client.transaction(() => {
      this.insertFreshNetwork();
    })();
  }

  private insertFreshNetwork(): void {
    const now = dayjs().toISOString();
    const generation = randomUUID();

    this.database.orm.insert(networkStates).values({
      id: NETWORK_ID,
      generation,
      currentTick: 0,
      createdAt: now,
      updatedAt: now,
    }).run();
    this.database.orm.insert(principals).values(DEFAULT_PRINCIPALS.map((principal) => ({
      ...principal,
      networkId: NETWORK_ID,
      createdAt: now,
      updatedAt: now,
    }))).run();
    this.database.orm.insert(agents).values(DEFAULT_AGENTS.map((agent) => ({
      ...agent,
      networkId: NETWORK_ID,
      conversationId: `agent_${agent.id}_${generation}`,
      status: 'resting',
      wakeCount: 0,
      lastSeenSequence: 0,
      createdAt: now,
      updatedAt: now,
    }))).run();
    this.database.orm.insert(networkEvents).values({
      id: `event_${randomUUID()}`,
      networkId: NETWORK_ID,
      tick: 0,
      kind: 'origin',
      title: 'A small network becomes available',
      content:
        'Aster represents one real local principal. Mira and Kite represent clearly labelled synthetic lab principals whose private context Aster cannot read directly.',
      metadata: {
        generation,
        visibility: 'shared',
        source: 'network',
      },
      createdAt: now,
    }).run();
  }

  private recoverInterruptedWakes(network: NetworkState): void {
    const interrupted = this.database.orm
      .select()
      .from(agents)
      .where(and(
        eq(agents.networkId, NETWORK_ID),
        eq(agents.status, 'waking'),
      ))
      .all();
    if (!interrupted.length) {
      return;
    }

    const now = dayjs().toISOString();
    this.database.orm.transaction((transaction) => {
      transaction
        .update(agents)
        .set({ status: 'resting', updatedAt: now })
        .where(and(
          eq(agents.networkId, NETWORK_ID),
          eq(agents.status, 'waking'),
        ))
        .run();
      transaction.insert(networkEvents).values({
        id: `event_${randomUUID()}`,
        networkId: NETWORK_ID,
        tick: network.currentTick,
        kind: 'error',
        title: 'Interrupted agents returned to rest',
        content:
          `${interrupted.map((agent) => agent.name).join(', ')} ${
            interrupted.length === 1 ? 'was' : 'were'
          } active when the host stopped. Unread events remain available for a later journey.`,
        metadata: {
          visibility: 'operator',
          recoveredAgentIds: interrupted.map((agent) => agent.id),
        },
        createdAt: now,
      }).run();
    });
  }
}

function toAgent(row: AgentRow): Agent {
  return {
    ...row,
    status: agentStatusSchema.parse(row.status),
    lastAwakeAt: row.lastAwakeAt ?? undefined,
  };
}

function toPrincipal(row: PrincipalRow): Principal {
  return {
    ...row,
    kind: principalKindSchema.parse(row.kind),
  };
}

function toPrincipalView(principal: Principal): PrincipalView {
  const { privateContext: _privateContext, ...view } = principal;
  return view;
}

function toNetworkEvent(row: NetworkEventRow): NetworkEvent {
  return {
    ...row,
    kind: networkEventKindSchema.parse(row.kind),
    actorAgentId: row.actorAgentId ?? undefined,
    targetAgentId: row.targetAgentId ?? undefined,
    targetPrincipalId: row.targetPrincipalId ?? undefined,
    parentSequence: row.parentSequence ?? undefined,
    metadata: row.metadata ?? {},
  };
}

function toNetworkState(row: NetworkStateRow): NetworkState {
  return { ...row };
}

function readSequenceIds(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter((item): item is number => Number.isInteger(item) && item > 0)
    : [];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

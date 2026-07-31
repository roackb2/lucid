import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { LucidDatabaseService } from '../database/service.js';
import { createLucidLogger } from '../logger.js';
import { HOME_AGENT_ID, HOME_PRINCIPAL_ID } from './default-network.js';
import { AgentNetworkToolService } from './network-tools.js';
import { LucidRepository } from './repository.js';
import { LucidService } from './service.js';
import {
  type AgentMind,
  type StartAgentMindInput,
} from './types.js';

const MIGRATIONS_ROOT = fileURLToPath(new URL('../../drizzle', import.meta.url));

describe('Lucid First Return', () => {
  let database: LucidDatabaseService;
  let repository: LucidRepository;

  beforeEach(() => {
    database = new LucidDatabaseService(':memory:');
    database.migrate(MIGRATIONS_ROOT);
    repository = new LucidRepository(database);
    repository.initialize();
  });

  afterEach(() => {
    database.close();
  });

  it('creates one real principal without exposing synthetic private context', () => {
    const snapshot = repository.readSnapshot();

    expect(snapshot.network.currentTick).toBe(0);
    expect(snapshot.principal).toMatchObject({
      id: HOME_PRINCIPAL_ID,
      kind: 'human',
      displayName: 'You',
    });
    expect(snapshot.agents.map((agent) => agent.name)).toEqual([
      'Aster',
      'Mira',
      'Kite',
    ]);
    expect(snapshot.agents.map((agent) => agent.principal.kind)).toEqual([
      'human',
      'synthetic',
      'synthetic',
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('discarded intermediate versions');
  });

  it('keeps principal intent private to the home agent', () => {
    const intent = repository.setIntent(
      'Notice unusual product ideas that only make sense when agents represent different people.',
    );

    expect(repository.listVisibleEvents(HOME_AGENT_ID, 0).map((event) => event.sequence))
      .toContain(intent.sequence);
    expect(repository.listVisibleEvents('mira', 0).map((event) => event.sequence))
      .not.toContain(intent.sequence);
    expect(repository.listVisibleEvents('kite', 0).map((event) => event.sequence))
      .not.toContain(intent.sequence);
  });

  it('routes one bounded journey through peers and returns a causal encounter', async () => {
    repository.setIntent('Look for agent-native product ideas that are not personal utilities.');
    const mind = new RoutingMind(repository);
    const service = createService(repository, mind);

    service.startJourney();
    await vi.waitFor(() => {
      expect(service.snapshot().activeJourney).toBeUndefined();
    });

    const snapshot = service.snapshot();
    expect(mind.observations.map(({ agentId, phase }) => `${agentId}:${phase}`)).toEqual([
      'aster:seeking',
      'mira:responding',
      'kite:responding',
      'aster:returning',
    ]);
    expect(snapshot.network.currentTick).toBe(4);
    expect(snapshot.agents.map((agent) => agent.wakeCount)).toEqual([2, 1, 1]);
    expect(snapshot.returns).toHaveLength(1);
    expect(snapshot.returns[0]).toMatchObject({
      quiet: false,
      event: {
        actorAgentId: HOME_AGENT_ID,
        targetPrincipalId: HOME_PRINCIPAL_ID,
      },
    });
    expect(snapshot.returns[0]!.sources.map((event) => event.actorAgentId)).toEqual([
      'mira',
      'kite',
    ]);
    expect(snapshot.returns[0]!.disclosures).toHaveLength(1);
  });

  it('records an explicit quiet return when no encounter deserves attention', async () => {
    repository.setIntent('Notice something only if it is genuinely specific.');
    const service = createService(repository, new QuietMind());

    service.startJourney();
    await vi.waitFor(() => {
      expect(service.snapshot().activeJourney).toBeUndefined();
    });

    expect(service.snapshot().returns[0]).toMatchObject({
      quiet: true,
      sources: [],
      event: {
        title: 'Aster returns without an interruption',
      },
    });
  });

  it('rejects invisible sources without spending the mutation budget', async () => {
    const aster = repository.requireHomeAgent();
    const principal = repository.requirePrincipal(HOME_PRINCIPAL_ID);
    const hidden = repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: 'mira',
      targetAgentId: 'kite',
      title: 'A hidden peer message',
      content: 'Aster cannot cite this.',
    });
    const visible = repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: 'mira',
      targetAgentId: HOME_AGENT_ID,
      title: 'A visible peer message',
      content: 'Aster can bring this home.',
    });
    const seekingTools = new AgentNetworkToolService(
      repository,
      aster,
      principal,
      'seeking',
      'journey-seeking-test',
      1,
    );
    const seekingDefinitions = new Map(
      seekingTools.definitions().map((tool) => [tool.name, tool]),
    );
    const rejected = await seekingDefinitions.get('post_to_commons')!.execute({
      content: 'This hidden source should fail.',
      source_event_ids: [hidden.sequence],
    });
    const firstAction = await seekingDefinitions.get('post_to_commons')!.execute({
      content: 'This visible source can be shared.',
      source_event_ids: [visible.sequence],
    });
    const secondAction = await seekingDefinitions.get('send_message')!.execute({
      target_agent_id: 'kite',
      content: 'A second valid network action.',
      source_event_ids: [visible.sequence],
    });
    const overBudget = await seekingDefinitions.get('rest')!.execute({
      reason: 'This action should exceed the budget.',
    });

    expect(rejected.ok).toBe(false);
    expect(firstAction.ok).toBe(true);
    expect(secondAction.ok).toBe(true);
    expect(overBudget.ok).toBe(false);

    const returningTools = new AgentNetworkToolService(
      repository,
      aster,
      principal,
      'returning',
      'journey-return-test',
      2,
    );
    const returnHome = returningTools
      .definitions()
      .find((tool) => tool.name === 'return_to_principal');
    expect(returnHome).toBeDefined();

    const hiddenReturn = await returnHome!.execute({
      content: 'This should still fail.',
      source_event_ids: [hidden.sequence],
    });
    const visibleReturn = await returnHome!.execute({
      content: 'Mira sent a specific encounter.',
      source_event_ids: [visible.sequence],
    });
    expect(hiddenReturn.ok).toBe(false);
    expect(visibleReturn.ok).toBe(true);
  });

  it('delivers free-text feedback only to the home agent', async () => {
    repository.setIntent('Find one relevant encounter.');
    const service = createService(repository, new RoutingMind(repository));
    service.startJourney();
    await vi.waitFor(() => {
      expect(service.snapshot().activeJourney).toBeUndefined();
    });
    const returnSequence = service.snapshot().returns[0]!.event.sequence;

    service.submitFeedback(
      returnSequence,
      'The provenance was useful, but next time bring me a concrete person or project.',
    );

    const snapshot = service.snapshot();
    expect(snapshot.returns[0]!.feedback?.content).toContain('concrete person or project');
    expect(repository.listVisibleEvents(HOME_AGENT_ID, 0).some(
      (event) => event.kind === 'feedback',
    )).toBe(true);
    expect(repository.listVisibleEvents('mira', 0).some(
      (event) => event.kind === 'feedback',
    )).toBe(false);
  });

  it('recovers an agent left waking without consuming unread input', () => {
    repository.setIntent('Keep this private intent unread until a successful wake.');
    const wake = repository.beginWake(HOME_AGENT_ID, 'journey-recovery', 'seeking');
    expect(wake.visibleEvents.some((event) => event.kind === 'intent')).toBe(true);
    expect(repository.requireHomeAgent().status).toBe('waking');

    repository.initialize();

    expect(repository.requireHomeAgent().status).toBe('resting');
    expect(repository.listVisibleEvents(HOME_AGENT_ID, 0).some(
      (event) => event.kind === 'intent',
    )).toBe(true);
    expect(repository.readSnapshot().events.at(-1)).toMatchObject({
      kind: 'error',
      title: 'Interrupted agents returned to rest',
    });
  });

  it('waits for an interrupted wake to settle before shutdown', async () => {
    repository.setIntent('Begin a journey that will be cancelled.');
    const service = createService(repository, new InterruptibleMind());

    service.startJourney();
    await vi.waitFor(() => {
      expect(service.snapshot().activeJourney?.agentId).toBe(HOME_AGENT_ID);
    });
    await service.stop();

    const snapshot = service.snapshot();
    expect(snapshot.activeJourney).toBeUndefined();
    expect(snapshot.agents[0]?.status).toBe('resting');
    expect(snapshot.events.at(-1)).toMatchObject({
      kind: 'error',
      actorAgentId: HOME_AGENT_ID,
      metadata: {
        cancelled: true,
      },
    });
  });
});

function createService(repository: LucidRepository, mind: AgentMind) {
  return new LucidService(
    repository,
    mind,
    { model: 'test-mind', heddleVersion: 'test' },
    createLucidLogger('silent'),
  );
}

class RoutingMind implements AgentMind {
  readonly observations: Array<{
    agentId: string;
    phase: string;
    visibleKinds: string[];
  }> = [];

  constructor(private readonly repository: LucidRepository) {}

  async start(input: StartAgentMindInput) {
    this.observations.push({
      agentId: input.agent.id,
      phase: input.phase,
      visibleKinds: input.visibleEvents.map((event) => event.kind),
    });
    input.onActivity?.({
      type: 'test',
      summary: `${input.agent.name} is performing a deterministic network action.`,
      timestamp: dayjs().toISOString(),
    });

    if (input.phase === 'seeking') {
      const intent = input.visibleEvents.find((event) => event.kind === 'intent');
      this.repository.appendEvent({
        tick: input.tick,
        kind: 'shared_post',
        actorAgentId: input.agent.id,
        parentSequence: intent?.sequence,
        title: 'Aster asks the commons',
        content: 'Does anyone hold a specific observation about agent-native products?',
        metadata: {
          journeyId: input.journeyId,
          sourceEventIds: intent ? [intent.sequence] : [],
        },
      });
    } else if (input.phase === 'responding') {
      const request = input.visibleEvents.find((event) => event.kind === 'shared_post');
      this.repository.appendEvent({
        tick: input.tick,
        kind: 'direct_message',
        actorAgentId: input.agent.id,
        targetAgentId: HOME_AGENT_ID,
        parentSequence: request?.sequence,
        title: `${input.agent.name} answers Aster`,
        content: `A synthetic, explicitly labelled observation from ${input.agent.name}.`,
        metadata: {
          journeyId: input.journeyId,
          sourceEventIds: request ? [request.sequence] : [],
        },
      });
    } else {
      const sources = input.visibleEvents.filter(
        (event) => event.kind === 'direct_message',
      );
      this.repository.appendEvent({
        tick: input.tick,
        kind: 'return',
        actorAgentId: HOME_AGENT_ID,
        targetPrincipalId: HOME_PRINCIPAL_ID,
        parentSequence: sources[0]?.sequence,
        title: 'Aster brings one encounter home',
        content:
          'Two synthetic peers independently connected your intent to tacit knowledge that personal search cannot reach.',
        metadata: {
          journeyId: input.journeyId,
          quiet: false,
          sourceEventIds: sources.map((event) => event.sequence),
        },
      });
    }

    return {
      runId: `run_${input.agent.id}_${input.phase}`,
      result: Promise.resolve({
        outcome: 'done',
        summary: `${input.agent.name} completed the ${input.phase} wake.`,
        toolCount: 1,
      }),
      cancel: () => false,
    };
  }
}

class QuietMind implements AgentMind {
  async start(input: StartAgentMindInput) {
    return {
      runId: `run_quiet_${input.agent.id}_${input.phase}`,
      result: Promise.resolve({
        outcome: 'done',
        summary: `${input.agent.name} found no reason to add noise.`,
        toolCount: 0,
      }),
      cancel: () => false,
    };
  }
}

class InterruptibleMind implements AgentMind {
  async start(input: StartAgentMindInput) {
    return {
      runId: 'run_interruptible',
      result: new Promise<never>((_resolve, reject) => {
        input.signal.addEventListener(
          'abort',
          () => reject(new Error('Test journey interrupted.')),
          { once: true },
        );
      }),
      cancel: () => true,
    };
  }
}

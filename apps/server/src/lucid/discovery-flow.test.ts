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
import { AgentCommunicationToolService } from './agent-communication-tools.js';
import {
  LOCAL_USER_ID,
  USER_AGENT_ID,
} from './default-participants.js';
import { buildHeddleToolPolicyInstructions } from './agent-prompts.js';
import { DiscoveryEventRepository } from './discovery-event-repository.js';
import { DiscoveryRunService } from './discovery-run-service.js';
import type {
  AgentRunner,
  StartAgentRunInput,
} from './discovery-types.js';

const MIGRATIONS_ROOT = fileURLToPath(new URL('../../drizzle', import.meta.url));

describe('delegated discovery flow', () => {
  let database: LucidDatabaseService;
  let repository: DiscoveryEventRepository;

  beforeEach(() => {
    database = new LucidDatabaseService(':memory:');
    database.migrate(MIGRATIONS_ROOT);
    repository = new DiscoveryEventRepository(database);
    repository.initialize();
  });

  afterEach(() => {
    database.close();
  });

  it('creates one real participant without exposing simulated private context', () => {
    const snapshot = repository.readSnapshot();

    expect(snapshot.workspace.currentStep).toBe(0);
    expect(snapshot.user).toMatchObject({
      id: LOCAL_USER_ID,
      kind: 'human',
      displayName: 'You',
    });
    expect(snapshot.agents.map((agent) => agent.name)).toEqual([
      'Lucid',
      'Music maker agent',
      'Product research agent',
    ]);
    expect(snapshot.agents.map((agent) => agent.participant.kind)).toEqual([
      'human',
      'synthetic',
      'synthetic',
    ]);
    expect(JSON.stringify(snapshot)).not.toContain(
      'discarded intermediate versions',
    );
  });

  it('delivers a saved interest only to the user agent', () => {
    const interest = repository.saveInterest(
      'Notice product ideas that require agents to represent different people.',
    );

    expect(
      repository
        .listEventsVisibleToAgent(USER_AGENT_ID, 0)
        .map((event) => event.sequence),
    ).toContain(interest.sequence);
    expect(
      repository
        .listEventsVisibleToAgent('sample-music-agent', 0)
        .map((event) => event.sequence),
    ).not.toContain(interest.sequence);
    expect(
      repository
        .listEventsVisibleToAgent('sample-product-agent', 0)
        .map((event) => event.sequence),
    ).not.toContain(interest.sequence);
  });

  it('declares host-owned tool effects and the exact Heddle write root', () => {
    const tools = new AgentCommunicationToolService(
      repository,
      repository.requireUserAgent(),
      repository.requireParticipant(LOCAL_USER_ID),
      'requesting',
      'discovery-tool-policy-test',
      1,
    ).definitions();
    const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
    const workspaceRoot = '/tmp/lucid-tool-policy-test';

    expect(
      toolsByName.get('read_available_messages')?.hostPolicy,
    ).toMatchObject({
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
    });
    expect(toolsByName.get('post_shared_message')?.hostPolicy).toMatchObject({
      operations: ['write'],
    });
    expect(buildHeddleToolPolicyInstructions(workspaceRoot)).toContain(
      `targetRoots as ["${workspaceRoot}"]`,
    );
  });

  it('runs each participant once and reports a peer-sourced finding', async () => {
    repository.saveInterest(
      'Look for agent-native product ideas that are not personal utilities.',
    );
    const agentRunner = new RoutingAgentRunner(repository);
    const service = createService(repository, agentRunner);

    service.startRun();
    await vi.waitFor(() => {
      expect(service.snapshot().activeRun).toBeUndefined();
    });

    const snapshot = service.snapshot();
    expect(
      agentRunner.observations.map(
        ({ agentId, phase }) => `${agentId}:${phase}`,
      ),
    ).toEqual([
      'user-agent:requesting',
      'sample-music-agent:responding',
      'sample-product-agent:responding',
      'user-agent:reporting',
    ]);
    expect(snapshot.workspace.currentStep).toBe(4);
    expect(snapshot.agents.map((agent) => agent.runCount)).toEqual([2, 1, 1]);
    expect(snapshot.findings).toHaveLength(1);
    expect(snapshot.findings[0]).toMatchObject({
      noMatch: false,
      finding: {
        actorAgentId: USER_AGENT_ID,
        targetParticipantId: LOCAL_USER_ID,
      },
    });
    expect(
      snapshot.findings[0]!.sources.map((event) => event.actorAgentId),
    ).toEqual(['sample-music-agent', 'sample-product-agent']);
    expect(snapshot.findings[0]!.outboundMessages).toHaveLength(1);
  });

  it('records an explicit no-match finding when peers contribute nothing', async () => {
    repository.saveInterest('Report only a genuinely specific match.');
    const service = createService(repository, new NoMatchAgentRunner());

    service.startRun();
    await vi.waitFor(() => {
      expect(service.snapshot().activeRun).toBeUndefined();
    });

    expect(service.snapshot().findings[0]).toMatchObject({
      noMatch: true,
      sources: [],
      finding: {
        title: 'No relevant match found',
      },
    });
  });

  it('rejects invisible sources without spending the action budget', async () => {
    const userAgent = repository.requireUserAgent();
    const user = repository.requireParticipant(LOCAL_USER_ID);
    const hidden = repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: 'sample-music-agent',
      targetAgentId: 'sample-product-agent',
      title: 'Hidden message',
      content: 'The user agent cannot cite this.',
    });
    const visible = repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: 'sample-music-agent',
      targetAgentId: USER_AGENT_ID,
      title: 'Visible message',
      content: 'The user agent can cite this.',
    });
    const requestingTools = new AgentCommunicationToolService(
      repository,
      userAgent,
      user,
      'requesting',
      'discovery-requesting-test',
      1,
    );
    const requestingDefinitions = new Map(
      requestingTools.definitions().map((tool) => [tool.name, tool]),
    );

    const rejected = await requestingDefinitions.get('post_shared_message')!.execute({
      content: 'This hidden source should fail.',
      source_event_ids: [hidden.sequence],
    });
    const firstAction = await requestingDefinitions.get('post_shared_message')!.execute({
      content: 'This visible source can be shared.',
      source_event_ids: [visible.sequence],
    });
    const secondAction = await requestingDefinitions.get('send_direct_message')!.execute({
      target_agent_id: 'sample-product-agent',
      content: 'A second valid communication action.',
      source_event_ids: [visible.sequence],
    });
    const overBudget = await requestingDefinitions.get('finish_without_action')!.execute({
      reason: 'This action should exceed the budget.',
    });

    expect(rejected.ok).toBe(false);
    expect(firstAction.ok).toBe(true);
    expect(secondAction.ok).toBe(true);
    expect(overBudget.ok).toBe(false);

    const reportingTools = new AgentCommunicationToolService(
      repository,
      userAgent,
      user,
      'reporting',
      'discovery-reporting-test',
      2,
    );
    const reportFinding = reportingTools
      .definitions()
      .find((tool) => tool.name === 'report_finding');
    expect(reportFinding).toBeDefined();

    const hiddenFinding = await reportFinding!.execute({
      content: 'This should fail.',
      source_event_ids: [hidden.sequence],
    });
    const visibleFinding = await reportFinding!.execute({
      content: 'A simulated participant sent a specific match.',
      source_event_ids: [visible.sequence],
    });
    expect(hiddenFinding.ok).toBe(false);
    expect(visibleFinding.ok).toBe(true);
  });

  it('delivers free-text feedback only to the user agent', async () => {
    repository.saveInterest('Find one relevant match.');
    const service = createService(
      repository,
      new RoutingAgentRunner(repository),
    );
    service.startRun();
    await vi.waitFor(() => {
      expect(service.snapshot().activeRun).toBeUndefined();
    });
    const findingSequence = service.snapshot().findings[0]!.finding.sequence;

    service.submitFeedback(
      findingSequence,
      'The sources were useful, but next time bring a concrete person or project.',
    );

    const snapshot = service.snapshot();
    expect(snapshot.findings[0]!.feedback?.content).toContain(
      'concrete person or project',
    );
    expect(
      repository
        .listEventsVisibleToAgent(USER_AGENT_ID, 0)
        .some((event) => event.kind === 'feedback_saved'),
    ).toBe(true);
    expect(
      repository
        .listEventsVisibleToAgent('sample-music-agent', 0)
        .some((event) => event.kind === 'feedback_saved'),
    ).toBe(false);
  });

  it('recovers an interrupted agent step without consuming unread input', () => {
    repository.saveInterest(
      'Keep this private interest unread until a successful agent step.',
    );
    const step = repository.beginAgentStep(
      USER_AGENT_ID,
      'discovery-recovery',
      'requesting',
    );
    expect(
      step.visibleEvents.some((event) => event.kind === 'interest_saved'),
    ).toBe(true);
    expect(repository.requireUserAgent().status).toBe('running');

    repository.initialize();

    expect(repository.requireUserAgent().status).toBe('idle');
    expect(
      repository
        .listEventsVisibleToAgent(USER_AGENT_ID, 0)
        .some((event) => event.kind === 'interest_saved'),
    ).toBe(true);
    expect(repository.readSnapshot().events.at(-1)).toMatchObject({
      kind: 'error',
      title: 'Interrupted agent steps recovered',
    });
  });

  it('waits for an interrupted agent execution before shutdown', async () => {
    repository.saveInterest('Begin a discovery check that will be cancelled.');
    const service = createService(
      repository,
      new InterruptibleAgentRunner(),
    );

    service.startRun();
    await vi.waitFor(() => {
      expect(service.snapshot().activeRun?.agentId).toBe(USER_AGENT_ID);
    });
    await service.stop();

    const snapshot = service.snapshot();
    expect(snapshot.activeRun).toBeUndefined();
    expect(snapshot.agents[0]?.status).toBe('idle');
    expect(snapshot.events.at(-1)).toMatchObject({
      kind: 'error',
      actorAgentId: USER_AGENT_ID,
      metadata: {
        cancelled: true,
      },
    });
  });
});

function createService(
  repository: DiscoveryEventRepository,
  agentRunner: AgentRunner,
) {
  return new DiscoveryRunService(
    repository,
    agentRunner,
    { model: 'test-model', heddleVersion: 'test' },
    createLucidLogger('silent'),
  );
}

class RoutingAgentRunner implements AgentRunner {
  readonly observations: Array<{
    agentId: string;
    phase: string;
    visibleKinds: string[];
  }> = [];

  constructor(private readonly repository: DiscoveryEventRepository) {}

  async startAgentStep(input: StartAgentRunInput) {
    this.observations.push({
      agentId: input.agent.id,
      phase: input.phase,
      visibleKinds: input.visibleEvents.map((event) => event.kind),
    });
    input.onActivity?.({
      type: 'test',
      summary: `${input.agent.name} is performing a deterministic action.`,
      timestamp: dayjs().toISOString(),
    });

    if (input.phase === 'requesting') {
      const interest = input.visibleEvents.find(
        (event) => event.kind === 'interest_saved',
      );
      this.repository.appendEvent({
        stepNumber: input.stepNumber,
        kind: 'shared_message',
        actorAgentId: input.agent.id,
        parentSequence: interest?.sequence,
        title: 'Lucid requests a specific match',
        content:
          'Does any participant hold a specific observation about agent-native products?',
        metadata: {
          discoveryRunId: input.discoveryRunId,
          sourceEventIds: interest ? [interest.sequence] : [],
        },
      });
    } else if (input.phase === 'responding') {
      const request = input.visibleEvents.find(
        (event) => event.kind === 'shared_message',
      );
      this.repository.appendEvent({
        stepNumber: input.stepNumber,
        kind: 'direct_message',
        actorAgentId: input.agent.id,
        targetAgentId: USER_AGENT_ID,
        parentSequence: request?.sequence,
        title: `${input.agent.name} responds to Lucid`,
        content: `A simulated, explicitly labelled observation from ${input.agent.name}.`,
        metadata: {
          discoveryRunId: input.discoveryRunId,
          sourceEventIds: request ? [request.sequence] : [],
        },
      });
    } else {
      const sources = input.visibleEvents.filter(
        (event) => event.kind === 'direct_message',
      );
      this.repository.appendEvent({
        stepNumber: input.stepNumber,
        kind: 'finding_reported',
        actorAgentId: USER_AGENT_ID,
        targetParticipantId: LOCAL_USER_ID,
        parentSequence: sources[0]?.sequence,
        title: 'Lucid found a possible match',
        content:
          'Two simulated participants connected the saved interest to tacit knowledge that public search cannot reach.',
        metadata: {
          discoveryRunId: input.discoveryRunId,
          noMatch: false,
          sourceEventIds: sources.map((event) => event.sequence),
        },
      });
    }

    return {
      executionId: `execution_${input.agent.id}_${input.phase}`,
      result: Promise.resolve({
        outcome: 'done',
        summary: `${input.agent.name} completed the ${input.phase} step.`,
        toolCount: 1,
      }),
      cancel: () => false,
    };
  }
}

class NoMatchAgentRunner implements AgentRunner {
  async startAgentStep(input: StartAgentRunInput) {
    return {
      executionId: `execution_no_match_${input.agent.id}_${input.phase}`,
      result: Promise.resolve({
        outcome: 'done',
        summary: `${input.agent.name} found no specific match.`,
        toolCount: 0,
      }),
      cancel: () => false,
    };
  }
}

class InterruptibleAgentRunner implements AgentRunner {
  async startAgentStep(input: StartAgentRunInput) {
    return {
      executionId: 'execution_interruptible',
      result: new Promise<never>((_resolve, reject) => {
        input.signal.addEventListener(
          'abort',
          () => reject(new Error('Test discovery run interrupted.')),
          { once: true },
        );
      }),
      cancel: () => true,
    };
  }
}

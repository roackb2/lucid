import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';
import {
  AgentLoopCheckpointService,
  FileHeartbeatTaskService,
  type AgentHeartbeatResult,
  type AgentLoopCheckpoint,
  type AgentLoopState,
} from '@roackb2/heddle/advanced';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { LucidConfig } from '../config.js';
import { SqliteDiscoveryRepository } from '../database/sqlite-discovery-repository.js';
import { LucidSqliteDatabase } from '../database/sqlite-database.js';
import { createLucidLogger } from '../logger.js';
import { AgentCommunicationToolService } from './agent-communication-tools.js';
import {
  LOCAL_USER_ID,
  USER_AGENT_ID,
} from './default-participants.js';
import { DiscoveryWorkspaceService } from './discovery-workspace-service.js';
import type {
  RepresentativeAgentHeartbeatRunner,
  RunRepresentativeAgentHeartbeatInput,
} from './heddle-representative-agent-runner.js';
import {
  RepresentativeAgentHeartbeatService,
} from './representative-agent-heartbeat-service.js';

const MIGRATIONS_ROOT = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);

describe('representative-agent heartbeat service', () => {
  let database: LucidSqliteDatabase;
  let repository: SqliteDiscoveryRepository;
  let config: LucidConfig;
  let stateRoot: string;
  let heartbeats: RepresentativeAgentHeartbeatService[];

  beforeEach(async () => {
    stateRoot = mkdtempSync(join(tmpdir(), 'lucid-heartbeat-test-'));
    database = new LucidSqliteDatabase(':memory:');
    database.migrate(MIGRATIONS_ROOT);
    repository = new SqliteDiscoveryRepository(database);
    await repository.initialize();
    config = createTestConfig(stateRoot);
    heartbeats = [];
  });

  afterEach(async () => {
    await Promise.all(heartbeats.map((heartbeat) => heartbeat.stop()));
    database.close();
    rmSync(stateRoot, { force: true, recursive: true });
  });

  it('routes unread mailbox events until the user receives a finding', async () => {
    const runner = new RoutingHeartbeatRunner(repository);
    const { workspace } = await startServices(runner);

    await workspace.saveInterest(
      'Look for agent-native products that connect knowledge held by people.',
    );
    await vi.waitFor(async () => {
      const snapshot = await workspace.snapshot();
      expect(snapshot.findings).toHaveLength(1);
      expect(snapshot.backgroundChecks.running).toBe(false);
    }, { interval: 10, timeout: 5_000 });

    const snapshot = await workspace.snapshot();
    expect(runner.observations.map(({ agentId }) => agentId)).toEqual([
      USER_AGENT_ID,
      'sample-music-agent',
      'sample-product-agent',
      'sample-music-agent',
      USER_AGENT_ID,
    ]);
    expect(snapshot.workspace.currentWake).toBe(5);
    expect(snapshot.agents.map((agent) => agent.runCount)).toEqual([2, 2, 1]);
    expect(snapshot.findings[0]!.sources.map(
      (event) => event.actorAgentId,
    )).toEqual(['sample-music-agent', 'sample-product-agent']);
    expect(snapshot.findings[0]!.outboundMessages).toHaveLength(1);
    expect(snapshot.backgroundChecks.tasks).toHaveLength(3);
    expect(snapshot.backgroundChecks.tasks.every(
      (task) => task.status === 'waiting',
    )).toBe(true);
  });

  it('turns Run now into a fresh mailbox request on the same task network', async () => {
    const runner = new RoutingHeartbeatRunner(repository);
    const { workspace } = await startServices(runner);
    await workspace.saveInterest('Find a specific participant connection.');
    await vi.waitFor(async () => {
      expect((await workspace.snapshot()).findings).toHaveLength(1);
    }, { interval: 10, timeout: 5_000 });

    await workspace.runNow();
    await vi.waitFor(async () => {
      expect((await workspace.snapshot()).findings).toHaveLength(2);
    }, { interval: 10, timeout: 5_000 });

    const checkRequests = (await repository.readSnapshot()).events.filter(
      (event) => event.kind === 'check_requested',
    );
    expect(checkRequests).toHaveLength(1);
    expect(checkRequests[0]?.content).toContain(
      'Find a specific participant connection.',
    );
    expect(runner.observations.filter(({ visibleKinds }) => (
      visibleKinds.includes('check_requested')
    ))).toHaveLength(1);
  });

  it('does not invoke a model runner when scheduled tasks have no unread input', async () => {
    const runner = new CountingHeartbeatRunner();
    const { heartbeat } = await startServices(runner);
    const taskStore = new FileHeartbeatTaskService({
      stateRoot: config.heddleStateRoot,
    });

    await Promise.all((await taskStore.listTasks()).map(
      (task) => taskStore.triggerTaskRun(task.id),
    ));
    await vi.waitFor(async () => {
      const snapshot = await heartbeat.snapshot();
      expect(snapshot.tasks.every((task) => Boolean(task.lastRunAt))).toBe(true);
      expect(snapshot.running).toBe(false);
    }, { interval: 10, timeout: 5_000 });

    expect(runner.calls).toBe(0);
    expect((await repository.readWorkspace()).currentWake).toBe(0);
    expect((await repository.readSnapshot()).events.some(
      (event) => event.kind === 'agent_wake_started',
    )).toBe(false);
  });

  it('pauses a running wake without consuming its unread cursor and resumes it', async () => {
    const runner = new InterruptThenCompleteHeartbeatRunner(repository);
    const { workspace } = await startServices(runner);
    const interest = await workspace.saveInterest(
      'Keep this unread while background checks are paused.',
    );
    expect(interest.interest).toBeDefined();
    await vi.waitFor(async () => {
      expect((await repository.requireUserAgent()).status).toBe('running');
    }, { interval: 10, timeout: 5_000 });

    const paused = await workspace.setBackgroundChecksEnabled(false);
    expect(paused.backgroundChecks.enabled).toBe(false);
    expect(paused.backgroundChecks.running).toBe(false);
    expect((await repository.requireUserAgent()).lastSeenSequence).toBe(0);

    await workspace.setBackgroundChecksEnabled(true);
    await vi.waitFor(async () => {
      const userAgent = await repository.requireUserAgent();
      expect(userAgent.status).toBe('idle');
      expect(userAgent.lastSeenSequence).toBeGreaterThan(0);
      expect(runner.wakeIds).toHaveLength(2);
    }, { interval: 10, timeout: 5_000 });

    expect(runner.wakeIds[1]).toBe(runner.wakeIds[0]);
  });

  it('reconciles one participant lifecycle without pausing the network', async () => {
    const { workspace } = await startServices(new CountingHeartbeatRunner());
    const createdSnapshot = await workspace.createAssistedParticipant({
      displayName: 'Avery',
      privateContext:
        'I can share personal observations about small local music events.',
      contextApproved: true,
    });
    const createdAgent = createdSnapshot.agents.find(
      (agent) => agent.participant.displayName === 'Avery',
    );

    expect(createdAgent).toBeDefined();
    expect(createdSnapshot.backgroundChecks).toMatchObject({
      enabled: true,
      tasks: expect.arrayContaining([
        expect.objectContaining({
          agentId: createdAgent!.id,
          enabled: true,
        }),
      ]),
    });
    expect(createdSnapshot.backgroundChecks.tasks).toHaveLength(4);

    const disabledSnapshot = await workspace.setParticipantEnabled(
      createdAgent!.participant.id,
      false,
    );
    expect(disabledSnapshot.backgroundChecks.enabled).toBe(true);
    expect(disabledSnapshot.agents.find(
      (agent) => agent.id === createdAgent!.id,
    )?.participant.status).toBe('disabled');
    expect(disabledSnapshot.backgroundChecks.tasks.find(
      (task) => task.agentId === createdAgent!.id,
    )?.enabled).toBe(false);

    const enabledSnapshot = await workspace.setParticipantEnabled(
      createdAgent!.participant.id,
      true,
    );
    expect(enabledSnapshot.backgroundChecks.tasks.find(
      (task) => task.agentId === createdAgent!.id,
    )?.enabled).toBe(true);

    const retiredSnapshot = await workspace.retireParticipant(
      createdAgent!.participant.id,
    );
    expect(retiredSnapshot.backgroundChecks.enabled).toBe(true);
    expect(retiredSnapshot.agents.find(
      (agent) => agent.id === createdAgent!.id,
    )?.participant.status).toBe('retired');
    expect(retiredSnapshot.backgroundChecks.tasks.map(({ agentId }) => agentId))
      .not.toContain(createdAgent!.id);
  });

  it('does not recover an unrelated task that is still running', async () => {
    const runner = new InterruptThenCompleteHeartbeatRunner(repository);
    const { workspace } = await startServices(runner);
    await workspace.saveInterest(
      'Keep this wake active while another participant joins.',
    );
    await vi.waitFor(async () => {
      expect((await repository.requireUserAgent()).status).toBe('running');
    }, { interval: 10, timeout: 5_000 });

    const snapshot = await workspace.createAssistedParticipant({
      displayName: 'Avery',
      privateContext: 'I approved one small piece of test context.',
      contextApproved: true,
    });

    expect((await repository.requireUserAgent()).status).toBe('running');
    expect(snapshot.backgroundChecks.running).toBe(true);
    expect(snapshot.backgroundChecks.tasks.find(
      (task) => task.agentId === USER_AGENT_ID,
    )?.status).toBe('running');

    await workspace.setBackgroundChecksEnabled(false);
  });

  it('resets dynamic participants and tasks to the default network', async () => {
    const { workspace } = await startServices(new CountingHeartbeatRunner());
    const created = await workspace.createAssistedParticipant({
      displayName: 'Avery',
      privateContext: 'Temporary context for reset verification.',
      contextApproved: true,
    });
    expect(created.agents).toHaveLength(4);
    expect(created.backgroundChecks.tasks).toHaveLength(4);

    const reset = await workspace.resetWorkspace();

    expect(reset.agents.map(({ name }) => name)).toEqual([
      'Lucid',
      'Music maker agent',
      'Product research agent',
    ]);
    expect(reset.backgroundChecks.tasks).toHaveLength(3);
    expect(reset.backgroundChecks.enabled).toBe(true);
  });

  it('recovers both a Heddle task and its claimed mailbox wake after restart', async () => {
    const initialHeartbeat = await createHeartbeat(
      new CountingHeartbeatRunner(),
      false,
    );
    const interest = await repository.saveInterest(
      'Resume this exact input after a host restart.',
    );
    const claimed = await repository.beginAgentWake(
      USER_AGENT_ID,
      'wake_before_host_restart',
    );
    const taskStore = new FileHeartbeatTaskService({
      stateRoot: config.heddleStateRoot,
    });
    const task = await taskStore.requireTask(
      'lucid-representative-user-agent',
    );
    await taskStore.saveTask({
      ...task,
      state: {
        ...task.state,
        status: 'running',
        progress: 'Simulated interrupted host.',
        updatedAt: dayjs().toISOString(),
      },
    });

    await repository.initialize();
    const runner = new FinishWithoutActionHeartbeatRunner(repository);
    const recoveredHeartbeat = await createHeartbeat(runner, true);

    await vi.waitFor(async () => {
      expect(runner.wakes).toHaveLength(1);
      expect((await repository.requireUserAgent()).lastSeenSequence)
        .toBe(interest.sequence);
    }, { interval: 10, timeout: 5_000 });

    expect(runner.wakes[0]).toMatchObject({
      wakeId: claimed!.wakeId,
      wakeNumber: claimed!.wakeNumber,
      horizonSequence: claimed!.horizonSequence,
    });
    expect((await recoveredHeartbeat.snapshot()).tasks.find(
      (candidate) => candidate.agentId === USER_AGENT_ID,
    )?.status).toBe('waiting');
    expect(initialHeartbeat).toBeDefined();
  });

  async function startServices(
    runner: RepresentativeAgentHeartbeatRunner,
  ): Promise<{
    heartbeat: RepresentativeAgentHeartbeatService;
    workspace: DiscoveryWorkspaceService;
  }> {
    const heartbeat = await createHeartbeat(runner, true);
    return {
      heartbeat,
      workspace: new DiscoveryWorkspaceService(
        repository,
        heartbeat,
        { model: config.model, heddleVersion: 'test' },
      ),
    };
  }

  async function createHeartbeat(
    runner: RepresentativeAgentHeartbeatRunner,
    start: boolean,
  ): Promise<RepresentativeAgentHeartbeatService> {
    const heartbeat = new RepresentativeAgentHeartbeatService(
      repository,
      runner,
      config,
      createLucidLogger('silent'),
    );
    await heartbeat.initialize();
    if (start) {
      heartbeat.start();
    }
    heartbeats.push(heartbeat);
    return heartbeat;
  }
});

class RoutingHeartbeatRunner implements RepresentativeAgentHeartbeatRunner {
  readonly observations: Array<{
    agentId: string;
    visibleKinds: string[];
  }> = [];

  constructor(private readonly repository: SqliteDiscoveryRepository) {}

  async run(
    input: RunRepresentativeAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    this.observations.push({
      agentId: input.wake.agent.id,
      visibleKinds: input.wake.visibleEvents.map((event) => event.kind),
    });
    const tools = new Map(
      (await createWakeTools(this.repository, input))
        .map((tool) => [tool.name, tool]),
    );
    const peerMessages = input.wake.visibleEvents.filter((event) => (
      event.actorAgentId !== input.wake.agent.id
      && ['shared_message', 'direct_message'].includes(event.kind)
    ));

    if (input.wake.agent.id === USER_AGENT_ID && peerMessages.length) {
      await requireSuccessfulToolResult(
        tools.get('report_finding')!.execute({
          content:
            'Two simulated participants connected the saved interest to knowledge held by people.',
          source_event_ids: peerMessages.map((event) => event.sequence),
        }),
      );
    } else if (input.wake.agent.id === USER_AGENT_ID) {
      const request = input.wake.visibleEvents.find((event) => (
        event.kind === 'interest_saved' || event.kind === 'check_requested'
      ));
      await requireSuccessfulToolResult(
        tools.get('post_shared_message')!.execute({
          content:
            'Does any participant have a specific observation connected to this request?',
          source_event_ids: request ? [request.sequence] : [],
        }),
      );
    } else {
      const request = input.wake.visibleEvents.find(
        (event) => event.kind === 'shared_message',
      );
      const contribution = await tools.get('post_shared_message')!.execute({
          content:
            `A simulated, explicitly labelled observation from ${input.wake.agent.name}.`,
          source_event_ids: request ? [request.sequence] : [],
      });
      if (!contribution.ok) {
        await requireSuccessfulToolResult(
          tools.get('finish_without_action')!.execute({
            reason:
              'This representative already contributed to the causal thread.',
          }),
        );
      }
    }

    return createHeartbeatResult(input, 'Representative action completed.');
  }
}

class CountingHeartbeatRunner implements RepresentativeAgentHeartbeatRunner {
  calls = 0;

  async run(
    input: RunRepresentativeAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    this.calls += 1;
    return createHeartbeatResult(input, 'Counted one agent wake.');
  }
}

class InterruptThenCompleteHeartbeatRunner
implements RepresentativeAgentHeartbeatRunner {
  readonly wakeIds: string[] = [];
  private calls = 0;

  constructor(private readonly repository: SqliteDiscoveryRepository) {}

  async run(
    input: RunRepresentativeAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    this.calls += 1;
    this.wakeIds.push(input.wake.wakeId);
    if (this.calls === 1) {
      await waitForAbort(input.signal);
      return createHeartbeatResult(input, 'Interrupted test wake.');
    }

    const tools = new Map(
      (await createWakeTools(this.repository, input))
        .map((tool) => [tool.name, tool]),
    );
    await requireSuccessfulToolResult(
      tools.get('finish_without_action')!.execute({
        reason: 'The retry consumed the preserved unread input.',
      }),
    );
    return createHeartbeatResult(input, 'Retry completed.');
  }
}

class FinishWithoutActionHeartbeatRunner
implements RepresentativeAgentHeartbeatRunner {
  readonly wakes: Array<{
    wakeId: string;
    wakeNumber: number;
    horizonSequence: number;
  }> = [];

  constructor(private readonly repository: SqliteDiscoveryRepository) {}

  async run(
    input: RunRepresentativeAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    this.wakes.push({
      wakeId: input.wake.wakeId,
      wakeNumber: input.wake.wakeNumber,
      horizonSequence: input.wake.horizonSequence,
    });
    const tools = new Map(
      (await createWakeTools(this.repository, input))
        .map((tool) => [tool.name, tool]),
    );
    await requireSuccessfulToolResult(
      tools.get('finish_without_action')!.execute({
        reason: 'Recovered the interrupted wake.',
      }),
    );
    return createHeartbeatResult(input, 'Recovered wake completed.');
  }
}

async function createWakeTools(
  repository: SqliteDiscoveryRepository,
  input: RunRepresentativeAgentHeartbeatInput,
) {
  return await new AgentCommunicationToolService(
    repository,
    input.wake.agent,
    input.wake.participant,
    input.wake.wakeId,
    input.wake.wakeNumber,
    input.wake.horizonSequence,
  ).definitions();
}

async function requireSuccessfulToolResult(
  result: ReturnType<
    Awaited<ReturnType<typeof createWakeTools>>[number]['execute']
  >,
): Promise<void> {
  const resolved = await result;
  if (!resolved.ok) {
    throw new Error(resolved.error);
  }
}

function createHeartbeatResult(
  input: RunRepresentativeAgentHeartbeatInput,
  summary: string,
): AgentHeartbeatResult {
  const previousState = readCheckpointState(input.checkpoint);
  const timestamp = dayjs().toISOString();
  const state: AgentLoopState = {
    status: 'finished',
    runId: `run_${randomUUID()}`,
    goal: `Test ${input.wake.agent.name}`,
    model: previousState?.model ?? 'gpt-5.4-mini',
    provider: previousState?.provider ?? 'openai',
    workspaceRoot: previousState?.workspaceRoot ?? '/tmp/lucid-test',
    startedAt: timestamp,
    finishedAt: timestamp,
    outcome: 'done',
    summary,
    transcript: previousState?.transcript ?? [],
    trace: [],
  };
  return {
    decision: 'pause',
    summary,
    checkpoint: AgentLoopCheckpointService.createCheckpoint(state),
    state,
  };
}

function readCheckpointState(
  checkpoint: AgentLoopState | AgentLoopCheckpoint | undefined,
): AgentLoopState | undefined {
  return checkpoint
    ? 'state' in checkpoint ? checkpoint.state : checkpoint
    : undefined;
}

function createTestConfig(stateRoot: string): LucidConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    webOrigin: 'http://127.0.0.1:3080',
    repoRoot: stateRoot,
    stateRoot,
    databasePath: ':memory:',
    heddleStateRoot: join(stateRoot, 'heddle'),
    model: 'gpt-5.4-mini',
    maxSteps: 4,
    heartbeatIntervalMs: 60_000,
    heartbeatPollMs: 5,
    preferApiKey: false,
  };
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

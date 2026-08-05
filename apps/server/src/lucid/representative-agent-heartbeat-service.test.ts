import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import dayjs from 'dayjs';
import {
  AgentLoopCheckpointService,
  FileHeartbeatTaskService,
  HeartbeatRunnerAgent,
  type AgentHeartbeatResult,
  type AgentLoopCheckpoint,
  type AgentLoopState,
  type RunAgentHeartbeatOptions,
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
} from './local-participant.js';
import { DiscoveryWorkspaceService } from './discovery-workspace-service.js';
import type {
  RepresentativeAgentHeartbeatRunner,
  RunRepresentativeAgentHeartbeatInput,
} from './heddle-representative-agent-runner.js';
import { ParticipantNetworkService } from './participant-network-service.js';
import {
  RepresentativeAgentHeartbeatService,
} from './representative-agent-heartbeat-service.js';

const MIGRATIONS_ROOT = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
);
const TEST_RUNTIME = { model: 'gpt-5.4-mini', heddleVersion: 'test' };

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
    vi.spyOn(HeartbeatRunnerAgent, 'run').mockImplementation(
      async (options) => createHeartbeatResult(options),
    );
  });

  afterEach(async () => {
    await Promise.all(heartbeats.map((heartbeat) => heartbeat.stop()));
    vi.restoreAllMocks();
    database.close();
    rmSync(stateRoot, { force: true, recursive: true });
  });

  it('routes dynamic participant messages until the local participant receives a finding', async () => {
    const sources = await Promise.all([
      registerSynthetic(repository, 'builder'),
      registerSynthetic(repository, 'organizer'),
    ]);
    const runner = new RoutingHeartbeatRunner(repository);
    const { workspace } = await startServices(runner);

    await workspace.saveInterest(
      'Look for products that connect knowledge held by different people.',
    );
    await vi.waitFor(async () => {
      const snapshot = await workspace.snapshot();
      expect(snapshot.findings.length).toBeGreaterThan(0);
      expect(snapshot.backgroundChecks.running).toBe(false);
    }, { interval: 10, timeout: 5_000 });

    const snapshot = await workspace.snapshot();
    const sourceIds = new Set(sources.map(({ participant }) => participant.id));
    expect(snapshot).not.toHaveProperty('agents');
    expect(snapshot).not.toHaveProperty('events');
    expect(snapshot.findings[0]?.sources.length).toBeGreaterThan(0);
    expect(snapshot.findings[0]?.sources.every(({ attribution }) => (
      attribution && sourceIds.has(attribution.participantId)
    ))).toBe(true);
    expect(runner.agentIds).toContain(USER_AGENT_ID);
    expect(runner.agentIds.some((agentId) => (
      sources.some(({ agent }) => agent.id === agentId)
    ))).toBe(true);
  });

  it('turns participant ingress into a durable targeted wake', async () => {
    const runner = new CountingHeartbeatRunner();
    const { network } = await startServices(runner);
    const registered = await network.registerParticipant({
      registrationKey: 'sim:test:ingress',
      kind: 'synthetic',
      displayName: 'Ingress participant',
      privateContext: 'Receives changing external observations.',
    });

    const receipt = await network.submitParticipantInput({
      participantId: registered.participantId,
      content: 'A new observation arrived outside the product runtime.',
      idempotencyKey: 'sim:test:ingress:1',
    });
    await vi.waitFor(() => {
      expect(runner.agentIds).toContain(registered.representativeAgentId);
    }, { interval: 10, timeout: 5_000 });

    expect(receipt).toMatchObject({
      participantId: registered.participantId,
      representativeAgentId: registered.representativeAgentId,
    });
    const diagnostics = await network.diagnostics();
    expect(diagnostics.events).toContainEqual(expect.objectContaining({
      sequence: receipt.sequence,
      kind: 'participant_input',
      targetAgentId: registered.representativeAgentId,
    }));
  });

  it('serializes concurrent participant registration into one consistent task set', async () => {
    const { network } = await startServices(new CountingHeartbeatRunner());
    const registrations = await Promise.all(
      ['one', 'two', 'three', 'four'].map((key) => (
        network.registerParticipant({
          registrationKey: `sim:test:parallel:${key}`,
          kind: 'synthetic',
          displayName: `Parallel ${key}`,
          privateContext: `Independent private context for ${key}.`,
        })
      )),
    );

    const diagnostics = await network.diagnostics();
    expect(new Set(registrations.map(({ participantId }) => participantId)).size)
      .toBe(4);
    expect(diagnostics.participants).toHaveLength(5);
    expect(diagnostics.backgroundChecks.tasks).toHaveLength(5);
    expect(diagnostics.backgroundChecks.tasks.every(({ enabled }) => enabled))
      .toBe(true);
  });

  it('persists the local listening preference without pausing peer agents', async () => {
    const source = await registerSynthetic(repository, 'always-listening-peer');
    const firstRunner = new CountingHeartbeatRunner();
    const first = await startServices(firstRunner);

    const paused = await first.workspace.setBackgroundChecksEnabled(false);
    await first.workspace.saveInterest('Keep this unread while I am paused.');
    const networkWhilePaused = await first.network.diagnostics();
    expect(paused.backgroundChecks.enabled).toBe(false);
    expect(networkWhilePaused.backgroundChecks.enabled).toBe(true);
    expect(networkWhilePaused.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === USER_AGENT_ID,
    )?.enabled).toBe(false);
    expect(networkWhilePaused.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === source.agent.id,
    )?.enabled).toBe(true);

    await first.heartbeat.stop();
    const secondRunner = new RoutingHeartbeatRunner(repository);
    const secondHeartbeat = await createHeartbeat(secondRunner, true);
    const resumedWorkspace = new DiscoveryWorkspaceService(
      repository,
      secondHeartbeat,
      TEST_RUNTIME,
    );
    expect((await resumedWorkspace.snapshot()).backgroundChecks.enabled)
      .toBe(false);

    await resumedWorkspace.setBackgroundChecksEnabled(true);
    await vi.waitFor(async () => {
      expect(secondRunner.agentIds).toContain(USER_AGENT_ID);
      expect((await repository.requireUserAgent()).lastSeenSequence)
        .toBeGreaterThan(0);
    }, { interval: 10, timeout: 5_000 });
  });

  it('does not invoke a model runner for a scheduled task with an empty mailbox', async () => {
    const runner = new CountingHeartbeatRunner();
    const { heartbeat } = await startServices(runner);
    const taskStore = new FileHeartbeatTaskService({
      stateRoot: config.heddleStateRoot,
    });
    const task = (await taskStore.listTasks())[0];
    expect(task).toBeDefined();

    await taskStore.requestTaskRun(task!.id, { reason: 'test-empty-mailbox' });
    await vi.waitFor(async () => {
      const snapshot = await heartbeat.snapshot();
      expect(snapshot.tasks[0]?.lastRunAt).toBeDefined();
      expect(snapshot.running).toBe(false);
    }, { interval: 10, timeout: 5_000 });

    expect(runner.agentIds).toEqual([]);
    expect((await repository.readWorkspace()).currentWake).toBe(0);
    expect((await repository.readNetworkDiagnostics()).events.some(
      ({ kind }) => kind === 'agent_wake_started',
    )).toBe(false);
    const records = await taskStore.listRunRecords({
      taskId: task!.id,
      limit: 1,
    });
    expect(records[0]?.record.outcome?.kind).toBe('skipped');
  });

  it('rejects finishing an assignment wake before publishing its request', async () => {
    const runner = new FinishWithoutActionHeartbeatRunner(repository);
    const { heartbeat, workspace } = await startServices(runner);

    await workspace.saveInterest(
      'Find a concrete example of a representative learning from feedback.',
    );
    await vi.waitFor(async () => {
      expect((await heartbeat.snapshot()).tasks[0]?.status).toBe('failed');
    }, { interval: 10, timeout: 5_000 });

    const agent = await repository.requireUserAgent();
    const diagnostics = await repository.readNetworkDiagnostics();
    expect(agent.lastSeenSequence).toBe(0);
    expect(diagnostics.events.some(({ kind }) => kind === 'shared_message'))
      .toBe(false);
    expect(diagnostics.events.some(({ kind }) => (
      kind === 'agent_wake_no_action'
    ))).toBe(false);
    const checkCount = diagnostics.events.filter(({ kind }) => (
      kind === 'check_requested'
    )).length;
    await expect(workspace.runNow()).rejects.toThrow(
      'needs to be retried before starting another check',
    );
    expect((await repository.readNetworkDiagnostics()).events.filter(
      ({ kind }) => kind === 'check_requested',
    )).toHaveLength(checkCount);
    await expect(workspace.retryCurrentWake()).resolves.toBeDefined();
    expect((await repository.readNetworkDiagnostics()).events.filter(
      ({ kind }) => kind === 'check_requested',
    )).toHaveLength(checkCount);
  });

  it('supplies Lucid working history without requiring an existing Heddle checkpoint', async () => {
    const source = await registerSynthetic(repository, 'context-source');
    const interest = await repository.saveInterest(
      'Find concrete examples of preserving unfinished work.',
    );
    const sourceMessage = await repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: USER_AGENT_ID,
      title: 'First network example',
      content: 'A team retained abandoned drafts for later comparison.',
    });
    const finding = await repository.appendEvent({
      kind: 'finding_reported',
      actorAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'New finding for You',
      content: 'Abandoned drafts may preserve decision context.',
      metadata: { sourceEventIds: [sourceMessage.sequence] },
    });
    const feedback = await repository.saveFeedback(
      LOCAL_USER_ID,
      finding.sequence,
      'Only continue this direction with a named workflow.',
    );
    const note = await repository.appendEvent({
      kind: 'representative_note_updated',
      actorAgentId: USER_AGENT_ID,
      targetAgentId: USER_AGENT_ID,
      targetParticipantId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Require a named workflow before reporting this direction again.',
      metadata: { throughSequence: feedback.sequence, derived: true },
    });
    await repository.appendEvent({
      kind: 'shared_message',
      actorAgentId: USER_AGENT_ID,
      parentSequence: interest.sequence,
      title: 'Existing request for the saved interest',
      content: 'Who has a named workflow involving unfinished work?',
      metadata: { sourceEventIds: [interest.sequence] },
    });
    await repository.appendEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: USER_AGENT_ID,
      title: 'Later related network message',
      content: 'Another participant also retained rough drafts.',
    });

    const runner = new ContextCapturingHeartbeatRunner();
    const heartbeat = await createHeartbeat(runner, true);
    await heartbeat.triggerAgent(USER_AGENT_ID);
    await vi.waitFor(() => {
      expect(runner.wakes.some(({ agent }) => agent.id === USER_AGENT_ID))
        .toBe(true);
    }, { interval: 10, timeout: 5_000 });

    const userWake = runner.wakes.find(({ agent }) => agent.id === USER_AGENT_ID);
    expect(userWake?.workingContext).toMatchObject({
      principalInputs: [expect.objectContaining({ sequence: interest.sequence })],
      workingNote: expect.objectContaining({ sequence: note.sequence }),
      findings: [expect.objectContaining({
        finding: expect.objectContaining({ sequence: finding.sequence }),
        feedback: expect.objectContaining({ sequence: feedback.sequence }),
      })],
    });
  });

  it('reconciles one dynamic participant lifecycle without pausing the network', async () => {
    const { network } = await startServices(new CountingHeartbeatRunner());
    const registered = await network.registerParticipant({
      registrationKey: 'human:test:avery',
      kind: 'human',
      displayName: 'Avery',
      privateContext: 'Avery approved one personal observation.',
      contextApproved: true,
    });
    let diagnostics = await network.diagnostics();
    expect(diagnostics.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === registered.representativeAgentId,
    )?.enabled).toBe(true);

    diagnostics = await network.setParticipantEnabled(
      registered.participantId,
      false,
    );
    expect(diagnostics.backgroundChecks.enabled).toBe(true);
    expect(diagnostics.participants.find(
      ({ id }) => id === registered.participantId,
    )?.status).toBe('disabled');
    expect(diagnostics.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === registered.representativeAgentId,
    )?.enabled).toBe(false);

    diagnostics = await network.setParticipantEnabled(
      registered.participantId,
      true,
    );
    expect(diagnostics.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === registered.representativeAgentId,
    )?.enabled).toBe(true);

    diagnostics = await network.retireParticipant(registered.participantId);
    expect(diagnostics.participants.find(
      ({ id }) => id === registered.participantId,
    )?.status).toBe('retired');
    expect(diagnostics.backgroundChecks.tasks.map(({ agentId }) => agentId))
      .not.toContain(registered.representativeAgentId);
  });

  it('cancels one participant without aborting a running peer', async () => {
    config.heartbeatMaxConcurrency = 2;
    const sources = await Promise.all([
      registerSynthetic(repository, 'cancel-target'),
      registerSynthetic(repository, 'running-peer'),
    ]);
    const [target, peer] = sources;
    const runner = new CoordinatedHeartbeatRunner();
    const { network } = await startServices(runner);

    await Promise.all(sources.map(({ participant }, index) => (
      network.submitParticipantInput({
        participantId: participant.id,
        content: `Input for coordinated participant ${index}.`,
        idempotencyKey: `coordinated:${index}`,
      })
    )));
    await vi.waitFor(async () => {
      expect(runner.signalFor(target!.agent.id)).toBeDefined();
      expect(runner.signalFor(peer!.agent.id)).toBeDefined();
      expect((await repository.requireAgent(target!.agent.id)).status)
        .toBe('running');
      expect((await repository.requireAgent(peer!.agent.id)).status)
        .toBe('running');
    }, { interval: 10, timeout: 5_000 });

    const disabled = await network.setParticipantEnabled(
      target!.participant.id,
      false,
    );
    expect(runner.signalFor(target!.agent.id)?.aborted).toBe(true);
    expect(runner.signalFor(peer!.agent.id)?.aborted).toBe(false);
    expect(disabled.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === peer!.agent.id,
    )).toMatchObject({ enabled: true, status: 'running' });

    runner.release(peer!.agent.id);
    await vi.waitFor(async () => {
      expect((await repository.requireAgent(peer!.agent.id)).status).toBe('idle');
    }, { interval: 10, timeout: 5_000 });
  });

  it('resets dynamic nodes and derived tasks to the local participant only', async () => {
    const { network } = await startServices(new CountingHeartbeatRunner());
    await network.registerParticipant({
      registrationKey: 'sim:test:temporary',
      kind: 'synthetic',
      displayName: 'Temporary participant',
      privateContext: 'Temporary reset context.',
    });
    expect((await network.diagnostics()).participants).toHaveLength(2);

    const reset = await network.reset();
    expect(reset.participants.map(({ id }) => id)).toEqual([LOCAL_USER_ID]);
    expect(reset.agents.map(({ id }) => id)).toEqual([USER_AGENT_ID]);
    expect(reset.backgroundChecks.tasks.map(({ agentId }) => agentId))
      .toEqual([USER_AGENT_ID]);
  });

  it('recovers a Heddle task and its claimed mailbox wake after restart', async () => {
    await createHeartbeat(new CountingHeartbeatRunner(), false);
    const principalInput = await repository.saveParticipantInput(
      LOCAL_USER_ID,
      'Resume this exact input after a host restart.',
      'test:restart:principal-input',
    );
    const claimed = await repository.beginAgentWake(
      USER_AGENT_ID,
      'wake_before_host_restart',
    );
    const taskStore = new FileHeartbeatTaskService({
      stateRoot: config.heddleStateRoot,
    });
    const task = await taskStore.requireTask('lucid-representative-user-agent');
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
        .toBe(principalInput.sequence);
    }, { interval: 10, timeout: 5_000 });

    expect(runner.wakes[0]).toMatchObject({
      wakeId: claimed!.wakeId,
      wakeNumber: claimed!.wakeNumber,
      horizonSequence: claimed!.horizonSequence,
    });
    expect((await recoveredHeartbeat.snapshot()).tasks[0]?.status)
      .toBe('waiting');
  });

  async function startServices(
    runner: RepresentativeAgentHeartbeatRunner,
  ): Promise<{
    heartbeat: RepresentativeAgentHeartbeatService;
    workspace: DiscoveryWorkspaceService;
    network: ParticipantNetworkService;
  }> {
    const heartbeat = await createHeartbeat(runner, true);
    return {
      heartbeat,
      workspace: new DiscoveryWorkspaceService(
        repository,
        heartbeat,
        TEST_RUNTIME,
      ),
      network: new ParticipantNetworkService(
        repository,
        heartbeat,
        TEST_RUNTIME,
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
  readonly agentIds: string[] = [];

  constructor(private readonly repository: SqliteDiscoveryRepository) {}

  async run(
    input: RunRepresentativeAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    this.agentIds.push(input.wake.agent.id);
    const tools = new Map(
      (await createWakeTools(this.repository, input))
        .map((tool) => [tool.name, tool]),
    );
    const peerMessages = input.wake.visibleEvents.filter((event) => (
      event.actorAgentId !== input.wake.agent.id
      && ['shared_message', 'direct_message'].includes(event.kind)
    ));

    if (input.wake.agent.id === USER_AGENT_ID && peerMessages.length) {
      await requireSuccessfulToolResult(tools.get('report_finding')!.execute({
        content: 'Participant messages may connect to the saved interest.',
        source_event_ids: peerMessages.map(({ sequence }) => sequence),
      }));
    } else if (input.wake.agent.id === USER_AGENT_ID) {
      const request = input.wake.visibleEvents.find(({ kind }) => (
        kind === 'interest_saved' || kind === 'check_requested'
      ));
      await requireSuccessfulToolResult(tools.get('post_shared_message')!.execute({
        content: 'Does anyone have a specific observation connected to this request?',
        source_event_ids: request ? [request.sequence] : [],
      }));
    } else {
      const request = input.wake.visibleEvents.find(
        ({ kind }) => kind === 'shared_message',
      );
      const contribution = await tools.get('post_shared_message')!.execute({
        content: `One specific observation from ${input.wake.participant.displayName}.`,
        source_event_ids: request ? [request.sequence] : [],
      });
      if (!contribution.ok) {
        await requireSuccessfulToolResult(tools.get('finish_without_action')!.execute({
          reason: 'This representative already contributed to the thread.',
        }));
      }
    }

    return await runTestAgent(input, 'Representative action completed.');
  }
}

class CountingHeartbeatRunner implements RepresentativeAgentHeartbeatRunner {
  readonly agentIds: string[] = [];

  async run(
    input: RunRepresentativeAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    this.agentIds.push(input.wake.agent.id);
    return await runTestAgent(input, 'Counted one agent wake.');
  }
}

class ContextCapturingHeartbeatRunner
implements RepresentativeAgentHeartbeatRunner {
  readonly wakes: RunRepresentativeAgentHeartbeatInput['wake'][] = [];

  async run(
    input: RunRepresentativeAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    this.wakes.push(input.wake);
    return await runTestAgent(input, 'Captured one longitudinal wake.');
  }
}

class CoordinatedHeartbeatRunner implements RepresentativeAgentHeartbeatRunner {
  private readonly signals = new Map<string, AbortSignal>();
  private readonly releases = new Map<string, () => void>();

  async run(
    input: RunRepresentativeAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    const agentId = input.wake.agent.id;
    this.signals.set(agentId, input.execution.signal);
    await new Promise<void>((resolve) => {
      const release = () => {
        input.execution.signal.removeEventListener('abort', release);
        this.releases.delete(agentId);
        resolve();
      };
      this.releases.set(agentId, release);
      input.execution.signal.addEventListener('abort', release, { once: true });
    });
    return await runTestAgent(input, `Finished coordinated wake for ${agentId}.`);
  }

  signalFor(agentId: string): AbortSignal | undefined {
    return this.signals.get(agentId);
  }

  release(agentId: string): void {
    const release = this.releases.get(agentId);
    if (!release) {
      throw new Error(`No coordinated heartbeat is waiting for ${agentId}.`);
    }
    release();
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
    await requireSuccessfulToolResult(tools.get('finish_without_action')!.execute({
      reason: 'Recovered the interrupted wake.',
    }));
    return await runTestAgent(input, 'Recovered wake completed.');
  }
}

async function registerSynthetic(
  repository: SqliteDiscoveryRepository,
  key: string,
) {
  return await repository.registerParticipant({
    registrationKey: `sim:test:${key}`,
    kind: 'synthetic',
    displayName: `Synthetic ${key}`,
    privateContext: `Private context for ${key}.`,
  });
}

async function createWakeTools(
  repository: SqliteDiscoveryRepository,
  input: RunRepresentativeAgentHeartbeatInput,
) {
  const requiredRequestSourceIds = input.wake.visibleEvents
    .filter(({ kind }) => (
      kind === 'interest_saved' || kind === 'check_requested'
    ))
    .map(({ sequence }) => sequence);
  return await new AgentCommunicationToolService(
    repository,
    input.wake.agent,
    input.wake.participant,
    input.wake.wakeId,
    input.wake.wakeNumber,
    input.wake.horizonSequence,
    requiredRequestSourceIds,
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

async function runTestAgent(
  input: RunRepresentativeAgentHeartbeatInput,
  summary: string,
): Promise<AgentHeartbeatResult> {
  return await input.execution.runAgent({
    task: `Test ${input.wake.agent.name}`,
    systemContext: summary,
    includeDefaultTools: false,
    includePlanTool: false,
    onEvent: input.onEvent,
  });
}

function createHeartbeatResult(
  options: RunAgentHeartbeatOptions,
): AgentHeartbeatResult {
  const previousState = readCheckpointState(options.checkpoint);
  const timestamp = dayjs().toISOString();
  const state: AgentLoopState = {
    status: 'finished',
    runId: `run_${randomUUID()}`,
    goal: options.task,
    model: previousState?.model ?? options.model ?? 'gpt-5.4-mini',
    provider: previousState?.provider ?? 'openai',
    workspaceRoot:
      previousState?.workspaceRoot ?? options.workspaceRoot ?? '/tmp/lucid-test',
    startedAt: timestamp,
    finishedAt: timestamp,
    outcome: 'done',
    summary: options.systemContext ?? 'Deterministic heartbeat test completed.',
    transcript: previousState?.transcript ?? [],
    trace: [],
  };
  return {
    decision: 'pause',
    summary: state.summary,
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
    heartbeatMaxConcurrency: 1,
    preferApiKey: false,
  };
}

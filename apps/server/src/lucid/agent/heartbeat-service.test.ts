import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import dayjs from 'dayjs';
import {
  AgentLoopCheckpointService,
  FileHeartbeatTaskService,
  HeartbeatRunnerAgent,
  type AgentHeartbeatResult,
  type AgentLoopCheckpoint,
  type AgentLoopState,
  type RunAgentHeartbeatOptions,
} from '@heddleagent/runtime/advanced';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { LucidConfig } from '../../config.js';
import type { PostgresDatabase } from '../../infrastructure/postgres/database.js';
import {
  createPostgresTestStores,
  type PostgresTestStores,
} from '../persistence/postgres/test-context.js';
import { createLucidLogger } from '../../logger.js';
import {
  createAgentExecutionHost,
} from '../../runtime/agent-execution-composition.js';
import { AgentCommunicationToolService } from './communication/tool-service.js';
import {
  LOCAL_USER_ID,
  LOCAL_AGENT_ID,
} from '../local-user.js';
import { DiscoveryWorkspaceService } from '../workspace/service.js';
import type {
  AgentHeartbeatRunner,
  RunAgentHeartbeatInput,
} from './heddle-runner.js';
import { UserNetworkService } from '../network/service.js';
import {
  AgentHeartbeatService,
} from './heartbeat-service.js';
import { AGENT_TASK_ID_PREFIX } from './heartbeat-task-identity.js';
import type { AgentWorkingContextReader } from './store.js';

const TEST_RUNTIME = { model: 'gpt-5.4-mini', heddleVersion: 'test' };

describe('agent heartbeat service', () => {
  let database: PostgresDatabase;
  let stores: PostgresTestStores['stores'];
  let config: LucidConfig;
  let stateRoot: string;
  let heartbeats: AgentHeartbeatService[];

  beforeAll(async () => {
    ({ database, stores } = await createPostgresTestStores({
      applicationName: 'lucid-heartbeat-service-test',
      reset: false,
    }));
  });

  beforeEach(async () => {
    await stores.agent.reset({ backgroundChecksEnabled: true });
    stateRoot = mkdtempSync(join(tmpdir(), 'lucid-heartbeat-test-'));
    config = createTestConfig(stateRoot);
    heartbeats = [];
    vi.spyOn(HeartbeatRunnerAgent, 'run').mockImplementation(
      async (options) => createHeartbeatResult(options),
    );
  });

  afterEach(async () => {
    await Promise.all(heartbeats.map((heartbeat) => heartbeat.stop()));
    vi.restoreAllMocks();
    rmSync(stateRoot, { force: true, recursive: true });
  });

  afterAll(async () => database.close());

  it('routes dynamic user messages until the local user receives a finding', async () => {
    const sources = await Promise.all([
      registerSynthetic(stores, 'builder'),
      registerSynthetic(stores, 'organizer'),
    ]);
    const runner = new RoutingHeartbeatRunner(stores);
    const { workspace } = await startServices(runner);

    await workspace.saveInterest(
      LOCAL_USER_ID,
      'Look for products that connect knowledge held by different people.',
    );
    await vi.waitFor(async () => {
      const snapshot = await workspace.snapshot(LOCAL_USER_ID);
      expect(snapshot.findings.length).toBeGreaterThan(0);
      expect(snapshot.backgroundChecks.running).toBe(false);
    }, { interval: 10, timeout: 5_000 });

    const snapshot = await workspace.snapshot(LOCAL_USER_ID);
    const sourceIds = new Set(sources.map(({ user }) => user.id));
    expect(snapshot).not.toHaveProperty('agents');
    expect(snapshot).not.toHaveProperty('events');
    expect(snapshot.findings[0]?.sources.length).toBeGreaterThan(0);
    expect(snapshot.findings[0]?.sources.every(({ attribution }) => (
      attribution && sourceIds.has(attribution.userId)
    ))).toBe(true);
    expect(snapshot.findings[0]?.originatingSources).toHaveLength(2);
    expect(snapshot.networkActivity).toMatchObject({
      requestProgress: {
        phase: 'finding-reported',
        responseCount: 2,
        pendingReviewCount: 0,
        originatingResponseCount: 2,
        originatingUserCount: 2,
      },
    });
    expect(runner.agentIds).toContain(LOCAL_AGENT_ID);
    expect(runner.agentIds.some((agentId) => (
      sources.some(({ agent }) => agent.id === agentId)
    ))).toBe(true);
    expect(runner.agentIds.filter((agentId) => agentId === LOCAL_AGENT_ID))
      .toHaveLength(2);
    sources.forEach(({ agent }) => {
      expect(runner.agentIds.filter((agentId) => agentId === agent.id))
        .toHaveLength(1);
    });
    expect((await stores.network.readNetworkDiagnostics()).events.filter(
      ({ kind }) => kind === 'shared_message',
    )).toHaveLength(3);
  });

  it('turns user ingress into a durable targeted wake', async () => {
    const runner = new CountingHeartbeatRunner();
    const { network } = await startServices(runner);
    const registered = await network.registerUser({
      registrationKey: 'sim:test:ingress',
      kind: 'synthetic',
      displayName: 'Ingress user',
      privateContext: 'Receives changing external observations.',
    });

    const receipt = await network.submitUserInput({
      userId: registered.userId,
      content: 'A new observation arrived outside the product runtime.',
      idempotencyKey: 'sim:test:ingress:1',
    });
    await vi.waitFor(() => {
      expect(runner.agentIds).toContain(registered.agentId);
    }, { interval: 10, timeout: 5_000 });

    expect(receipt).toMatchObject({
      userId: registered.userId,
      agentId: registered.agentId,
    });
    const diagnostics = await network.diagnostics();
    expect(diagnostics.events).toContainEqual(expect.objectContaining({
      sequence: receipt.sequence,
      kind: 'user_input',
      targetAgentId: registered.agentId,
    }));
  });

  it('serializes concurrent user registration into one consistent task set', async () => {
    const { network } = await startServices(new CountingHeartbeatRunner());
    const registrations = await Promise.all(
      ['one', 'two', 'three', 'four'].map((key) => (
        network.registerUser({
          registrationKey: `sim:test:parallel:${key}`,
          kind: 'synthetic',
          displayName: `Parallel ${key}`,
          privateContext: `Independent private context for ${key}.`,
        })
      )),
    );

    const diagnostics = await network.diagnostics();
    expect(new Set(registrations.map(({ userId }) => userId)).size)
      .toBe(4);
    expect(diagnostics.users).toHaveLength(5);
    expect(diagnostics.backgroundChecks.tasks).toHaveLength(5);
    expect(diagnostics.backgroundChecks.tasks.every(({ enabled }) => enabled))
      .toBe(true);
  });

  it('persists the local listening preference without pausing peer agents', async () => {
    const source = await registerSynthetic(stores, 'always-listening-peer');
    const firstRunner = new CountingHeartbeatRunner();
    const first = await startServices(firstRunner);

    const paused = await first.workspace.setBackgroundChecksEnabled(LOCAL_USER_ID,false);
    await first.workspace.saveInterest(
      LOCAL_USER_ID,
      'Keep this unread while I am paused.',
    );
    const networkWhilePaused = await first.network.diagnostics();
    expect(paused.backgroundChecks.enabled).toBe(false);
    expect(networkWhilePaused.backgroundChecks.enabled).toBe(true);
    expect(networkWhilePaused.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === LOCAL_AGENT_ID,
    )?.enabled).toBe(false);
    expect(networkWhilePaused.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === source.agent.id,
    )?.enabled).toBe(true);

    await first.heartbeat.stop();
    const secondRunner = new RoutingHeartbeatRunner(stores);
    const secondHeartbeat = await createHeartbeat(secondRunner, true);
    const resumedWorkspace = new DiscoveryWorkspaceService(
      stores.workspace,
      secondHeartbeat,
      TEST_RUNTIME,
    );
    expect((await resumedWorkspace.snapshot(LOCAL_USER_ID)).backgroundChecks.enabled)
      .toBe(false);

    await resumedWorkspace.setBackgroundChecksEnabled(LOCAL_USER_ID,true);
    await vi.waitFor(async () => {
      expect(secondRunner.agentIds).toContain(LOCAL_AGENT_ID);
      expect((await requireAgent(stores, LOCAL_AGENT_ID)).lastSeenSequence)
        .toBeGreaterThan(0);
    }, { interval: 10, timeout: 5_000 });
  });

  it('preserves user task preferences across a global pause and restart', async () => {
    const peer = await registerSynthetic(stores, 'global-pause-peer');
    const first = await startServices(new CountingHeartbeatRunner());

    await first.workspace.setBackgroundChecksEnabled(LOCAL_USER_ID,false);
    await first.heartbeat.setGlobalBackgroundChecksEnabled(false);
    await first.heartbeat.reconcileAgentTasks();

    let diagnostics = await first.network.diagnostics();
    expect(diagnostics.backgroundChecks.enabled).toBe(true);
    expect(diagnostics.backgroundChecks.dispatchEnabled).toBe(false);
    expect(diagnostics.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === LOCAL_AGENT_ID,
    )?.enabled).toBe(false);
    expect(diagnostics.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === peer.agent.id,
    )?.enabled).toBe(true);

    await first.heartbeat.stop();
    const second = await createHeartbeat(new CountingHeartbeatRunner(), true);
    await second.reconcileAgentTasks();
    diagnostics = await new UserNetworkService(
      stores.network,
      second,
      TEST_RUNTIME,
    ).diagnostics();
    expect(diagnostics.backgroundChecks.enabled).toBe(true);
    expect(diagnostics.backgroundChecks.dispatchEnabled).toBe(false);
    expect(diagnostics.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === LOCAL_AGENT_ID,
    )?.enabled).toBe(false);
    expect(diagnostics.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === peer.agent.id,
    )?.enabled).toBe(true);
  });

  it('cancels owned work on global pause and dispatches persisted intent on resume', async () => {
    const source = await registerSynthetic(stores, 'global-gate-source');
    const runner = new PauseThenCompleteHeartbeatRunner();
    const { heartbeat, network } = await startServices(runner);

    await network.submitUserInput({
      userId: source.user.id,
      content: 'Begin one wake before the operator pause.',
      idempotencyKey: 'global-gate:before-pause',
    });
    await vi.waitFor(() => expect(runner.firstSignal).toBeDefined());

    await heartbeat.setGlobalBackgroundChecksEnabled(false);
    expect(runner.firstSignal?.aborted).toBe(true);
    expect((await heartbeat.snapshot()).tasks.find(
      ({ agentId }) => agentId === source.agent.id,
    )).toMatchObject({ enabled: true });

    await network.submitUserInput({
      userId: source.user.id,
      content: 'Persist this while global dispatch is paused.',
      idempotencyKey: 'global-gate:while-paused',
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(runner.agentIds).toHaveLength(1);
    const task = await new FileHeartbeatTaskService({
      stateRoot: config.heddleStateRoot,
    }).loadTask(`lucid-representative-${source.agent.id}`);
    expect(task?.state?.runRequest?.generation).toBeGreaterThan(
      task?.state?.runRequest?.claimedGeneration ?? 0,
    );

    await heartbeat.setGlobalBackgroundChecksEnabled(true);
    await vi.waitFor(async () => {
      expect(runner.agentIds).toHaveLength(2);
      expect((await requireAgent(stores, source.agent.id)).lastSeenSequence)
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
    expect((await stores.agent.readWorkspace()).currentWake).toBe(0);
    expect((await stores.network.readNetworkDiagnostics()).events.some(
      ({ kind }) => kind === 'agent_wake_started',
    )).toBe(false);
    const records = await taskStore.listRunRecords({
      taskId: task!.id,
      limit: 1,
    });
    expect(records[0]?.record.outcome?.kind).toBe('skipped');
  });

  it('releases a wake claim when working-context projection fails', async () => {
    const runner = new CountingHeartbeatRunner();
    const readAgentWorkingContext = vi.fn(async () => {
      throw new Error('Working context projection is unavailable.');
    });
    const heartbeat = await createHeartbeat(runner, true, {
      readAgentWorkingContext,
    });
    await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Keep this assignment retryable after a context projection failure.',
    );

    await heartbeat.triggerAgent(LOCAL_AGENT_ID);
    await vi.waitFor(async () => {
      expect((await requireAgent(stores, LOCAL_AGENT_ID)).status).toBe('error');
      expect((await heartbeat.snapshot()).running).toBe(false);
    }, { interval: 10, timeout: 5_000 });

    expect(readAgentWorkingContext).toHaveBeenCalledTimes(1);
    expect(runner.agentIds).toEqual([]);
    const failedAgent = await requireAgent(stores, LOCAL_AGENT_ID);
    const retry = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'retry_after_context_failure',
    );
    expect(retry).toMatchObject({
      wakeId: failedAgent.activeWakeId,
      wakeNumber: failedAgent.activeWakeNumber,
      horizonSequence: failedAgent.activeWakeHorizon,
    });
    await stores.agent.interruptAgentWake(
      LOCAL_AGENT_ID,
      retry!.claimToken,
    );
    expect((await requireAgent(stores, LOCAL_AGENT_ID)).status).toBe('idle');
  });

  it('rejects finishing an assignment wake before publishing its request', async () => {
    const runner = new FinishWithoutActionHeartbeatRunner(stores);
    const { heartbeat, workspace } = await startServices(runner);

    await workspace.saveInterest(
      LOCAL_USER_ID,
      'Find a concrete example of a agent learning from feedback.',
    );
    await vi.waitFor(async () => {
      expect((await heartbeat.snapshot()).tasks[0]?.status).toBe('failed');
    }, { interval: 10, timeout: 5_000 });

    const agent = await requireAgent(stores, LOCAL_AGENT_ID);
    const diagnostics = await stores.network.readNetworkDiagnostics();
    expect(agent.lastSeenSequence).toBe(0);
    expect(diagnostics.events.some(({ kind }) => kind === 'shared_message'))
      .toBe(false);
    expect(diagnostics.events.some(({ kind }) => (
      kind === 'agent_wake_no_action'
    ))).toBe(false);
    const checkCount = diagnostics.events.filter(({ kind }) => (
      kind === 'check_requested'
    )).length;
    await expect(workspace.runNow(LOCAL_USER_ID)).rejects.toThrow(
      'needs to be retried before starting another check',
    );
    expect((await stores.network.readNetworkDiagnostics()).events.filter(
      ({ kind }) => kind === 'check_requested',
    )).toHaveLength(checkCount);
    await expect(workspace.retryCurrentWake(LOCAL_USER_ID)).resolves.toBeDefined();
    expect((await stores.network.readNetworkDiagnostics()).events.filter(
      ({ kind }) => kind === 'check_requested',
    )).toHaveLength(checkCount);
  });

  it('rejects a guidance wake that does not revise the durable working note', async () => {
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find early signals about durable personal agents.',
    );
    const initialWake = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
      'wake_before_direct_guidance',
    );
    expect(initialWake).toBeDefined();
    await stores.communication.appendCommunicationEvent({
      wakeNumber: initialWake!.wakeNumber,
      kind: 'shared_message',
      actorAgentId: LOCAL_AGENT_ID,
      replyToSequence: interest.sequence,
      title: 'Initial network request',
      content: 'Looking for early signals about durable personal agents.',
      metadata: { sourceEventIds: [interest.sequence], messageRole: 'request' },
    });
    await stores.agent.completeAgentWake(
      LOCAL_AGENT_ID,
      initialWake!.claimToken,
      initialWake!.horizonSequence,
    );

    const runner = new IgnoreGuidanceHeartbeatRunner(stores);
    const { heartbeat, workspace } = await startServices(runner);

    const withGuidance = await workspace.submitGuidance(
      LOCAL_USER_ID,
      'Weak signals are useful again, but label them clearly.',
    );
    const guidance = withGuidance.guidanceFollowThrough?.guidance;
    expect(guidance).toBeDefined();
    await vi.waitFor(async () => {
      expect(runner.guidanceRuns).toBe(1);
      expect((await requireAgent(stores, LOCAL_AGENT_ID)).status).toBe('error');
      expect((await heartbeat.snapshot()).running).toBe(false);
    }, { interval: 10, timeout: 5_000 });

    const agent = await requireAgent(stores, LOCAL_AGENT_ID);
    expect(agent.status).toBe('error');
    expect(agent.lastSeenSequence).toBeLessThan(guidance!.sequence);
    expect(await stores.agent.hasAgentUpdatedWorkingNoteThrough(
      LOCAL_AGENT_ID,
      guidance!.sequence,
    )).toBe(false);
  });

  it('supplies Lucid working history without requiring an existing Heddle checkpoint', async () => {
    const source = await registerSynthetic(stores, 'context-source');
    const interest = await stores.workspace.saveInterest(
      LOCAL_USER_ID,
      'Find concrete examples of preserving unfinished work.',
    );
    const sourceMessage = await stores.communication.appendCommunicationEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: LOCAL_AGENT_ID,
      title: 'First network example',
      content: 'A team retained abandoned drafts for later comparison.',
    });
    const finding = await stores.communication.appendCommunicationEvent({
      kind: 'finding_reported',
      actorAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'New finding for You',
      content: 'Abandoned drafts may preserve decision context.',
      metadata: { sourceEventIds: [sourceMessage.sequence] },
    });
    const feedback = await stores.workspace.saveFeedback(
      LOCAL_USER_ID,
      finding.sequence,
      'Only continue this direction with a named workflow.',
    );
    const note = await stores.communication.appendCommunicationEvent({
      kind: 'agent_note_updated',
      actorAgentId: LOCAL_AGENT_ID,
      targetAgentId: LOCAL_AGENT_ID,
      targetUserId: LOCAL_USER_ID,
      title: 'Lucid updates its private working note',
      content: 'Require a named workflow before reporting this direction again.',
      metadata: { throughSequence: feedback.sequence, derived: true },
    });
    await stores.communication.appendCommunicationEvent({
      kind: 'shared_message',
      actorAgentId: LOCAL_AGENT_ID,
      replyToSequence: interest.sequence,
      title: 'Existing request for the saved interest',
      content: 'Who has a named workflow involving unfinished work?',
      metadata: { sourceEventIds: [interest.sequence] },
    });
    await stores.communication.appendCommunicationEvent({
      kind: 'direct_message',
      actorAgentId: source.agent.id,
      targetAgentId: LOCAL_AGENT_ID,
      title: 'Later related network message',
      content: 'Another user also retained rough drafts.',
    });

    const runner = new ContextCapturingHeartbeatRunner();
    const heartbeat = await createHeartbeat(runner, true);
    await heartbeat.triggerAgent(LOCAL_AGENT_ID);
    await vi.waitFor(() => {
      expect(runner.wakes.some(({ agent }) => agent.id === LOCAL_AGENT_ID))
        .toBe(true);
    }, { interval: 10, timeout: 5_000 });

    const userWake = runner.wakes.find(({ agent }) => agent.id === LOCAL_AGENT_ID);
    expect(userWake?.workingContext).toMatchObject({
      principalInputs: [expect.objectContaining({ sequence: interest.sequence })],
      workingNote: expect.objectContaining({ sequence: note.sequence }),
      findings: [expect.objectContaining({
        finding: expect.objectContaining({ sequence: finding.sequence }),
        feedback: expect.objectContaining({ sequence: feedback.sequence }),
      })],
    });
  });

  it('reconciles one dynamic user lifecycle without pausing the network', async () => {
    const { network } = await startServices(new CountingHeartbeatRunner());
    const registered = await network.registerUser({
      registrationKey: 'human:test:avery',
      kind: 'human',
      displayName: 'Avery',
      privateContext: 'Avery approved one personal observation.',
      contextApproved: true,
    });
    let diagnostics = await network.diagnostics();
    expect(diagnostics.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === registered.agentId,
    )?.enabled).toBe(true);

    diagnostics = await network.setUserEnabled(
      registered.userId,
      false,
    );
    expect(diagnostics.backgroundChecks.enabled).toBe(true);
    expect(diagnostics.users.find(
      ({ id }) => id === registered.userId,
    )?.status).toBe('disabled');
    expect(diagnostics.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === registered.agentId,
    )?.enabled).toBe(false);

    diagnostics = await network.setUserEnabled(
      registered.userId,
      true,
    );
    expect(diagnostics.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === registered.agentId,
    )?.enabled).toBe(true);

    diagnostics = await network.retireUser(registered.userId);
    expect(diagnostics.users.find(
      ({ id }) => id === registered.userId,
    )?.status).toBe('retired');
    expect(diagnostics.backgroundChecks.tasks.map(({ agentId }) => agentId))
      .not.toContain(registered.agentId);
  });

  it('cancels one user without aborting a running peer', async () => {
    config.heartbeatMaxConcurrency = 2;
    const sources = await Promise.all([
      registerSynthetic(stores, 'cancel-target'),
      registerSynthetic(stores, 'running-peer'),
    ]);
    const [target, peer] = sources;
    const runner = new CoordinatedHeartbeatRunner();
    const heartbeat = await createHeartbeat(runner, false);
    const network = new UserNetworkService(
      stores.network,
      heartbeat,
      TEST_RUNTIME,
    );

    await Promise.all(sources.map(({ user }, index) => (
      network.submitUserInput({
        userId: user.id,
        content: `Input for coordinated user ${index}.`,
        idempotencyKey: `coordinated:${index}`,
      })
    )));
    // Persist both due requests before the scheduler's first scan so this test
    // deterministically exercises two concurrently admitted tasks.
    heartbeat.start();
    await vi.waitFor(async () => {
      expect(runner.signalFor(target!.agent.id)).toBeDefined();
      expect(runner.signalFor(peer!.agent.id)).toBeDefined();
      expect((await requireAgent(stores, target!.agent.id)).status)
        .toBe('running');
      expect((await requireAgent(stores, peer!.agent.id)).status)
        .toBe('running');
    }, { interval: 10, timeout: 5_000 });

    const disabled = await network.setUserEnabled(
      target!.user.id,
      false,
    );
    expect(runner.signalFor(target!.agent.id)?.aborted).toBe(true);
    expect(runner.signalFor(peer!.agent.id)?.aborted).toBe(false);
    expect(disabled.backgroundChecks.tasks.find(
      ({ agentId }) => agentId === peer!.agent.id,
    )).toMatchObject({ enabled: true, status: 'running' });

    runner.release(peer!.agent.id);
    await vi.waitFor(async () => {
      expect((await requireAgent(stores, peer!.agent.id)).status).toBe('idle');
    }, { interval: 10, timeout: 5_000 });
  });

  it('resets dynamic nodes and derived tasks to the local user only', async () => {
    const { network } = await startServices(new CountingHeartbeatRunner());
    await network.registerUser({
      registrationKey: 'sim:test:temporary',
      kind: 'synthetic',
      displayName: 'Temporary user',
      privateContext: 'Temporary reset context.',
    });
    expect((await network.diagnostics()).users).toHaveLength(2);

    const reset = await network.reset();
    expect(reset.users.map(({ id }) => id)).toEqual([LOCAL_USER_ID]);
    expect(reset.agents.map(({ id }) => id)).toEqual([LOCAL_AGENT_ID]);
    expect(reset.backgroundChecks.tasks.map(({ agentId }) => agentId))
      .toEqual([LOCAL_AGENT_ID]);
  });

  it('recovers a Heddle task and its claimed mailbox wake after restart', async () => {
    await createHeartbeat(new CountingHeartbeatRunner(), false);
    const principalInput = await stores.network.saveUserInput(
      LOCAL_USER_ID,
      'Resume this exact input after a host restart.',
      'test:restart:principal-input',
    );
    const claimed = await stores.agent.beginAgentWake(
      LOCAL_AGENT_ID,
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
        execution: {
          executionId: claimed!.claimToken,
          ownerId: 'simulated-stopped-host',
          claimedAt: dayjs().toISOString(),
        },
        updatedAt: dayjs().toISOString(),
      },
    });

    await stores.agent.initialize();
    const runner = new FinishWithoutActionHeartbeatRunner(stores);
    const recoveredHeartbeat = await createHeartbeat(runner, true);
    await vi.waitFor(async () => {
      expect(runner.wakes).toHaveLength(1);
      expect((await requireAgent(stores, LOCAL_AGENT_ID)).lastSeenSequence)
        .toBe(principalInput.sequence);
      // Product settlement happens inside the handler; Heddle transitions the
      // task back to waiting only after that handler resolves.
      expect((await recoveredHeartbeat.snapshot()).tasks[0]?.status)
        .toBe('waiting');
    }, { interval: 10, timeout: 5_000 });

    expect(runner.wakes[0]).toMatchObject({
      wakeId: claimed!.wakeId,
      wakeNumber: claimed!.wakeNumber,
      horizonSequence: claimed!.horizonSequence,
    });
  });

  async function startServices(
    runner: AgentHeartbeatRunner,
  ): Promise<{
    heartbeat: AgentHeartbeatService;
    workspace: DiscoveryWorkspaceService;
    network: UserNetworkService;
  }> {
    const heartbeat = await createHeartbeat(runner, true);
    return {
      heartbeat,
      workspace: new DiscoveryWorkspaceService(
        stores.workspace,
        heartbeat,
        TEST_RUNTIME,
      ),
      network: new UserNetworkService(
        stores.network,
        heartbeat,
        TEST_RUNTIME,
      ),
    };
  }

  async function createHeartbeat(
    runner: AgentHeartbeatRunner,
    start: boolean,
    workingContext: AgentWorkingContextReader = stores.workspace,
  ): Promise<AgentHeartbeatService> {
    const tasks = new FileHeartbeatTaskService({
      stateRoot: config.heddleStateRoot,
    });
    const executionHost = createAgentExecutionHost({
      config,
      store: stores.agent,
      taskStore: tasks,
      taskIdPrefix: AGENT_TASK_ID_PREFIX,
      logger: createLucidLogger('silent'),
    });
    const heartbeat = new AgentHeartbeatService(
      stores.agent,
      workingContext,
      runner,
      config,
      createLucidLogger('silent'),
      tasks,
      tasks,
      executionHost,
    );
    await heartbeat.initialize();
    if (start) {
      heartbeat.start();
    }
    heartbeats.push(heartbeat);
    return heartbeat;
  }
});

class RoutingHeartbeatRunner implements AgentHeartbeatRunner {
  readonly agentIds: string[] = [];

  constructor(private readonly stores: PostgresTestStores['stores']) {}

  async run(
    input: RunAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    this.agentIds.push(input.wake.agent.id);
    const tools = new Map(
      (await createWakeTools(this.stores, input))
        .map((tool) => [tool.name, tool]),
    );
    const peerMessages = input.wake.visibleEvents.filter((event) => (
      event.actorAgentId !== input.wake.agent.id
      && ['shared_message', 'direct_message'].includes(event.kind)
    ));

    if (input.wake.agent.id === LOCAL_AGENT_ID && peerMessages.length) {
      await requireSuccessfulToolResult(tools.get('report_finding')!.execute({
        content: 'User messages may connect to the saved interest.',
        source_event_ids: peerMessages.map(({ sequence }) => sequence),
      }));
    } else if (input.wake.agent.id === LOCAL_AGENT_ID) {
      const request = input.wake.visibleEvents.find(({ kind }) => (
        kind === 'interest_saved' || kind === 'check_requested'
      ));
      await requireSuccessfulToolResult(tools.get('post_shared_message')!.execute({
        reply_to_event_id: request!.sequence,
        content: 'Does anyone have a specific observation connected to this request?',
        source_event_ids: request ? [request.sequence] : [],
      }));
    } else {
      const request = input.wake.visibleEvents.find(
        ({ kind }) => kind === 'shared_message',
      );
      const contribution = await tools.get('post_shared_message')!.execute({
        reply_to_event_id: request!.sequence,
        content: `One specific observation from ${input.wake.user.displayName}.`,
        source_event_ids: request ? [request.sequence] : [],
      });
      if (!contribution.ok) {
        await requireSuccessfulToolResult(tools.get('finish_without_action')!.execute({
          reason: 'This agent already contributed to the thread.',
        }));
      }
    }

    return await runTestAgent(input, 'Agent action completed.');
  }
}

class CountingHeartbeatRunner implements AgentHeartbeatRunner {
  readonly agentIds: string[] = [];

  async run(
    input: RunAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    this.agentIds.push(input.wake.agent.id);
    return await runTestAgent(input, 'Counted one agent wake.');
  }
}

class PauseThenCompleteHeartbeatRunner
implements AgentHeartbeatRunner {
  readonly agentIds: string[] = [];
  firstSignal?: AbortSignal;

  async run(
    input: RunAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    this.agentIds.push(input.wake.agent.id);
    if (this.agentIds.length === 1) {
      this.firstSignal = input.execution.signal;
      await aborted(input.execution.signal);
    }
    return await runTestAgent(input, 'Observed the global dispatch gate.');
  }
}

class ContextCapturingHeartbeatRunner
implements AgentHeartbeatRunner {
  readonly wakes: RunAgentHeartbeatInput['wake'][] = [];

  async run(
    input: RunAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    this.wakes.push(input.wake);
    return await runTestAgent(input, 'Captured one longitudinal wake.');
  }
}

class CoordinatedHeartbeatRunner implements AgentHeartbeatRunner {
  private readonly signals = new Map<string, AbortSignal>();
  private readonly releases = new Map<string, () => void>();

  async run(
    input: RunAgentHeartbeatInput,
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
implements AgentHeartbeatRunner {
  readonly wakes: Array<{
    wakeId: string;
    wakeNumber: number;
    horizonSequence: number;
  }> = [];

  constructor(private readonly stores: PostgresTestStores['stores']) {}

  async run(
    input: RunAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    this.wakes.push({
      wakeId: input.wake.wakeId,
      wakeNumber: input.wake.wakeNumber,
      horizonSequence: input.wake.horizonSequence,
    });
    const tools = new Map(
      (await createWakeTools(this.stores, input))
        .map((tool) => [tool.name, tool]),
    );
    if (input.wake.visibleEvents.some(({ kind }) => kind === 'user_input')) {
      await requireSuccessfulToolResult(
        tools.get('read_open_requests')!.execute({}),
      );
    }
    await requireSuccessfulToolResult(tools.get('finish_without_action')!.execute({
      reason: 'Recovered the interrupted wake.',
    }));
    return await runTestAgent(input, 'Recovered wake completed.');
  }
}

class IgnoreGuidanceHeartbeatRunner
implements AgentHeartbeatRunner {
  guidanceRuns = 0;

  constructor(private readonly stores: PostgresTestStores['stores']) {}

  async run(
    input: RunAgentHeartbeatInput,
  ): Promise<AgentHeartbeatResult> {
    const guidance = input.wake.visibleEvents.find(
      ({ kind }) => kind === 'guidance_saved',
    );
    if (guidance) {
      this.guidanceRuns += 1;
      // Deliberately bypass domain tools so this test exercises the service's
      // defense-in-depth postcondition rather than only the tool gate.
      return await runTestAgent(input, 'Ignored direct user guidance.');
    }

    const interest = input.wake.visibleEvents.find(
      ({ kind }) => kind === 'interest_saved',
    );
    const tools = new Map(
      (await createWakeTools(this.stores, input))
        .map((tool) => [tool.name, tool]),
    );
    await requireSuccessfulToolResult(tools.get('post_shared_message')!.execute({
      reply_to_event_id: interest!.sequence,
      content: 'Looking for early signals about durable personal agents.',
      source_event_ids: [interest!.sequence],
    }));
    return await runTestAgent(input, 'Published the initial network request.');
  }
}

async function registerSynthetic(
  stores: PostgresTestStores['stores'],
  key: string,
) {
  return await stores.network.registerUser({
    registrationKey: `sim:test:${key}`,
    kind: 'synthetic',
    displayName: `Synthetic ${key}`,
    privateContext: `Private context for ${key}.`,
  });
}

async function createWakeTools(
  stores: PostgresTestStores['stores'],
  input: RunAgentHeartbeatInput,
) {
  const requiredRequestSourceIds = input.wake.visibleEvents
    .filter(({ kind }) => (
      kind === 'interest_saved' || kind === 'check_requested'
    ))
    .map(({ sequence }) => sequence);
  const requiredWorkingNoteSourceIds = input.wake.visibleEvents
    .filter(({ kind }) => kind === 'guidance_saved')
    .map(({ sequence }) => sequence);
  return await new AgentCommunicationToolService(
    stores.communication,
    input.wake.agent,
    input.wake.user,
    input.wake.wakeId,
    input.wake.wakeNumber,
    input.wake.horizonSequence,
    requiredRequestSourceIds,
    requiredWorkingNoteSourceIds,
  ).definitions();
}

async function requireAgent(
  stores: PostgresTestStores['stores'],
  agentId: string,
) {
  const agent = (await stores.agent.listAgents())
    .find(({ id }) => id === agentId);
  if (!agent) {
    throw new Error(`Agent not found: ${agentId}`);
  }
  return agent;
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
  input: RunAgentHeartbeatInput,
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

async function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
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
    authentication: { mode: 'development' },
    repoRoot: stateRoot,
    stateRoot,
    databaseUrl: 'postgresql://test.invalid/lucid',
    heddleStateRoot: join(stateRoot, 'heddle'),
    model: 'gpt-5.4-mini',
    maxSteps: 4,
    heartbeatIntervalMs: 60_000,
    heartbeatPollMs: 5,
    heartbeatMaxConcurrency: 1,
    heartbeatNamespace: 'lucid:test:agents',
    heartbeatExecutionLeaseMs: 60_000,
    heartbeatRecoveryIntervalMs: 10_000,
    heartbeatInvocationTimeoutMs: 30_000,
    preferApiKey: false,
  };
}

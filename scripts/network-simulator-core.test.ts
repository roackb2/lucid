import assert from 'node:assert/strict';
import test from 'node:test';
import {
  runLongitudinalPhase,
  runSimulationPass,
  runSimulationTick,
  type LongitudinalNetworkPhase,
  type NetworkSimulatorApi,
} from './network-simulator-core.js';
import type { NetworkScenario } from './network-scenarios.js';

const scenarios = [
  {
    key: 'builder',
    displayName: 'Builder',
    privateContext: 'Builds small tools.',
    inputs: ['first observation', 'second observation'],
  },
  {
    key: 'artist',
    displayName: 'Artist',
    privateContext: 'Makes visual work.',
    inputs: ['third observation', 'fourth observation'],
  },
] satisfies NetworkScenario[];

test('a seeded pass registers every scenario and emits idempotent input', async () => {
  const fake = createFakeApi();

  const first = await runSimulationPass(fake.api, scenarios, {
    seed: 'stable-world',
    runId: 'cron-42',
  });
  const second = await runSimulationPass(fake.api, scenarios, {
    seed: 'stable-world',
    runId: 'cron-42',
  });

  assert.deepEqual(
    first.map(({ content }) => content),
    second.map(({ content }) => content),
  );
  assert.equal(fake.registrations.length, 4);
  assert.equal(new Set(fake.registrations.map(({ registrationKey }) => (
    registrationKey
  ))).size, 2);
  assert.deepEqual(
    fake.inputs.slice(0, 2).map(({ idempotencyKey }) => idempotencyKey),
    fake.inputs.slice(2).map(({ idempotencyKey }) => idempotencyKey),
  );
});

test('continuous ticks choose a deterministic scenario for a seed and tick', async () => {
  const firstFake = createFakeApi();
  const secondFake = createFakeApi();

  const first = await runSimulationTick(firstFake.api, scenarios, {
    seed: 'world',
    runId: 'session',
    tick: 7,
  });
  const second = await runSimulationTick(secondFake.api, scenarios, {
    seed: 'world',
    runId: 'session',
    tick: 7,
  });

  assert.equal(first.scenarioKey, second.scenarioKey);
  assert.equal(first.content, second.content);
  assert.equal(
    firstFake.inputs[0]?.idempotencyKey,
    secondFake.inputs[0]?.idempotencyKey,
  );
});

test('a longitudinal phase emits only its ordered idempotent inputs', async () => {
  const fake = createFakeApi();
  const phase = {
    key: 'refinement',
    title: 'One refinement',
    purpose: 'Exercise one later feedback cycle.',
    operatorInstruction: 'Inspect and give feedback.',
    inputs: [
      { scenarioKey: 'artist', content: 'a later concrete observation' },
      { scenarioKey: 'builder', content: 'a deliberate restatement' },
    ],
  } satisfies LongitudinalNetworkPhase;

  const first = await runLongitudinalPhase(fake.api, scenarios, phase, {
    experimentId: 'learning-42',
  });
  const second = await runLongitudinalPhase(fake.api, scenarios, phase, {
    experimentId: 'learning-42',
  });

  assert.deepEqual(
    first.map(({ phaseKey, scenarioKey, content }) => ({
      phaseKey,
      scenarioKey,
      content,
    })),
    [
      {
        phaseKey: 'refinement',
        scenarioKey: 'artist',
        content: 'a later concrete observation',
      },
      {
        phaseKey: 'refinement',
        scenarioKey: 'builder',
        content: 'a deliberate restatement',
      },
    ],
  );
  assert.deepEqual(
    fake.inputs.slice(0, 2).map(({ idempotencyKey }) => idempotencyKey),
    fake.inputs.slice(2).map(({ idempotencyKey }) => idempotencyKey),
  );
  assert.equal(second.length, first.length);
});

test('a longitudinal phase rejects an unknown user scenario', async () => {
  const fake = createFakeApi();
  const phase = {
    key: 'invalid',
    title: 'Invalid phase',
    purpose: 'Prove scenario references are checked.',
    operatorInstruction: 'This phase must fail.',
    inputs: [{ scenarioKey: 'missing', content: 'unroutable input' }],
  } satisfies LongitudinalNetworkPhase;

  await assert.rejects(
    runLongitudinalPhase(fake.api, scenarios, phase, {
      experimentId: 'learning-invalid',
    }),
    /references unknown scenario: missing/,
  );
  assert.equal(fake.registrations.length, 0);
  assert.equal(fake.inputs.length, 0);
});

function createFakeApi() {
  const registrations: Parameters<NetworkSimulatorApi['registerUser']>[0][] = [];
  const inputs: Parameters<NetworkSimulatorApi['submitUserInput']>[0][] = [];
  const userIdByRegistrationKey = new Map<string, string>();
  const api: NetworkSimulatorApi = {
    async registerUser(input) {
      registrations.push(input);
      const userId = userIdByRegistrationKey.get(
        input.registrationKey,
      ) ?? `user-${userIdByRegistrationKey.size + 1}`;
      userIdByRegistrationKey.set(input.registrationKey, userId);
      return {
        created: registrations.filter(({ registrationKey }) => (
          registrationKey === input.registrationKey
        )).length === 1,
        userId,
        agentId: `agent-${userId}`,
        displayName: input.displayName,
        kind: 'synthetic',
      };
    },
    async submitUserInput(input) {
      inputs.push(input);
      return {
        userId: input.userId,
        agentId: `agent-${input.userId}`,
        eventId: `event-${inputs.length}`,
        sequence: inputs.length,
      };
    },
  };
  return { api, registrations, inputs };
}

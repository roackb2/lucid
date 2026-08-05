/**
 * Development simulator orchestration boundary.
 *
 * This module creates exogenous participant input through Lucid's public
 * development ingress. It never imports a database adapter, Heddle task store,
 * or product-initialization fixture, so the simulated world remains replaceable
 * tooling rather than product behavior.
 */
import { createHash } from 'node:crypto';
import seedrandom from 'seedrandom';
import type { NetworkScenario } from './network-scenarios.js';

export type ParticipantRegistration = {
  created: boolean;
  participantId: string;
  representativeAgentId: string;
  displayName: string;
  kind: 'human' | 'synthetic';
};

export type ParticipantInputReceipt = {
  participantId: string;
  representativeAgentId: string;
  eventId: string;
  sequence: number;
};

export interface NetworkSimulatorApi {
  registerParticipant(input: {
    registrationKey: string;
    kind: 'synthetic';
    displayName: string;
    privateContext: string;
  }): Promise<ParticipantRegistration>;
  submitParticipantInput(input: {
    participantId: string;
    content: string;
    idempotencyKey: string;
  }): Promise<ParticipantInputReceipt>;
}

export type SimulationEvent = {
  scenarioKey: string;
  displayName: string;
  content: string;
  receipt: ParticipantInputReceipt;
};

type RegisteredScenario = {
  scenario: NetworkScenario;
  participant: ParticipantRegistration;
};

export async function registerScenarioNetwork(
  api: NetworkSimulatorApi,
  scenarios: readonly NetworkScenario[],
  seed: string,
): Promise<RegisteredScenario[]> {
  const namespace = digest(seed).slice(0, 16);
  return await Promise.all(scenarios.map(async (scenario) => ({
    scenario,
    participant: await api.registerParticipant({
      registrationKey: `lucid-sim:${namespace}:${scenario.key}`,
      kind: 'synthetic',
      displayName: scenario.displayName,
      privateContext: scenario.privateContext,
    }),
  })));
}

export async function runSimulationPass(
  api: NetworkSimulatorApi,
  scenarios: readonly NetworkScenario[],
  options: { seed: string; runId: string },
): Promise<SimulationEvent[]> {
  const registered = await registerScenarioNetwork(api, scenarios, options.seed);
  const random = seedrandom(`${options.seed}:${options.runId}`);

  return await Promise.all(registered.map(async ({ scenario, participant }) => {
    const inputIndex = Math.floor(random() * scenario.inputs.length);
    const content = scenario.inputs[inputIndex];
    if (!content) {
      throw new Error(`Scenario has no input at index ${inputIndex}: ${scenario.key}`);
    }
    const receipt = await api.submitParticipantInput({
      participantId: participant.participantId,
      content,
      idempotencyKey: inputKey(scenario.key, options),
    });
    return {
      scenarioKey: scenario.key,
      displayName: scenario.displayName,
      content,
      receipt,
    };
  }));
}

export async function runSimulationTick(
  api: NetworkSimulatorApi,
  scenarios: readonly NetworkScenario[],
  options: { seed: string; runId: string; tick: number },
): Promise<SimulationEvent> {
  const registered = await registerScenarioNetwork(api, scenarios, options.seed);
  const random = seedrandom(`${options.seed}:${options.runId}:${options.tick}`);
  const selected = registered[Math.floor(random() * registered.length)];
  if (!selected) {
    throw new Error('At least one network scenario is required.');
  }
  const content = selected.scenario.inputs[
    Math.floor(random() * selected.scenario.inputs.length)
  ];
  if (!content) {
    throw new Error(`Scenario has no inputs: ${selected.scenario.key}`);
  }
  const receipt = await api.submitParticipantInput({
    participantId: selected.participant.participantId,
    content,
    idempotencyKey: inputKey(selected.scenario.key, options),
  });
  return {
    scenarioKey: selected.scenario.key,
    displayName: selected.scenario.displayName,
    content,
    receipt,
  };
}

function inputKey(
  scenarioKey: string,
  options: { seed: string; runId: string; tick?: number },
): string {
  return `lucid-sim:${scenarioKey}:${digest([
    options.seed,
    options.runId,
    options.tick ?? 'pass',
  ].join(':')).slice(0, 32)}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

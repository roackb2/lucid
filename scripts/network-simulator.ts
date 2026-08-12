/**
 * CLI entrypoint for generating independent participant input outside Lucid's
 * product runtime. Run once from cron or continuously during local exploration.
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../apps/server/src/router.js';
import {
  runSimulationPass,
  runSimulationTick,
  type NetworkSimulatorApi,
  type SimulationEvent,
} from './network-simulator-core.js';
import { NETWORK_SCENARIOS } from './network-scenarios.js';

const { values } = parseArgs({
  options: {
    url: {
      type: 'string',
      default: 'http://127.0.0.1:8081/api/trpc',
    },
    seed: { type: 'string', default: 'lucid-local-world' },
    'run-id': { type: 'string', default: randomUUID() },
    mode: { type: 'string', default: 'once' },
    'interval-ms': { type: 'string', default: '60000' },
  },
  strict: true,
});

const mode = parseMode(values.mode);
const intervalMs = parseInterval(values['interval-ms']);
const client = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      transformer: superjson,
      url: values.url,
    }),
  ],
});
const api: NetworkSimulatorApi = {
  registerParticipant: (input) => (
    client.development.registerParticipant.mutate(input)
  ),
  submitParticipantInput: (input) => (
    client.development.submitParticipantInput.mutate(input)
  ),
};

try {
  if (mode === 'once') {
    const events = await runSimulationPass(api, NETWORK_SCENARIOS, {
      seed: values.seed,
      runId: values['run-id'],
    });
    events.forEach(printEvent);
  } else {
    await runContinuously(api, {
      seed: values.seed,
      runId: values['run-id'],
      intervalMs,
    });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Lucid network simulator failed: ${message}`);
  console.error(`Confirm the Lucid server is running at ${values.url}.`);
  process.exitCode = 1;
}

async function runContinuously(
  simulatorApi: NetworkSimulatorApi,
  options: { seed: string; runId: string; intervalMs: number },
): Promise<void> {
  let tick = 0;
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);

  while (!stopped) {
    printEvent(await runSimulationTick(
      simulatorApi,
      NETWORK_SCENARIOS,
      { seed: options.seed, runId: options.runId, tick },
    ));
    tick += 1;
    await waitUntilNextTick(options.intervalMs, () => stopped);
  }
}

function printEvent(event: SimulationEvent): void {
  console.log(
    `[network] ${event.displayName} -> event #${event.receipt.sequence}: ${event.content}`,
  );
}

function parseMode(value: string): 'once' | 'continuous' {
  if (value === 'once' || value === 'continuous') {
    return value;
  }
  throw new Error(`--mode must be "once" or "continuous", received: ${value}`);
}

function parseInterval(value: string): number {
  const intervalMs = Number(value);
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) {
    throw new Error('--interval-ms must be an integer of at least 1000.');
  }
  return intervalMs;
}

async function waitUntilNextTick(
  intervalMs: number,
  isStopped: () => boolean,
): Promise<void> {
  const checkIntervalMs = Math.min(intervalMs, 250);
  let elapsed = 0;
  while (!isStopped() && elapsed < intervalMs) {
    const duration = Math.min(checkIntervalMs, intervalMs - elapsed);
    await new Promise((resolve) => setTimeout(resolve, duration));
    elapsed += duration;
  }
}

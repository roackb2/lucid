/**
 * CLI for advancing one deterministic, multi-phase Lucid learning experiment.
 * The operator remains the participant: this script supplies network events
 * but never saves interest, submits feedback, or judges a finding.
 */
import { parseArgs } from 'node:util';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../apps/server/src/router.js';
import { LONGITUDINAL_NETWORK_PHASES } from './longitudinal-network-scenarios.js';
import {
  runLongitudinalPhase,
  type NetworkSimulatorApi,
} from './network-simulator-core.js';
import { NETWORK_SCENARIOS } from './network-scenarios.js';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:8081' },
    'experiment-id': { type: 'string', default: 'local-longitudinal' },
    phase: { type: 'string', default: 'setup' },
    list: { type: 'boolean', default: false },
  },
  strict: true,
});

if (values.list) {
  LONGITUDINAL_NETWORK_PHASES.forEach((phase) => {
    console.log(`${phase.key}: ${phase.title}`);
    console.log(`  ${phase.purpose}`);
    console.log(`  Next: ${phase.operatorInstruction}`);
  });
} else {
  try {
    const phaseIndex = LONGITUDINAL_NETWORK_PHASES.findIndex(
      ({ key }) => key === values.phase,
    );
    const phase = LONGITUDINAL_NETWORK_PHASES[phaseIndex];
    if (!phase) {
      throw new Error(
        `Unknown phase "${values.phase}". Use --list to inspect available phases.`,
      );
    }
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

    console.log(`[learning:${phase.key}] ${phase.title}`);
    console.log(phase.purpose);
    const events = await runLongitudinalPhase(
      api,
      NETWORK_SCENARIOS,
      phase,
      { experimentId: values['experiment-id'] },
    );
    events.forEach((event) => {
      console.log(
        `[network] ${event.displayName} -> event #${event.receipt.sequence}: ${event.content}`,
      );
    });

    const next = LONGITUDINAL_NETWORK_PHASES[phaseIndex + 1];
    console.log(phase.operatorInstruction);
    console.log(next
      ? `Next phase: yarn simulate:learning --experiment-id ${values['experiment-id']} --phase ${next.key}`
      : 'All scripted phases are complete. Continue using Run now only if you want to observe later silence or add free-form participant input.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Lucid longitudinal experiment failed: ${message}`);
    console.error(`Confirm the Lucid server is running at ${values.url}.`);
    process.exitCode = 1;
  }
}

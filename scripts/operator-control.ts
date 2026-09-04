/**
 * Loopback-only operator controls for the local Lucid experiment.
 * Product users never need to discover raw tRPC procedures or database state.
 */
import { parseArgs } from 'node:util';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { NetworkDiagnosticsSnapshot } from '../apps/server/src/lucid/discovery-types.js';
import type { AppRouter } from '../apps/server/src/router.js';

const COMMANDS = [
  'status',
  'pause-peers',
  'resume-peers',
  'pause-dispatch',
  'resume-dispatch',
] as const;

type OperatorCommand = typeof COMMANDS[number];

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Lucid operator command failed: ${message}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      url: {
        type: 'string',
        default: 'http://127.0.0.1:8081/api/trpc',
      },
      'expect-peers': { type: 'string' },
    },
    strict: true,
  });
  const command = parseCommand(positionals);
  const expectedCount = parseExpectedCount(values['expect-peers']);
  if (
    expectedCount !== undefined
    && command !== 'pause-peers'
    && command !== 'resume-peers'
  ) {
    throw new Error('--expect-peers is valid only for peer task commands.');
  }

  const client = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ transformer: superjson, url: values.url })],
  });
  const handlers: Record<OperatorCommand, () => Promise<void>> = {
    status: async () => {
      printDiagnostics(await client.development.diagnostics.query());
    },
    'pause-peers': async () => {
      const snapshot = await client.development
        .setSyntheticPeerAgentTasksEnabled
        .mutate({ enabled: false, expectedCount });
      printPeerResult('Paused', snapshot);
    },
    'resume-peers': async () => {
      const snapshot = await client.development
        .setSyntheticPeerAgentTasksEnabled
        .mutate({ enabled: true, expectedCount });
      printPeerResult('Resumed', snapshot);
    },
    'pause-dispatch': async () => {
      await client.operator.setGlobalBackgroundChecksEnabled.mutate({
        enabled: false,
      });
      printDiagnostics(await client.development.diagnostics.query());
    },
    'resume-dispatch': async () => {
      await client.operator.setGlobalBackgroundChecksEnabled.mutate({
        enabled: true,
      });
      printDiagnostics(await client.development.diagnostics.query());
    },
  };

  await handlers[command]();
}

function parseCommand(positionals: string[]): OperatorCommand {
  const [command, ...unexpected] = positionals;
  if (
    !command
    || unexpected.length
    || !COMMANDS.includes(command as OperatorCommand)
  ) {
    throw new Error(`Expected one command: ${COMMANDS.join(', ')}.`);
  }
  return command as OperatorCommand;
}

function parseExpectedCount(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('--expect-peers must be a non-negative integer.');
  }
  return count;
}

function printPeerResult(
  action: 'Paused' | 'Resumed',
  snapshot: NetworkDiagnosticsSnapshot,
): void {
  const peerCount = snapshot.agents.filter(({ user }) => (
    user.kind === 'synthetic' && user.status === 'active'
  )).length;
  console.log(`${action} ${peerCount} synthetic peer Agent tasks.`);
  printDiagnostics(snapshot);
}

function printDiagnostics(snapshot: NetworkDiagnosticsSnapshot): void {
  const tasksByAgentId = snapshot.backgroundChecks.tasks.reduce((index, task) => {
    index.set(task.agentId, [...(index.get(task.agentId) ?? []), task]);
    return index;
  }, new Map<string, NetworkDiagnosticsSnapshot['backgroundChecks']['tasks']>());
  console.log(
    `Global dispatch: ${snapshot.backgroundChecks.dispatchEnabled ? 'enabled' : 'paused'}`,
  );
  snapshot.agents
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .forEach((agent) => {
      const tasks = tasksByAgentId.get(agent.id) ?? [];
      if (!tasks.length) {
        console.log(
          `- ${agent.user.displayName} / ${agent.name} (${agent.user.kind}): missing task`,
        );
        return;
      }
      tasks.forEach((task) => {
        const taskState = `${task.enabled ? 'enabled' : 'paused'}, ${task.status}`;
        console.log(
          `- ${agent.user.displayName} / ${agent.name} (${agent.user.kind}) / ${task.name} [${task.kind}]: ${taskState}`,
        );
      });
    });
}

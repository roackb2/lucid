/**
 * Flexible development ingress for one independently described participant.
 * This is intentionally outside product code: it lets developers play a real
 * or synthetic participant without adding a built-in Lucid character.
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../apps/server/src/router.js';

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Lucid participant input failed: ${message}`);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: 'string', default: 'http://127.0.0.1:8081' },
      kind: { type: 'string', default: 'synthetic' },
      'registration-key': { type: 'string' },
      'display-name': { type: 'string' },
      'private-context': { type: 'string' },
      input: { type: 'string' },
      'input-key': { type: 'string' },
      'context-approved': { type: 'boolean', default: false },
    },
    strict: true,
  });
  const registrationKey = requireText(
    values['registration-key'],
    '--registration-key',
  );
  const displayName = requireText(values['display-name'], '--display-name');
  const privateContext = requireText(
    values['private-context'],
    '--private-context',
  );
  const input = requireText(values.input, '--input');
  const kind = parseParticipantKind(values.kind);
  if (kind === 'human' && !values['context-approved']) {
    throw new Error(
      'Human participant context requires the explicit --context-approved flag.',
    );
  }

  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({ transformer: superjson, url: values.url }),
    ],
  });
  const participant = await client.development.registerParticipant.mutate(
    kind === 'human'
      ? {
          registrationKey,
          kind,
          displayName,
          privateContext,
          contextApproved: true,
        }
      : { registrationKey, kind, displayName, privateContext },
  );
  const receipt = await client.development.submitParticipantInput.mutate({
    participantId: participant.participantId,
    content: input,
    idempotencyKey: values['input-key']
      ?? `lucid-participant-input:${registrationKey}:${randomUUID()}`,
  });
  console.log(
    `${participant.displayName} (${participant.participantId}) submitted event #${receipt.sequence}.`,
  );
}

function requireText(
  value: string | undefined,
  option: string,
): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${option} is required.`);
  }
  return normalized;
}

function parseParticipantKind(value: string): 'human' | 'synthetic' {
  if (value === 'human' || value === 'synthetic') {
    return value;
  }
  throw new Error(`--kind must be "human" or "synthetic", received: ${value}`);
}

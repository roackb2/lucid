import { randomUUID } from 'node:crypto';
import {
  AGENTCORE_RUNTIME_SESSION_HEADER,
  LOCAL_RUNTIME_TOKEN_HEADER,
  MODEL_API_KEY_HEADER,
} from './types.js';

async function main(): Promise<void> {
  const prompt = await readPrompt(process.argv.slice(2));
  const localToken = requireEnvironment('LUCID_AGENT_RUNTIME_LOCAL_TOKEN');
  const modelApiKey = process.env.OPENAI_API_KEY ?? process.env.PERSONAL_OPENAI_API_KEY;
  if (!modelApiKey?.trim()) {
    throw new Error('Set OPENAI_API_KEY in the client shell. It is sent as a request header, never as runtime env.');
  }
  delete process.env.OPENAI_API_KEY;
  delete process.env.PERSONAL_OPENAI_API_KEY;

  const baseUrl = process.env.LUCID_AGENT_RUNTIME_URL ?? 'http://127.0.0.1:18080';
  const response = await fetch(new URL('/invocations', baseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [AGENTCORE_RUNTIME_SESSION_HEADER]:
        process.env.LUCID_AGENT_RUNTIME_SESSION_ID
        ?? 'local-runtime-session-000000000001',
      [LOCAL_RUNTIME_TOKEN_HEADER]: localToken,
      [MODEL_API_KEY_HEADER]: modelApiKey,
    },
    body: JSON.stringify({
      schemaVersion: 1,
      kind: 'conversation-turn',
      invocationId: `local-${randomUUID()}`,
      scope: {
        adopterId: process.env.LUCID_AGENT_RUNTIME_ADOPTER_ID ?? 'local-adopter',
        tenantId: process.env.LUCID_AGENT_RUNTIME_TENANT_ID ?? 'local-tenant',
        userId: process.env.LUCID_AGENT_RUNTIME_USER_ID ?? 'local-user',
        conversationId:
          process.env.LUCID_AGENT_RUNTIME_CONVERSATION_ID ?? 'local-conversation',
      },
      prompt,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Runtime returned HTTP ${response.status}: ${await response.text()}`);
  }

  const reader = response.body.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    process.stdout.write(Buffer.from(next.value));
  }
}

async function readPrompt(arguments_: string[]): Promise<string> {
  const prompt = arguments_.join(' ').trim() || (await readStdin()).trim();
  if (!prompt) {
    throw new Error('Pass a prompt as arguments or pipe one through stdin.');
  }
  return prompt;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Set ${name} in the client shell.`);
  }
  return value;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown invocation failure';
  process.stderr.write(`Local runtime invocation failed: ${message}\n`);
  process.exitCode = 1;
});

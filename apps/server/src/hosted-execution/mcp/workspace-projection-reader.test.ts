import { describe, expect, it, vi } from 'vitest';
import type { McpInvocationScope } from '@roackb2/heddle-adopter/mcp';
import {
  ParticipantWorkspaceProjectionReader,
  WorkspaceProjectionScopeError,
} from './workspace-projection-reader.js';
import { workspaceSnapshot } from './test-support.js';

const SCOPE: McpInvocationScope = {
  adopterId: 'lucid-adopter',
  tenantId: 'tenant-a',
  subjectId: 'subject-a',
  productSessionId: 'product-session-a',
  runtimeSessionId: `runtime-session:${'a'.repeat(40)}`,
  invocationId: 'invocation-001',
  workflow: 'conversation-turn',
};

describe('participant workspace MCP projection reader', () => {
  it('reads the verified participant when deployment scope matches', async () => {
    const snapshot = workspaceSnapshot();
    const source = { snapshot: vi.fn(async () => snapshot) };
    const reader = new ParticipantWorkspaceProjectionReader({
      tenantId: SCOPE.tenantId,
      productSessionId: SCOPE.productSessionId,
    }, source);

    await expect(reader.readWorkspaceProjection({
      scope: SCOPE,
      signal: new AbortController().signal,
    })).resolves.toBe(snapshot);
    expect(source.snapshot).toHaveBeenCalledWith(SCOPE.subjectId);
  });

  it.each([
    ['tenantId', 'tenant-b'],
    ['productSessionId', 'product-session-b'],
  ] as const)('denies a mismatched %s before reading product data', async (field, value) => {
    const source = { snapshot: vi.fn(async () => workspaceSnapshot()) };
    const reader = new ParticipantWorkspaceProjectionReader({
      tenantId: SCOPE.tenantId,
      productSessionId: SCOPE.productSessionId,
    }, source);

    await expect(reader.readWorkspaceProjection({
      scope: { ...SCOPE, [field]: value },
      signal: new AbortController().signal,
    })).rejects.toBeInstanceOf(WorkspaceProjectionScopeError);
    expect(source.snapshot).not.toHaveBeenCalled();
  });

  it('checks cancellation before and after the underlying projection read', async () => {
    const controller = new AbortController();
    const source = {
      snapshot: vi.fn(async (_participantId: string) => {
        controller.abort(new Error('cancelled during read'));
        return workspaceSnapshot();
      }),
    };
    const reader = new ParticipantWorkspaceProjectionReader({
      tenantId: SCOPE.tenantId,
      productSessionId: SCOPE.productSessionId,
    }, source);

    await expect(reader.readWorkspaceProjection({
      scope: SCOPE,
      signal: controller.signal,
    })).rejects.toThrow('cancelled during read');
  });
});

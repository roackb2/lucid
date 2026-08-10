import { describe, expect, it, vi } from 'vitest';
import {
  SingleWorkspaceProjectionReader,
  WorkspaceProjectionScopeError,
} from './workspace-projection-reader.js';
import { workspaceSnapshot } from './test-support.js';
import type { LucidMcpInvocationScope } from './types.js';

const SCOPE: LucidMcpInvocationScope = {
  adopterId: 'lucid-adopter',
  tenantId: 'tenant-a',
  subjectId: 'subject-a',
  productSessionId: 'product-session-a',
  runtimeSessionId: `runtime-session:${'a'.repeat(40)}`,
  invocationId: 'invocation-001',
  workflow: 'conversation-turn',
};

describe('single workspace MCP projection reader', () => {
  it('reads only when verified product scope matches the configured workspace', async () => {
    const snapshot = workspaceSnapshot();
    const source = { snapshot: vi.fn(async () => snapshot) };
    const reader = new SingleWorkspaceProjectionReader({
      tenantId: SCOPE.tenantId,
      subjectId: SCOPE.subjectId,
      productSessionId: SCOPE.productSessionId,
    }, source);

    await expect(reader.readWorkspaceProjection({
      scope: SCOPE,
      signal: new AbortController().signal,
    })).resolves.toBe(snapshot);
    expect(source.snapshot).toHaveBeenCalledOnce();
  });

  it.each([
    ['tenantId', 'tenant-b'],
    ['subjectId', 'subject-b'],
    ['productSessionId', 'product-session-b'],
  ] as const)('denies a mismatched %s before reading product data', async (field, value) => {
    const source = { snapshot: vi.fn(async () => workspaceSnapshot()) };
    const reader = new SingleWorkspaceProjectionReader({
      tenantId: SCOPE.tenantId,
      subjectId: SCOPE.subjectId,
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
      snapshot: vi.fn(async () => {
        controller.abort(new Error('cancelled during read'));
        return workspaceSnapshot();
      }),
    };
    const reader = new SingleWorkspaceProjectionReader({
      tenantId: SCOPE.tenantId,
      subjectId: SCOPE.subjectId,
      productSessionId: SCOPE.productSessionId,
    }, source);

    await expect(reader.readWorkspaceProjection({
      scope: SCOPE,
      signal: controller.signal,
    })).rejects.toThrow('cancelled during read');
  });
});

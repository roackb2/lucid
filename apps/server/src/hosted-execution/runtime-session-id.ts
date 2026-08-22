import { createHash } from 'node:crypto';

export type HostedExecutionScope = {
  tenantId: string;
  subjectId: string;
  productSessionId: string;
};

/** Stable provider-compatible session identity derived only from product scope. */
export function createHostedRuntimeSessionId(
  scope: HostedExecutionScope,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify([
      scope.tenantId,
      scope.subjectId,
      scope.productSessionId,
    ]))
    .digest('hex');
  return `lucid-runtime-session-${digest}`;
}

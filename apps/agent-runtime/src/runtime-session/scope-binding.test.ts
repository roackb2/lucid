import { describe, expect, it } from 'vitest';
import {
  RuntimeScopeBindingService,
  RuntimeScopeMismatchError,
} from './scope-binding.js';

describe('runtime scope binding', () => {
  it('returns one stable opaque execution session for repeated scope use', () => {
    const service = new RuntimeScopeBindingService();
    const first = service.bind(binding());
    const second = service.bind(binding());
    expect(second).toEqual(first);
    expect(first.executionSessionId).toMatch(/^runtime-[a-f0-9]{64}$/);
    expect(first.executionSessionId).not.toContain('company-a');
  });

  it.each(['runtimeSessionId', 'adopterId', 'tenantId', 'userId', 'conversationId'] as const)(
    'rejects a changed %s',
    (field) => {
      const service = new RuntimeScopeBindingService();
      service.bind(binding());
      expect(() => service.bind({ ...binding(), [field]: `different-${field}` }))
        .toThrow(RuntimeScopeMismatchError);
    },
  );
});

function binding() {
  return {
    runtimeSessionId: 's'.repeat(33),
    adopterId: 'heddle-customer',
    tenantId: 'company-a',
    userId: 'user-a',
    conversationId: 'conversation-a',
  };
}

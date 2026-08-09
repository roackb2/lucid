import { describe, expect, it } from 'vitest';
import { RuntimeSessionStatusService } from './status.js';

describe('runtime session status', () => {
  it('changes its timestamp only on status transitions', () => {
    let now = new Date('2026-08-09T00:00:00.000Z');
    const status = new RuntimeSessionStatusService(() => now);
    const initial = status.read();
    now = new Date('2026-08-09T00:00:10.000Z');
    expect(status.read()).toEqual(initial);

    status.markExecuting();
    const executing = status.read();
    expect(executing.state).toBe('executing');
    expect(executing.changedAtUnixSeconds).toBeGreaterThan(initial.changedAtUnixSeconds);

    now = new Date('2026-08-09T00:00:20.000Z');
    status.markExecuting();
    expect(status.read()).toEqual(executing);
    status.markIdle();
    expect(status.read()).toMatchObject({ state: 'idle' });
  });
});

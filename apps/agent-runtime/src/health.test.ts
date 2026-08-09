import { describe, expect, it } from 'vitest';
import { RuntimeHealthService } from './health.js';

describe('runtime health', () => {
  it('changes its timestamp only on status transitions', () => {
    let now = new Date('2026-08-09T00:00:00.000Z');
    const health = new RuntimeHealthService(() => now);
    const initial = health.read();
    now = new Date('2026-08-09T00:00:10.000Z');
    expect(health.read()).toEqual(initial);

    health.markBusy();
    const busy = health.read();
    expect(busy.status).toBe('HealthyBusy');
    expect(busy.time_of_last_update).toBeGreaterThan(initial.time_of_last_update);

    now = new Date('2026-08-09T00:00:20.000Z');
    health.markBusy();
    expect(health.read()).toEqual(busy);
    health.markHealthy();
    expect(health.read()).toMatchObject({ status: 'Healthy' });
  });
});

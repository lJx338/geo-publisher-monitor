import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReportStore } from './report-store.js';
import { MonitorScheduler } from './scheduler.js';

describe('MonitorScheduler', () => {
  it('calculates the next configured patrol without accumulating missed runs', async () => {
    const store = new ReportStore(await mkdtemp(join(tmpdir(), 'geo-schedule-')));
    const scheduler = new MonitorScheduler(store, () => [1, 7, 13, 19], () => false, {
      patrol: async () => { throw new Error('not called'); }, generate: async () => undefined,
      preflight: async () => { throw new Error('not called'); }, publish: async () => { throw new Error('not called'); },
    }, () => undefined);
    const next = scheduler.nextPatrolAt(new Date(2026, 7, 5, 8, 0, 0));
    expect(new Date(next!).getHours()).toBe(13);
    const overnight = scheduler.nextPatrolAt(new Date(2026, 7, 5, 20, 0, 0));
    expect(new Date(overnight!).getHours()).toBe(1);
  });
});

import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MonitorRun } from '../shared.js';
import { ReportStore } from './report-store.js';

describe('ReportStore', () => {
  it('stores reports, screenshots, fingerprints and publish idempotency', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'geo-monitor-'));
    const screenshot = join(directory, 'source.png');
    await writeFile(screenshot, Buffer.from('png'));
    const store = new ReportStore(directory);
    const now = new Date().toISOString();
    const run: MonitorRun = { id: 'run-1', kind: 'patrol', startedAt: now, finishedAt: now, status: 'success', results: [{ platform: 'baijia', status: 'success', stage: 'fill', message: 'ok', startedAt: now, finishedAt: now, durationMs: 1, screenshotPath: screenshot }] };
    await store.saveRun(run);
    expect((await store.latestRun())?.id).toBe('run-1');
    expect(await readFile(run.results[0]!.screenshotPath!)).toEqual(Buffer.from('png'));
    await store.setFingerprint('baijia', 'hash');
    expect((await store.fingerprints()).platforms.baijia).toBe('hash');
    await store.recordPublish('week|baijia|hash', 'uncertain');
    expect((await store.publishLedger())['week|baijia|hash']?.status).toBe('uncertain');
  });

  it('migrates legacy fingerprints without mixing fingerprint algorithms', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'geo-monitor-'));
    await writeFile(join(directory, 'fingerprints.json'), JSON.stringify({ baijia: 'legacy', zhihu: 'legacy' }));
    const store = new ReportStore(directory);
    expect(await store.fingerprints()).toMatchObject({ schemaVersion: 0, platforms: { baijia: 'legacy' } });
    await store.setFingerprint('baijia', 'current');
    expect(await store.fingerprints()).toEqual({ schemaVersion: 1, platforms: { baijia: 'current' } });
  });
});

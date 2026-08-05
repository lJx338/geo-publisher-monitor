import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { MonitorRun, Platform, WeeklyArticle } from '../shared.js';
import { FINGERPRINT_SCHEMA_VERSION } from './diagnostics.js';

interface SchedulerState {
  completedKeys: string[];
  lastPatrolAt: string | null;
}

export interface FingerprintState {
  schemaVersion: number;
  platforms: Partial<Record<Platform, string>>;
}

export class ReportStore {
  readonly reportsDirectory: string;
  private readonly fingerprintsPath: string;
  private readonly schedulerPath: string;
  private readonly weeklyPath: string;
  private readonly topicHistoryPath: string;
  private readonly publishLedgerPath: string;

  constructor(private readonly dataDirectory: string) {
    this.reportsDirectory = join(dataDirectory, 'reports');
    this.fingerprintsPath = join(dataDirectory, 'fingerprints.json');
    this.schedulerPath = join(dataDirectory, 'scheduler-state.json');
    this.weeklyPath = join(dataDirectory, 'weekly-bundle.json');
    this.topicHistoryPath = join(dataDirectory, 'topic-history.json');
    this.publishLedgerPath = join(dataDirectory, 'publish-ledger.json');
  }

  async saveRun(run: MonitorRun): Promise<MonitorRun> {
    const day = run.startedAt.slice(0, 10);
    const directory = join(this.reportsDirectory, day, run.id);
    await mkdir(join(directory, 'screenshots'), { recursive: true });
    for (const result of run.results) {
      if (!result.screenshotPath) continue;
      try {
        const target = join(directory, 'screenshots', `${result.platform}-${basename(result.screenshotPath)}`);
        await copyFile(result.screenshotPath, target);
        result.screenshotPath = target;
      } catch {
        // The source evidence may have been removed by a concurrent cleanup.
      }
    }
    await this.atomicWrite(join(directory, 'result.json'), JSON.stringify(run, null, 2));
    await this.atomicWrite(join(directory, 'events.jsonl'), `${run.results.map((item) => JSON.stringify(item)).join('\n')}\n`);
    return run;
  }

  async latestRun(): Promise<MonitorRun | null> {
    try {
      const days = (await readdir(this.reportsDirectory)).sort().reverse();
      for (const day of days) {
        const runs = (await readdir(join(this.reportsDirectory, day))).sort().reverse();
        for (const run of runs) {
          try {
            return JSON.parse(await readFile(join(this.reportsDirectory, day, run, 'result.json'), 'utf8')) as MonitorRun;
          } catch { /* continue */ }
        }
      }
    } catch { /* no reports */ }
    return null;
  }

  async fingerprints(): Promise<FingerprintState> {
    const value = await this.readJson<unknown>(this.fingerprintsPath, {});
    if (value && typeof value === 'object' && 'schemaVersion' in value && 'platforms' in value) {
      const state = value as FingerprintState;
      return { schemaVersion: Number(state.schemaVersion) || 0, platforms: state.platforms || {} };
    }
    return { schemaVersion: 0, platforms: value as Partial<Record<Platform, string>> };
  }

  async setFingerprint(platform: Platform, hash: string): Promise<void> {
    const current = await this.fingerprints();
    const platforms = current.schemaVersion === FINGERPRINT_SCHEMA_VERSION ? current.platforms : {};
    platforms[platform] = hash;
    await this.atomicWrite(this.fingerprintsPath, JSON.stringify({ schemaVersion: FINGERPRINT_SCHEMA_VERSION, platforms }, null, 2));
  }

  async schedulerState(): Promise<SchedulerState> {
    return await this.readJson(this.schedulerPath, { completedKeys: [], lastPatrolAt: null });
  }

  async saveSchedulerState(value: SchedulerState): Promise<void> {
    await this.atomicWrite(this.schedulerPath, JSON.stringify({ ...value, completedKeys: value.completedKeys.slice(-500) }, null, 2));
  }

  async saveWeekly(articles: WeeklyArticle[], state: 'generated' | 'preflighted'): Promise<void> {
    await this.atomicWrite(this.weeklyPath, JSON.stringify({ state, createdAt: new Date().toISOString(), articles }, null, 2));
  }

  async weekly(): Promise<{ state: 'generated' | 'preflighted'; createdAt: string; articles: WeeklyArticle[] } | null> {
    return await this.readJson(this.weeklyPath, null);
  }

  async topicHistory(): Promise<Array<{ title: string; hash: string; createdAt: string }>> {
    return await this.readJson(this.topicHistoryPath, []);
  }

  async addTopics(articles: WeeklyArticle[]): Promise<void> {
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const history = (await this.topicHistory()).filter((item) => Date.parse(item.createdAt) >= cutoff);
    history.push(...articles.map((item) => ({ title: item.title, hash: item.contentHash, createdAt: new Date().toISOString() })));
    await this.atomicWrite(this.topicHistoryPath, JSON.stringify(history, null, 2));
  }

  async publishLedger(): Promise<Record<string, { status: string; updatedAt: string; details?: unknown }>> {
    return await this.readJson(this.publishLedgerPath, {});
  }

  async recordPublish(key: string, status: string, details?: unknown): Promise<void> {
    const ledger = await this.publishLedger();
    ledger[key] = { status, updatedAt: new Date().toISOString(), details };
    await this.atomicWrite(this.publishLedgerPath, JSON.stringify(ledger, null, 2));
  }

  async hasThreeStableDays(): Promise<boolean> {
    const successfulDays = new Set<string>();
    try {
      for (const day of (await readdir(this.reportsDirectory)).sort().reverse()) {
        for (const runId of await readdir(join(this.reportsDirectory, day))) {
          try {
            const run = JSON.parse(await readFile(join(this.reportsDirectory, day, runId, 'result.json'), 'utf8')) as MonitorRun;
            if (run.kind === 'patrol' && run.results.length === 6 && run.results.every((item) => item.status === 'success' || item.status === 'warning')) {
              successfulDays.add(day);
            }
          } catch { /* ignore incomplete report */ }
        }
        if (successfulDays.size >= 3) return true;
      }
    } catch { /* no reports */ }
    return false;
  }

  async prune(days = 90): Promise<void> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    try {
      for (const day of await readdir(this.reportsDirectory)) {
        const path = join(this.reportsDirectory, day);
        if ((await stat(path)).mtimeMs < cutoff) await rm(path, { recursive: true, force: true });
      }
    } catch { /* no reports */ }
  }

  private async readJson<T>(path: string, fallback: T): Promise<T> {
    try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return fallback; }
  }

  private async atomicWrite(path: string, value: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.new`;
    await writeFile(temporary, value, { mode: 0o600 });
    await rename(temporary, path);
  }
}

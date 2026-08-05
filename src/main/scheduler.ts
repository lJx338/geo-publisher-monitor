import type { MonitorRun } from '../shared.js';
import { ReportStore } from './report-store.js';

interface SchedulerHooks {
  patrol: () => Promise<MonitorRun>;
  generate: () => Promise<unknown>;
  preflight: () => Promise<MonitorRun>;
  publish: () => Promise<MonitorRun>;
}

function localKey(date: Date, suffix: string): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}:${suffix}`;
}

export class MonitorScheduler {
  private timer: NodeJS.Timeout | null = null;
  private completed = new Set<string>();
  private lastPatrolAt: string | null = null;

  constructor(
    private readonly store: ReportStore,
    private readonly scheduleHours: () => number[],
    private readonly autoPublishEnabled: () => boolean,
    private readonly hooks: SchedulerHooks,
    private readonly onChange: () => void,
  ) {}

  async start(): Promise<void> {
    const state = await this.store.schedulerState();
    this.completed = new Set(state.completedKeys);
    this.lastPatrolAt = state.lastPatrolAt;
    await this.tick();
    this.timer = setInterval(() => { void this.tick(); }, 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async resume(): Promise<void> {
    const elapsed = this.lastPatrolAt ? Date.now() - Date.parse(this.lastPatrolAt) : Number.POSITIVE_INFINITY;
    if (elapsed >= 6 * 60 * 60 * 1000) await this.runPatrol(`resume-${localKey(new Date(), 'patrol')}`);
    await this.tick();
  }

  nextPatrolAt(now = new Date()): string | null {
    const hours = this.scheduleHours().slice().sort((a, b) => a - b);
    if (!hours.length) return null;
    for (let offset = 0; offset <= 1; offset += 1) {
      for (const hour of hours) {
        const candidate = new Date(now);
        candidate.setDate(now.getDate() + offset);
        candidate.setHours(hour, 0, 0, 0);
        if (candidate.getTime() > now.getTime()) return candidate.toISOString();
      }
    }
    return null;
  }

  private async tick(now = new Date()): Promise<void> {
    const hour = now.getHours();
    const minute = now.getMinutes();
    if (this.scheduleHours().includes(hour) && minute < 5) await this.runPatrol(localKey(now, `patrol-${hour}`));
    if (now.getDay() === 3 && hour === 9 && minute >= 30 && minute < 35) await this.once(localKey(now, 'weekly-generate'), this.hooks.generate);
    if (now.getDay() === 3 && hour === 10 && minute < 5) await this.runScheduled(localKey(now, 'weekly-preflight'), this.hooks.preflight);
    if (this.autoPublishEnabled() && now.getDay() === 3 && hour === 10 && minute >= 30 && minute < 35) {
      await this.runScheduled(localKey(now, 'weekly-publish'), this.hooks.publish);
    }
    this.onChange();
  }

  private async runPatrol(key: string): Promise<void> {
    if (this.completed.has(key)) return;
    const run = await this.hooks.patrol().catch(() => null);
    const busy = run?.results.some((item) => item.code === 'PUBLISHER_BUSY');
    if (busy) {
      this.retryBusy(key, 1);
      return;
    }
    if (run) this.lastPatrolAt = run.finishedAt;
    await this.complete(key);
  }

  private retryBusy(key: string, attempt: number): void {
    if (attempt > 8) { void this.complete(key); return; }
    const timer = setTimeout(async () => {
      const run = await this.hooks.patrol().catch(() => null);
      if (run?.results.some((item) => item.code === 'PUBLISHER_BUSY')) this.retryBusy(key, attempt + 1);
      else {
        if (run) this.lastPatrolAt = run.finishedAt;
        await this.complete(key);
      }
    }, 15 * 60 * 1000);
    timer.unref();
  }

  private async runScheduled(key: string, operation: () => Promise<MonitorRun>, attempt = 0): Promise<void> {
    if (this.completed.has(key)) return;
    const run = await operation().catch(() => null);
    if (run?.results.some((item) => item.code === 'PUBLISHER_BUSY') && attempt < 8) {
      const timer = setTimeout(() => { void this.runScheduled(key, operation, attempt + 1); }, 15 * 60 * 1000);
      timer.unref();
      return;
    }
    await this.complete(key);
  }

  private async once(key: string, operation: () => Promise<unknown>): Promise<void> {
    if (this.completed.has(key)) return;
    try { await operation(); } finally { await this.complete(key); }
  }

  private async complete(key: string): Promise<void> {
    this.completed.add(key);
    await this.store.saveSchedulerState({ completedKeys: [...this.completed], lastPatrolAt: this.lastPatrolAt });
    this.onChange();
  }
}

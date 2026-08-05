import { createHash, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DashboardState, MonitorRun, Platform, PlatformRunResult, WeeklyArticle } from '../shared.js';
import { PLATFORMS, PLATFORM_NAMES } from '../shared.js';
import { generateWeeklyArticles } from './article-generator.js';
import { generateCover } from './cover-generator.js';
import { classifyFailure, fillWarnings, findScreenshot, FINGERPRINT_SCHEMA_VERSION, hasPatrolCoverMarker, pageFingerprint } from './diagnostics.js';
import { FeishuNotifier } from './feishu.js';
import { PublisherCli, PublisherCliError } from './publisher-cli.js';
import { ReportStore } from './report-store.js';
import { SettingsStore } from './config.js';

const PATROL_TITLE = '人工智能应用正在进入精细化落地阶段';
const PATROL_HTML = `<h2>从能力展示走向业务协同</h2><p>人工智能工具正在从单点能力展示转向更具体的业务协同。企业关注的重点不再只是模型参数，而是工具能否进入真实流程、能否与现有数据和岗位配合，以及结果是否便于检查和调整。</p><h2>落地时更值得关注的三个方面</h2><p>第一是任务边界。适合交给人工智能的工作通常具有明确输入、稳定步骤和可检查输出。第二是数据质量，来源不清或更新不及时的数据会直接影响结果。第三是人工复核，重要决策仍应保留清晰的责任人和复核节点。</p><h2>小范围验证比一次性改造更稳妥</h2><p>更可行的方法是先选择一个频率高、规则相对稳定的场景，记录原来的时间成本和错误类型，再用两到四周完成小范围验证。只有当效率、质量和协作方式都得到改善后，再逐步扩大使用范围。这样的推进方式更容易发现问题，也便于团队形成可复用的方法。</p>`;

function nowIso(): string { return new Date().toISOString(); }

function isoWeek(date = new Date()): string {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export class MonitorService {
  private running = false;
  private currentTask: string | null = null;
  private latestRun: MonitorRun | null = null;
  private platformResults: DashboardState['platformResults'] = {};
  private publisher: DashboardState['publisher'] = { connected: false, version: null, busy: false, message: '尚未连接' };

  constructor(
    private readonly dataDirectory: string,
    private readonly version: string,
    private readonly settings: SettingsStore,
    private readonly store: ReportStore,
    private readonly cli: PublisherCli,
    private readonly notifier: FeishuNotifier,
    private readonly onChange: () => void,
    private readonly retryDelayMs = 15 * 60 * 1000,
  ) {}

  async initialize(): Promise<void> {
    this.latestRun = await this.store.latestRun();
    if (this.latestRun) for (const result of this.latestRun.results) this.platformResults[result.platform] = result;
    await this.refreshPublisher();
    await this.store.prune();
  }

  state(nextPatrolAt: string | null, update: DashboardState['update']): DashboardState {
    return {
      version: this.version,
      running: this.running,
      currentTask: this.currentTask,
      nextPatrolAt,
      publisher: this.publisher,
      settings: this.settings.publicValue(),
      latestRun: this.latestRun,
      platformResults: { ...this.platformResults },
      update,
    };
  }

  isRunning(): boolean { return this.running; }

  async refreshPublisher(): Promise<void> {
    try {
      const health = await this.cli.health();
      this.publisher = { connected: true, version: health.version, busy: health.busy, message: health.busy ? '桌面端正在执行任务' : '桌面端已连接' };
    } catch (error) {
      this.publisher = { connected: false, version: null, busy: false, message: error instanceof Error ? error.message : String(error) };
    }
    this.onChange();
  }

  async runPatrol(kind: MonitorRun['kind'] = 'patrol', only?: Platform[]): Promise<MonitorRun> {
    return await this.runLocked(kind, async () => {
      const health = await this.cli.health();
      this.publisher = { connected: true, version: health.version, busy: health.busy, message: health.busy ? '桌面端正在执行任务' : '桌面端已连接' };
      if (health.busy) return await this.saveSkipped(kind, 'PUBLISHER_BUSY', 'GEO Publisher 正在执行其他任务');
      const articles = await this.patrolArticles(only || PLATFORMS);
      return await this.executeArticles(kind, articles, false, true);
    });
  }

  async generateWeekly(): Promise<WeeklyArticle[]> {
    return await this.runLocked('weekly-generate', async () => {
      const publicSettings = this.settings.publicValue();
      const credentials = this.settings.credentials();
      const history = await this.store.topicHistory();
      const directory = join(this.dataDirectory, 'weekly', isoWeek());
      const articles = await generateWeeklyArticles({
        baseUrl: publicSettings.llmBaseUrl,
        apiKey: credentials.llmApiKey,
        model: publicSettings.llmModel,
        previousTitles: history.map((item) => item.title),
        outputDirectory: directory,
      });
      await this.store.saveWeekly(articles, 'generated');
      await this.store.addTopics(articles);
      await this.notifySafely('周更文章已生成', articles.map((item) => `${PLATFORM_NAMES[item.platform]}：${item.title}`));
      return articles;
    });
  }

  async preflightWeekly(): Promise<MonitorRun> {
    return await this.runLocked('weekly-preflight', async () => {
      const health = await this.cli.health();
      if (health.busy) return await this.saveSkipped('weekly-preflight', 'PUBLISHER_BUSY', 'GEO Publisher 正在执行其他任务');
      const weekly = await this.store.weekly();
      if (!weekly) throw new Error('本周文章尚未生成');
      if (isoWeek(new Date(weekly.createdAt)) !== isoWeek()) throw new Error('已保存的文章不是本周生成，请先重新生成本周文章');
      const run = await this.executeArticles('weekly-preflight', weekly.articles, false, false);
      if (run.results.every((item) => item.status === 'success' || item.status === 'warning')) {
        await this.store.saveWeekly(weekly.articles, 'preflighted');
      }
      return run;
    });
  }

  async publishWeekly(): Promise<MonitorRun> {
    return await this.runLocked('weekly-publish', async () => {
      const current = new Date();
      const minutes = current.getHours() * 60 + current.getMinutes();
      if (current.getDay() !== 3 || minutes < 10 * 60 + 30 || minutes > 12 * 60 + 30) throw new Error('每周实发只允许在周三 10:30-12:30 执行');
      if (!this.settings.publicValue().autoPublishEnabled) throw new Error('每周自动实发尚未启用');
      if (!(await this.store.hasThreeStableDays())) throw new Error('尚未满足连续3天巡检通过的实发条件');
      const health = await this.cli.health();
      if (health.busy) return await this.saveSkipped('weekly-publish', 'PUBLISHER_BUSY', 'GEO Publisher 正在执行其他任务');
      const weekly = await this.store.weekly();
      if (!weekly || weekly.state !== 'preflighted') throw new Error('本周六平台预检尚未全部通过');
      if (isoWeek(new Date(weekly.createdAt)) !== isoWeek()) throw new Error('已预检的文章不是本周生成，请重新生成并预检');
      return await this.executeArticles('weekly-publish', weekly.articles, true, false);
    });
  }

  private async executeArticles(kind: MonitorRun['kind'], articles: WeeklyArticle[], publish: boolean, allowRetry: boolean): Promise<MonitorRun> {
    const startedAt = nowIso();
    const firstResults: PlatformRunResult[] = [];
    const retryArticles: WeeklyArticle[] = [];
    for (const article of articles) {
      const result = await this.executePlatform(article, publish, kind === 'patrol' || kind === 'manual');
      firstResults.push(result);
      if (allowRetry && result.code && ['NETWORK_SLOW', 'ADAPTER_ERROR', 'PLATFORM_SCHEMA_CHANGED'].includes(result.code)) retryArticles.push(article);
    }
    if (retryArticles.length) {
      await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
      for (const article of retryArticles) {
        const retry = await this.executePlatform(article, publish, kind === 'patrol' || kind === 'manual');
        const index = firstResults.findIndex((item) => item.platform === article.platform);
        firstResults[index] = retry;
      }
    }
    const run: MonitorRun = {
      id: `${Date.now()}-${randomUUID().slice(0, 8)}`,
      kind,
      startedAt,
      finishedAt: nowIso(),
      status: firstResults.every((item) => item.status === 'success' || item.status === 'warning')
        ? 'success'
        : firstResults.some((item) => item.status === 'success' || item.status === 'warning') ? 'partial' : 'failed',
      results: firstResults,
    };
    await this.store.saveRun(run);
    this.latestRun = run;
    for (const result of run.results) {
      const previous = this.platformResults[result.platform];
      this.platformResults[result.platform] = result;
      if (result.status === 'failed' || result.status === 'uncertain') {
        await this.notifySafely(`${PLATFORM_NAMES[result.platform]}巡检异常`, [result.code || 'UNKNOWN', result.message, `阶段：${result.stage}`, `耗时：${Math.round(result.durationMs / 1000)}秒`], result.screenshotPath);
      } else if (previous && (previous.status === 'failed' || previous.status === 'uncertain')) {
        await this.notifySafely(`${PLATFORM_NAMES[result.platform]}已恢复`, [result.message]);
      }
    }
    if (kind === 'weekly-publish' || (kind === 'patrol' && new Date().getHours() === 19)) {
      await this.notifySafely(kind === 'weekly-publish' ? '每周实发结果' : '每日巡检汇总', run.results.map((item) => `${PLATFORM_NAMES[item.platform]}：${item.status} ${item.message}`));
    }
    this.onChange();
    return run;
  }

  private async executePlatform(article: WeeklyArticle, publish: boolean, verifyPatrolCover: boolean): Promise<PlatformRunResult> {
    const startedAt = nowIso();
    let inspectBefore: unknown;
    try {
      const ledgerKey = `${isoWeek()}|${article.platform}|${article.contentHash}`;
      if (publish) {
        const existing = (await this.store.publishLedger())[ledgerKey];
        if (existing) return this.result(article.platform, startedAt, 'skipped', 'idempotency', `本周任务已记录为 ${existing.status}`);
      }
      inspectBefore = await this.cli.inspect(article.platform);
      const beforeFingerprint = pageFingerprint(inspectBefore);
      const fingerprintState = await this.store.fingerprints();
      const previousFingerprint = fingerprintState.schemaVersion === FINGERPRINT_SCHEMA_VERSION
        ? fingerprintState.platforms[article.platform]
        : undefined;
      const operation = publish ? await this.cli.publish(article) : await this.cli.fill(article);
      const inspectAfter = publish ? inspectBefore : await this.cli.inspect(article.platform);
      const afterFingerprint = pageFingerprint(inspectAfter);
      const screenshotPath = findScreenshot(operation);
      const warnings = fillWarnings(article.platform, operation);
      if (!publish && verifyPatrolCover && ['baijia', 'toutiao'].includes(article.platform)) {
        const markerFound = screenshotPath ? await hasPatrolCoverMarker(screenshotPath).catch(() => false) : false;
        if (!markerFound) warnings.push('封面视觉证据与本轮巡检封面不一致');
      }
      if (!publish) await this.store.setFingerprint(article.platform, afterFingerprint.hash);
      if (publish) {
        const status = this.publishStatus(operation);
        await this.store.recordPublish(ledgerKey, status, operation);
        return this.result(article.platform, startedAt, status, 'publish', status === 'success' ? '发布并核对成功' : status === 'uncertain' ? '发布结果不明确，禁止自动重试' : '平台未确认发布成功', screenshotPath, afterFingerprint.hash, previousFingerprint, operation);
      }
      const changed = Boolean(previousFingerprint && previousFingerprint !== afterFingerprint.hash);
      const blockingWarnings = warnings.filter((warning) => warning !== 'AI声明状态未确认');
      const status = blockingWarnings.length ? 'failed' : warnings.length || changed ? 'warning' : 'success';
      const message = [warnings.join('；'), changed ? '页面指纹发生变化' : ''].filter(Boolean).join('；') || '填充、页面检查和证据保存成功';
      return this.result(article.platform, startedAt, status, 'fill', message, screenshotPath, afterFingerprint.hash, previousFingerprint, operation, blockingWarnings.length ? 'ADAPTER_ERROR' : undefined);
    } catch (error) {
      const classified = classifyFailure(error, inspectBefore);
      let code = classified.code;
      let currentHash: string | undefined;
      try {
        const current = pageFingerprint(inspectBefore || await this.cli.inspect(article.platform));
        currentHash = current.hash;
        const fingerprintState = await this.store.fingerprints();
        const previous = fingerprintState.schemaVersion === FINGERPRINT_SCHEMA_VERSION
          ? fingerprintState.platforms[article.platform]
          : undefined;
        if (code === 'ADAPTER_ERROR' && previous && previous !== current.hash) code = 'PLATFORM_SCHEMA_CHANGED';
      } catch { /* preserve original error */ }
      return this.result(article.platform, startedAt, 'failed', 'fill', classified.message, findScreenshot((error as PublisherCliError)?.details), currentHash, undefined, { original: error instanceof Error ? error.message : String(error) }, code);
    }
  }

  private async patrolArticles(platforms: readonly Platform[]): Promise<WeeklyArticle[]> {
    const directory = join(this.dataDirectory, 'patrol-assets');
    await mkdir(directory, { recursive: true });
    const articles: WeeklyArticle[] = [];
    for (const [index, platform] of platforms.entries()) {
      const coverPath = await generateCover(directory, platform, PATROL_TITLE, index, true);
      articles.push({ platform, title: PATROL_TITLE, html: PATROL_HTML, tags: ['人工智能', '行业观察'], coverPath, contentHash: createHash('sha256').update(`${platform}|${PATROL_TITLE}|${PATROL_HTML}`).digest('hex') });
    }
    return articles;
  }

  private publishStatus(operation: unknown): 'success' | 'uncertain' | 'failed' {
    const raw = JSON.stringify(operation).toLowerCase();
    if (/result_uncertain|"status":"uncertain"|"outcome":"uncertain"/.test(raw)) return 'uncertain';
    if (/"status":"success"|"outcome":"success"|"published":true|"publishsuccess":true/.test(raw)) return 'success';
    return 'failed';
  }

  private async notifySafely(title: string, lines: string[], screenshotPath?: string): Promise<void> {
    try { await this.notifier.sendText(title, lines, screenshotPath); }
    catch { /* Notification delivery must not change the patrol or publish result. */ }
  }

  private result(platform: Platform, startedAt: string, status: PlatformRunResult['status'], stage: string, message: string, screenshotPath?: string, fingerprint?: string, previousFingerprint?: string, details?: unknown, code?: PlatformRunResult['code']): PlatformRunResult {
    const finishedAt = nowIso();
    return { platform, status, stage, code, message, startedAt, finishedAt, durationMs: Date.parse(finishedAt) - Date.parse(startedAt), screenshotPath, fingerprint, previousFingerprint, details };
  }

  private async saveSkipped(kind: MonitorRun['kind'], code: PlatformRunResult['code'], message: string): Promise<MonitorRun> {
    const now = nowIso();
    const run: MonitorRun = { id: `${Date.now()}-skipped`, kind, startedAt: now, finishedAt: now, status: 'skipped', results: PLATFORMS.map((platform) => this.result(platform, now, 'skipped', 'precondition', message, undefined, undefined, undefined, undefined, code)) };
    await this.store.saveRun(run);
    this.latestRun = run;
    return run;
  }

  private async runLocked<T>(task: string, operation: () => Promise<T>): Promise<T> {
    if (this.running) throw new Error(`巡检任务正在运行：${this.currentTask}`);
    this.running = true;
    this.currentTask = task;
    this.onChange();
    try { return await operation(); }
    finally { this.running = false; this.currentTask = null; this.onChange(); }
  }
}

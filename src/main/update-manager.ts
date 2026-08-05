import { app } from 'electron';
import { autoUpdater } from 'electron-updater';

export interface MonitorUpdateState {
  phase: string;
  currentVersion: string;
  availableVersion: string | null;
  progress: number | null;
  message: string;
  canRestart: boolean;
}

export const MONITOR_UPDATE_FEED = 'https://lingxi-1303034624.cos.ap-guangzhou.myqcloud.com/geo-publisher-monitor/releases/channels/stable/mac-arm64';

export class MonitorUpdateManager {
  private timer: NodeJS.Timeout | null = null;
  private state: MonitorUpdateState;

  constructor(currentVersion: string, private readonly isBusy: () => boolean, private readonly onChange: () => void) {
    this.state = { phase: app.isPackaged ? 'idle' : 'disabled', currentVersion, availableVersion: null, progress: null, message: app.isPackaged ? '等待检查更新' : '开发模式不检查更新', canRestart: false };
  }

  start(): void {
    if (!app.isPackaged) return;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.setFeedURL({ provider: 'generic', url: MONITOR_UPDATE_FEED });
    autoUpdater.on('checking-for-update', () => this.patch({ phase: 'checking', message: '正在检查更新' }));
    autoUpdater.on('update-available', (info) => this.patch({ phase: 'available', availableVersion: info.version, message: `发现新版本 ${info.version}` }));
    autoUpdater.on('update-not-available', () => this.patch({ phase: 'current', message: '当前已是最新版本' }));
    autoUpdater.on('download-progress', (progress) => this.patch({ phase: 'downloading', progress: Math.round(progress.percent), message: `正在下载 ${Math.round(progress.percent)}%` }));
    autoUpdater.on('update-downloaded', (info) => this.patch({ phase: 'downloaded', availableVersion: info.version, progress: 100, canRestart: !this.isBusy(), message: this.isBusy() ? '更新已下载，巡检结束后可安装' : '更新已下载，可以重启安装' }));
    autoUpdater.on('error', (error) => this.patch({ phase: 'error', message: `更新检查失败：${error.message}`, canRestart: false }));
    setTimeout(() => { void this.check(); }, 30_000).unref();
    this.timer = setInterval(() => { void this.check(); }, 60 * 60 * 1000);
    this.timer.unref();
  }

  getState(): MonitorUpdateState {
    if (this.state.phase === 'downloaded' && !this.isBusy() && !this.state.canRestart) this.patch({ canRestart: true, message: '更新已下载，可以重启安装' });
    return { ...this.state };
  }

  async check(): Promise<MonitorUpdateState> {
    if (app.isPackaged) await autoUpdater.checkForUpdates().catch((error) => this.patch({ phase: 'error', message: `更新检查失败：${error instanceof Error ? error.message : String(error)}` }));
    return this.getState();
  }

  install(): { accepted: boolean; message: string } {
    if (this.state.phase !== 'downloaded') return { accepted: false, message: '尚未下载更新' };
    if (this.isBusy()) return { accepted: false, message: '巡检或发布任务运行中' };
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return { accepted: true, message: '正在重启安装' };
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  private patch(change: Partial<MonitorUpdateState>): void { this.state = { ...this.state, ...change }; this.onChange(); }
}

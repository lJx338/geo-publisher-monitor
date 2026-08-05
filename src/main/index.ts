import { join } from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, powerMonitor, shell, Tray } from 'electron';
import packageJson from '../../package.json' with { type: 'json' };
import { settingsInputSchema, type DashboardState, type Platform } from '../shared.js';
import { SettingsStore } from './config.js';
import { FeishuNotifier } from './feishu.js';
import { MonitorService } from './monitor-service.js';
import { PublisherCli } from './publisher-cli.js';
import { ReportStore } from './report-store.js';
import { MonitorScheduler } from './scheduler.js';
import { MonitorUpdateManager } from './update-manager.js';

app.setName('GEO Publisher Monitor');

async function run(): Promise<void> {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('首版 GEO Publisher Monitor 仅支持 Apple Silicon macOS');
  if (!app.requestSingleInstanceLock()) { app.quit(); return; }
  await app.whenReady();
  const dataDirectory = app.getPath('userData');
  const settings = new SettingsStore(dataDirectory);
  await settings.load();
  const store = new ReportStore(dataDirectory);
  const cli = new PublisherCli();
  const notifier = new FeishuNotifier(() => {
    const publicValue = settings.publicValue();
    const secrets = settings.credentials();
    return { webhook: publicValue.feishuWebhook, appId: publicValue.feishuAppId, appSecret: secrets.feishuAppSecret };
  });

  const startedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
  const window = new BrowserWindow({
    show: !startedAtLogin,
    width: 1320,
    height: 840,
    minWidth: 1040,
    minHeight: 680,
    title: 'GEO Publisher Monitor',
    backgroundColor: '#f4f6f8',
    webPreferences: { preload: join(__dirname, '..', 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });

  let scheduler!: MonitorScheduler;
  let updateManager!: MonitorUpdateManager;
  const broadcast = (): void => {
    if (!window.isDestroyed() && updateManager && scheduler) window.webContents.send('monitor:state', service.state(scheduler.nextPatrolAt(), updateManager.getState()));
  };
  const service = new MonitorService(dataDirectory, packageJson.version, settings, store, cli, notifier, broadcast);
  updateManager = new MonitorUpdateManager(packageJson.version, () => service.isRunning(), broadcast);
  scheduler = new MonitorScheduler(
    store,
    () => settings.publicValue().scheduleHours,
    () => settings.publicValue().autoPublishEnabled,
    { patrol: () => service.runPatrol(), generate: () => service.generateWeekly(), preflight: () => service.preflightWeekly(), publish: () => service.publishWeekly() },
    broadcast,
  );
  await service.initialize();
  let quitting = false;

  const state = (): DashboardState => service.state(scheduler.nextPatrolAt(), updateManager.getState());
  ipcMain.handle('monitor:get-state', () => state());
  ipcMain.handle('monitor:run-patrol', () => service.runPatrol('manual'));
  ipcMain.handle('monitor:run-platform', (_event, platform: Platform) => service.runPatrol('manual', [platform]));
  ipcMain.handle('monitor:weekly-generate', () => service.generateWeekly());
  ipcMain.handle('monitor:weekly-preflight', () => service.preflightWeekly());
  ipcMain.handle('monitor:weekly-publish', () => service.publishWeekly());
  ipcMain.handle('monitor:save-settings', async (_event, input: unknown) => {
    const value = await settings.save(settingsInputSchema.parse(input));
    broadcast();
    return value;
  });
  ipcMain.handle('monitor:test-feishu', () => notifier.sendText('GEO Publisher Monitor', ['飞书通知配置成功', new Date().toLocaleString('zh-CN')]));
  ipcMain.handle('monitor:open-evidence', (_event, path: string) => shell.showItemInFolder(path));
  ipcMain.handle('monitor:update-check', () => updateManager.check());
  ipcMain.handle('monitor:update-install', () => updateManager.install());

  await window.loadFile(join(__dirname, '..', 'renderer', 'index.html'));
  await scheduler.start();
  updateManager.start();

  window.on('close', (event) => { if (!quitting) { event.preventDefault(); window.hide(); } });
  app.on('second-instance', () => { window.show(); window.focus(); });
  powerMonitor.on('resume', () => { void scheduler.resume(); });

  const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22"><path fill="#111" d="M3 4h16v3H3zm0 6h10v3H3zm0 6h16v3H3z"/><circle cx="17" cy="11.5" r="3" fill="#16a34a"/></svg>`;
  const tray = new Tray(nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(traySvg).toString('base64')}`).resize({ width: 18, height: 18 }));
  tray.setToolTip('GEO Publisher Monitor');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开巡检面板', click: () => { window.show(); window.focus(); } },
    { label: '立即巡检', click: () => { void service.runPatrol('manual'); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { window.show(); window.focus(); });

  app.on('before-quit', () => { quitting = true; scheduler.stop(); updateManager.stop(); });
  broadcast();
}

run().catch((error) => { console.error(error); app.quit(); });

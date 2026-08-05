import { contextBridge, ipcRenderer } from 'electron';
import type { Platform, SettingsInput } from './shared.js';

contextBridge.exposeInMainWorld('monitor', {
  getState: () => ipcRenderer.invoke('monitor:get-state'),
  runPatrol: () => ipcRenderer.invoke('monitor:run-patrol'),
  runPlatform: (platform: Platform) => ipcRenderer.invoke('monitor:run-platform', platform),
  generateWeekly: () => ipcRenderer.invoke('monitor:weekly-generate'),
  preflightWeekly: () => ipcRenderer.invoke('monitor:weekly-preflight'),
  publishWeekly: () => ipcRenderer.invoke('monitor:weekly-publish'),
  saveSettings: (settings: SettingsInput) => ipcRenderer.invoke('monitor:save-settings', settings),
  testFeishu: () => ipcRenderer.invoke('monitor:test-feishu'),
  openEvidence: (path: string) => ipcRenderer.invoke('monitor:open-evidence', path),
  checkUpdate: () => ipcRenderer.invoke('monitor:update-check'),
  installUpdate: () => ipcRenderer.invoke('monitor:update-install'),
  onState: (callback: (state: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on('monitor:state', listener);
    return () => ipcRenderer.removeListener('monitor:state', listener);
  },
});

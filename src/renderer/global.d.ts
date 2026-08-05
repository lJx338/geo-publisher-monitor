import type { DashboardState, Platform, SettingsInput } from '../shared.js';

declare global {
  interface Window {
    monitor: {
      getState(): Promise<DashboardState>;
      runPatrol(): Promise<unknown>;
      runPlatform(platform: Platform): Promise<unknown>;
      generateWeekly(): Promise<unknown>;
      preflightWeekly(): Promise<unknown>;
      publishWeekly(): Promise<unknown>;
      saveSettings(settings: SettingsInput): Promise<unknown>;
      testFeishu(): Promise<unknown>;
      openEvidence(path: string): Promise<unknown>;
      checkUpdate(): Promise<unknown>;
      installUpdate(): Promise<unknown>;
      onState(callback: (state: DashboardState) => void): () => void;
    };
  }
}

export {};

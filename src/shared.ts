import { z } from 'zod';

export const PLATFORMS = ['baijia', 'toutiao', 'zhihu', 'penguin', 'sohu', 'netease'] as const;
export type Platform = typeof PLATFORMS[number];

export const PLATFORM_NAMES: Record<Platform, string> = {
  baijia: '百家号',
  toutiao: '头条号',
  zhihu: '知乎',
  penguin: '企鹅号',
  sohu: '搜狐号',
  netease: '网易号',
};

export const monitorErrorCodes = [
  'LOGIN_REQUIRED',
  'RISK_CONTROL_REQUIRED',
  'NETWORK_SLOW',
  'QUOTA_EXHAUSTED',
  'PLATFORM_SCHEMA_CHANGED',
  'ADAPTER_ERROR',
  'PUBLISHER_BUSY',
  'PUBLISHER_UPDATE_REQUIRED',
] as const;
export type MonitorErrorCode = typeof monitorErrorCodes[number];

export interface PlatformRunResult {
  platform: Platform;
  status: 'success' | 'warning' | 'failed' | 'skipped' | 'uncertain';
  stage: string;
  code?: MonitorErrorCode;
  message: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  screenshotPath?: string;
  fingerprint?: string;
  previousFingerprint?: string;
  details?: unknown;
}

export interface MonitorRun {
  id: string;
  kind: 'patrol' | 'weekly-generate' | 'weekly-preflight' | 'weekly-publish' | 'manual';
  startedAt: string;
  finishedAt: string;
  status: 'success' | 'partial' | 'failed' | 'skipped';
  results: PlatformRunResult[];
}

export interface PublicSettings {
  scheduleHours: number[];
  autoPublishEnabled: boolean;
  openAtLogin: boolean;
  feishuWebhook: string;
  feishuAppId: string;
  hasFeishuAppSecret: boolean;
  llmBaseUrl: string;
  llmModel: string;
  hasLlmApiKey: boolean;
}

export const settingsInputSchema = z.object({
  scheduleHours: z.array(z.number().int().min(0).max(23)).min(1).max(12),
  autoPublishEnabled: z.boolean(),
  openAtLogin: z.boolean(),
  feishuWebhook: z.string().trim(),
  feishuAppId: z.string().trim(),
  feishuAppSecret: z.string().optional(),
  clearFeishuAppSecret: z.boolean().optional(),
  llmBaseUrl: z.string().trim(),
  llmModel: z.string().trim(),
  llmApiKey: z.string().optional(),
  clearLlmApiKey: z.boolean().optional(),
});
export type SettingsInput = z.infer<typeof settingsInputSchema>;

export interface DashboardState {
  version: string;
  running: boolean;
  currentTask: string | null;
  nextPatrolAt: string | null;
  publisher: { connected: boolean; version: string | null; busy: boolean; message: string };
  settings: PublicSettings;
  latestRun: MonitorRun | null;
  platformResults: Partial<Record<Platform, PlatformRunResult>>;
  update: {
    phase: string;
    currentVersion: string;
    availableVersion: string | null;
    progress: number | null;
    message: string;
    canRestart: boolean;
  };
}

export interface WeeklyArticle {
  platform: Platform;
  title: string;
  html: string;
  tags: string[];
  coverPath: string;
  contentHash: string;
}

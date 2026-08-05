import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app, safeStorage } from 'electron';
import type { PublicSettings, SettingsInput } from '../shared.js';

interface StoredSettings {
  scheduleHours: number[];
  autoPublishEnabled: boolean;
  openAtLogin: boolean;
  feishuWebhook: string;
  feishuAppId: string;
  encryptedFeishuAppSecret: string;
  llmBaseUrl: string;
  llmModel: string;
  encryptedLlmApiKey: string;
}

const defaults: StoredSettings = {
  scheduleHours: [1, 7, 13, 19],
  autoPublishEnabled: false,
  openAtLogin: true,
  feishuWebhook: '',
  feishuAppId: '',
  encryptedFeishuAppSecret: '',
  llmBaseUrl: 'https://api.openai.com/v1',
  llmModel: '',
  encryptedLlmApiKey: '',
};

export class SettingsStore {
  private value: StoredSettings = { ...defaults };
  private readonly path: string;

  constructor(dataDirectory: string) {
    this.path = join(dataDirectory, 'settings.json');
  }

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<StoredSettings>;
      this.value = { ...defaults, ...parsed };
    } catch {
      this.value = { ...defaults };
    }
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: this.value.openAtLogin, openAsHidden: true });
  }

  publicValue(): PublicSettings {
    return {
      scheduleHours: [...this.value.scheduleHours],
      autoPublishEnabled: this.value.autoPublishEnabled,
      openAtLogin: this.value.openAtLogin,
      feishuWebhook: this.value.feishuWebhook,
      feishuAppId: this.value.feishuAppId,
      hasFeishuAppSecret: Boolean(this.value.encryptedFeishuAppSecret),
      llmBaseUrl: this.value.llmBaseUrl,
      llmModel: this.value.llmModel,
      hasLlmApiKey: Boolean(this.value.encryptedLlmApiKey),
    };
  }

  credentials(): { feishuAppSecret: string; llmApiKey: string } {
    return {
      feishuAppSecret: this.decrypt(this.value.encryptedFeishuAppSecret),
      llmApiKey: this.decrypt(this.value.encryptedLlmApiKey),
    };
  }

  async save(input: SettingsInput): Promise<PublicSettings> {
    this.value = {
      ...this.value,
      scheduleHours: [...new Set(input.scheduleHours)].sort((a, b) => a - b),
      autoPublishEnabled: input.autoPublishEnabled,
      openAtLogin: input.openAtLogin,
      feishuWebhook: input.feishuWebhook,
      feishuAppId: input.feishuAppId,
      llmBaseUrl: input.llmBaseUrl.replace(/\/+$/, ''),
      llmModel: input.llmModel,
    };
    if (input.clearFeishuAppSecret) this.value.encryptedFeishuAppSecret = '';
    else if (input.feishuAppSecret) this.value.encryptedFeishuAppSecret = this.encrypt(input.feishuAppSecret);
    if (input.clearLlmApiKey) this.value.encryptedLlmApiKey = '';
    else if (input.llmApiKey) this.value.encryptedLlmApiKey = this.encrypt(input.llmApiKey);
    await this.persist();
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: this.value.openAtLogin, openAsHidden: true });
    return this.publicValue();
  }

  private encrypt(value: string): string {
    if (!value) return '';
    if (!safeStorage.isEncryptionAvailable()) throw new Error('macOS 钥匙串当前不可用，无法安全保存密钥');
    return safeStorage.encryptString(value).toString('base64');
  }

  private decrypt(value: string): string {
    if (!value || !safeStorage.isEncryptionAvailable()) return '';
    try {
      return safeStorage.decryptString(Buffer.from(value, 'base64'));
    } catch {
      return '';
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.new`;
    await writeFile(temporary, JSON.stringify(this.value, null, 2), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

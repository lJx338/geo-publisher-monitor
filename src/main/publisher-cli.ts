import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import semver from 'semver';
import type { Platform, WeeklyArticle } from '../shared.js';

interface DiscoveryRecord {
  appVersion?: string;
  cliPath?: string;
  ready?: boolean;
}

interface CliEnvelope {
  ok: boolean;
  version?: string;
  data?: unknown;
  code?: string;
  message?: string;
  suggestion?: string;
  details?: unknown;
}

export class PublisherCliError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export class PublisherCli {
  private cliPath = '';

  async discover(): Promise<DiscoveryRecord> {
    const path = join(homedir(), 'Library', 'Application Support', 'GEO Publisher Desktop', 'discovery.json');
    let record: DiscoveryRecord;
    try {
      record = JSON.parse(await readFile(path, 'utf8')) as DiscoveryRecord;
    } catch {
      throw new PublisherCliError('PUBLISHER_UPDATE_REQUIRED', '找不到 GEO Publisher discovery.json，请先安装并打开 GEO Publisher 0.2.0');
    }
    if (!record.cliPath) throw new PublisherCliError('PUBLISHER_UPDATE_REQUIRED', 'GEO Publisher 尚未安装 CLI，请打开桌面端完成初始化');
    this.cliPath = record.cliPath;
    return record;
  }

  async health(): Promise<{ connected: boolean; version: string; busy: boolean; raw: unknown }> {
    const record = await this.discover();
    const version = record.appVersion || '';
    if (!semver.valid(version) || semver.lt(version, '0.2.0')) {
      throw new PublisherCliError('PUBLISHER_UPDATE_REQUIRED', `GEO Publisher ${version || '未知版本'} 过低，需要 0.2.0 或更高版本`);
    }
    if (!record.ready) await this.execute(['start'], undefined, 35_000);
    const status = await this.execute(['status'], undefined, 20_000) as Record<string, unknown>;
    return { connected: true, version, busy: Boolean(status.busy), raw: status };
  }

  inspect(platform: Platform): Promise<unknown> {
    return this.execute(['inspect', platform], undefined, 170_000);
  }

  fill(article: WeeklyArticle): Promise<unknown> {
    const { platform, title, html, coverPath, tags } = article;
    return this.execute(['fill'], { platform, title, html, coverPath, tags }, 260_000);
  }

  publish(article: WeeklyArticle): Promise<unknown> {
    const { platform, title, html, coverPath, tags } = article;
    return this.execute(['publish'], { platform, title, html, coverPath, tags, confirmPublish: true }, 260_000);
  }

  private async execute(args: string[], input?: unknown, timeoutMs = 30_000): Promise<unknown> {
    if (!this.cliPath) await this.discover();
    return await new Promise((resolve, reject) => {
      const child = spawn(this.cliPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new PublisherCliError('NETWORK_SLOW', `GEO Publisher CLI 在 ${Math.round(timeoutMs / 1000)} 秒内未返回`));
      }, timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new PublisherCliError('PUBLISHER_UPDATE_REQUIRED', `无法启动 GEO Publisher CLI：${error.message}`));
      });
      child.on('close', () => {
        clearTimeout(timer);
        const raw = Buffer.concat(stdout.length ? stdout : stderr).toString('utf8').trim();
        let envelope: CliEnvelope;
        try {
          envelope = JSON.parse(raw) as CliEnvelope;
        } catch {
          reject(new PublisherCliError('ADAPTER_ERROR', `CLI 返回无法解析的数据：${raw.slice(0, 500)}`));
          return;
        }
        if (!envelope.ok) {
          reject(new PublisherCliError(envelope.code || 'ADAPTER_ERROR', envelope.message || 'GEO Publisher CLI 执行失败', envelope.details));
          return;
        }
        resolve(envelope.data);
      });
      if (input === undefined) child.stdin.end();
      else child.stdin.end(`${JSON.stringify(input)}\n`);
    });
  }
}

import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

interface FeishuConfig {
  webhook: string;
  appId: string;
  appSecret: string;
}

export class FeishuNotifier {
  constructor(private readonly getConfig: () => FeishuConfig) {}

  async sendText(title: string, lines: string[], screenshotPath?: string): Promise<void> {
    const config = this.getConfig();
    if (!config.webhook) return;
    const text = [`【${title}】`, ...lines].join('\n');
    await this.webhook(config.webhook, { msg_type: 'text', content: { text } });
    if (!screenshotPath || !config.appId || !config.appSecret) return;
    try {
      const imageKey = await this.uploadImage(config, screenshotPath);
      await this.webhook(config.webhook, { msg_type: 'image', content: { image_key: imageKey } });
    } catch (error) {
      await this.webhook(config.webhook, {
        msg_type: 'text',
        content: { text: `截图上传失败，已保存在开发机：${screenshotPath}\n${error instanceof Error ? error.message : String(error)}` },
      });
    }
  }

  private async uploadImage(config: FeishuConfig, path: string): Promise<string> {
    const tokenResponse = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
      signal: AbortSignal.timeout(20_000),
    });
    const tokenPayload = await tokenResponse.json() as { code?: number; msg?: string; tenant_access_token?: string };
    if (!tokenResponse.ok || tokenPayload.code || !tokenPayload.tenant_access_token) {
      throw new Error(`获取飞书访问令牌失败：${tokenPayload.msg || tokenResponse.status}`);
    }
    const form = new FormData();
    form.set('image_type', 'message');
    form.set('image', new Blob([await readFile(path)]), basename(path));
    const imageResponse = await fetch('https://open.feishu.cn/open-apis/im/v1/images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokenPayload.tenant_access_token}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const imagePayload = await imageResponse.json() as { code?: number; msg?: string; data?: { image_key?: string } };
    if (!imageResponse.ok || imagePayload.code || !imagePayload.data?.image_key) {
      throw new Error(`上传飞书图片失败：${imagePayload.msg || imageResponse.status}`);
    }
    return imagePayload.data.image_key;
  }

  private async webhook(url: string, payload: unknown): Promise<void> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`飞书机器人返回 HTTP ${response.status}`);
    const body = await response.json() as { code?: number; StatusCode?: number; msg?: string; StatusMessage?: string };
    if ((body.code && body.code !== 0) || (body.StatusCode && body.StatusCode !== 0)) {
      throw new Error(body.msg || body.StatusMessage || '飞书机器人发送失败');
    }
  }
}

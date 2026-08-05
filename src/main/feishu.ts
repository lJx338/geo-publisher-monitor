import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

interface FeishuConfig {
  appId: string;
  appSecret: string;
  recipient: string;
}

interface FeishuResponse {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
  data?: { image_key?: string };
}

export class FeishuNotifier {
  private accessToken = '';
  private tokenAppId = '';
  private tokenExpiresAt = 0;

  constructor(private readonly getConfig: () => FeishuConfig) {}

  async sendText(title: string, lines: string[], screenshotPath?: string): Promise<void> {
    const config = this.getConfig();
    this.validateConfig(config);
    const token = await this.token(config);
    const text = [`【${title}】`, ...lines].join('\n');
    await this.sendMessage(token, config.recipient, 'text', { text });
    if (!screenshotPath) return;
    try {
      const imageKey = await this.uploadImage(token, screenshotPath);
      await this.sendMessage(token, config.recipient, 'image', { image_key: imageKey });
    } catch (error) {
      await this.sendMessage(token, config.recipient, 'text', {
        text: `截图发送失败，证据已保存在开发机：${screenshotPath}\n${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  private validateConfig(config: FeishuConfig): void {
    const missing = [!config.appId && 'App ID', !config.appSecret && 'App Secret', !config.recipient && '接收人'].filter(Boolean);
    if (missing.length) throw new Error(`请先配置飞书应用机器人的 ${missing.join('、')}`);
    if (!config.appId.startsWith('cli_')) throw new Error('飞书 App ID 格式不正确，应以 cli_ 开头');
    if (!config.recipient.startsWith('ou_') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.recipient)) {
      throw new Error('飞书接收人应填写企业邮箱或 ou_ 开头的 Open ID');
    }
  }

  private async token(config: FeishuConfig): Promise<string> {
    if (this.accessToken && this.tokenAppId === config.appId && Date.now() < this.tokenExpiresAt) return this.accessToken;
    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await this.payload(response, '获取飞书访问令牌失败');
    if (!payload.tenant_access_token) throw new Error('获取飞书访问令牌失败：响应中没有 token');
    this.accessToken = payload.tenant_access_token;
    this.tokenAppId = config.appId;
    this.tokenExpiresAt = Date.now() + Math.max(60, (payload.expire || 7200) - 300) * 1000;
    return this.accessToken;
  }

  private async uploadImage(token: string, path: string): Promise<string> {
    const form = new FormData();
    form.set('image_type', 'message');
    form.set('image', new Blob([await readFile(path)]), basename(path));
    const response = await fetch('https://open.feishu.cn/open-apis/im/v1/images', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await this.payload(response, '上传飞书图片失败');
    if (!payload.data?.image_key) throw new Error('上传飞书图片失败：响应中没有 image_key');
    return payload.data.image_key;
  }

  private async sendMessage(token: string, recipient: string, msgType: 'text' | 'image', content: unknown): Promise<void> {
    const receiveIdType = recipient.startsWith('ou_') ? 'open_id' : 'email';
    const response = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${receiveIdType}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ receive_id: recipient, msg_type: msgType, content: JSON.stringify(content) }),
      signal: AbortSignal.timeout(20_000),
    });
    await this.payload(response, '发送飞书机器人消息失败');
  }

  private async payload(response: Response, action: string): Promise<FeishuResponse> {
    const payload = await response.json().catch(() => ({})) as FeishuResponse;
    if (!response.ok || payload.code) throw new Error(`${action}：${payload.msg || `HTTP ${response.status}`}`);
    return payload;
  }
}

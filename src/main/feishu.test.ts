import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeishuNotifier } from './feishu.js';

afterEach(() => vi.unstubAllGlobals());

describe('FeishuNotifier', () => {
  it('requires a complete application bot configuration', async () => {
    const notifier = new FeishuNotifier(() => ({ appId: '', appSecret: '', chatId: '' }));
    await expect(notifier.sendText('巡检', ['正常'])).rejects.toThrow('App ID、App Secret、接收群 Chat ID');
  });

  it('uses the application bot token to send a group message', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, tenant_access_token: 'token', expire: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 0 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const notifier = new FeishuNotifier(() => ({ appId: 'cli_example', appSecret: 'secret', chatId: 'oc_example' }));
    await notifier.sendText('巡检结果', ['六个平台正常']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]![0]).toContain('receive_id_type=chat_id');
    const request = JSON.parse(String((fetchMock.mock.calls[1]![1] as RequestInit).body));
    expect(request).toMatchObject({ receive_id: 'oc_example', msg_type: 'text' });
    expect(JSON.parse(request.content).text).toContain('六个平台正常');
  });
});

import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { classifyFailure, fillWarnings, findScreenshot, hasPatrolCoverMarker, pageFingerprint } from './diagnostics.js';

describe('monitor diagnostics', () => {
  it('separates login, risk, network and quota failures', () => {
    expect(classifyFailure(new Error('请重新登录')).code).toBe('LOGIN_REQUIRED');
    expect(classifyFailure(new Error('需要滑块验证')).code).toBe('RISK_CONTROL_REQUIRED');
    expect(classifyFailure(new Error('NETWORK_SLOW timeout')).code).toBe('NETWORK_SLOW');
    expect(classifyFailure(new Error('今日次数已用完')).code).toBe('QUOTA_EXHAUSTED');
    expect(classifyFailure({ code: 'PLATFORM_SCHEMA_CHANGED', message: 'selector changed' })).toEqual({ code: 'PLATFORM_SCHEMA_CHANGED', message: 'selector changed' });
  });

  it('uses stable page attributes for fingerprints', () => {
    const first = pageFingerprint({ url: 'https://zhuanlan.zhihu.com/p/2068403335191961963/edit?draft=1', buttons: [{ text: '发布', className: 'dynamic-a' }, { text: '随机推荐' }], editables: [{ tag: 'DIV', placeholder: '请输入正文', className: 'x' }], controls: [] });
    const second = pageFingerprint({ url: 'https://zhuanlan.zhihu.com/p/2068403667955462515/edit?draft=2', buttons: [{ text: '发布', className: 'dynamic-b' }, { text: '另一条推荐' }], editables: [{ tag: 'DIV', placeholder: '请输入正文', className: 'y' }], controls: [] });
    expect(first.hash).toBe(second.hash);
  });

  it('finds nested evidence and reports optional fill warnings', () => {
    expect(findScreenshot({ fill: { screenshotPath: '/tmp/evidence.png' } })).toBe('/tmp/evidence.png');
    expect(fillWarnings('toutiao', { titleFilled: true, bodyFilled: true, coverUploaded: false })).toContain('封面状态未确认');
  });

  it('detects the patrol-only visual cover marker', async () => {
    const image = new PNG({ width: 30, height: 10 });
    const colors = [[255, 0, 255], [0, 255, 255], [255, 255, 0]];
    for (let x = 0; x < image.width; x += 1) {
      const color = colors[Math.floor(x / 10)]!;
      for (let y = 0; y < image.height; y += 1) {
        const offset = (y * image.width + x) * 4;
        image.data.set([...color, 255], offset);
      }
    }
    const directory = await mkdtemp(join(tmpdir(), 'geo-monitor-marker-'));
    const path = join(directory, 'evidence.png');
    await writeFile(path, PNG.sync.write(image));
    expect(await hasPatrolCoverMarker(path)).toBe(true);
  });
});

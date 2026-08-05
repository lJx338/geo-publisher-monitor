import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { monitorErrorCodes, type MonitorErrorCode, type Platform } from '../shared.js';

export const FINGERPRINT_SCHEMA_VERSION = 1;

function textOf(value: unknown): string {
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function classifyFailure(error: unknown, inspect?: unknown): { code: MonitorErrorCode; message: string } {
  const coded = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
  if (typeof coded.code === 'string' && monitorErrorCodes.includes(coded.code as MonitorErrorCode)) {
    return { code: coded.code as MonitorErrorCode, message: typeof coded.message === 'string' ? coded.message : coded.code };
  }
  const raw = `${error instanceof Error ? error.message : textOf(error)} ${textOf(inspect)}`;
  if (/登录|扫码|login|passport|重新登录/i.test(raw)) return { code: 'LOGIN_REQUIRED', message: '平台登录态失效或需要登录' };
  if (/验证码|安全验证|风险|滑块|captcha|verify/i.test(raw)) return { code: 'RISK_CONTROL_REQUIRED', message: '平台要求人工完成验证或风控处理' };
  if (/次数已用完|达到上限|剩余\s*0|quota/i.test(raw)) return { code: 'QUOTA_EXHAUSTED', message: '平台当日发布次数已用完' };
  if (/timeout|timed out|网络|ERR_CONNECTION|ERR_TIMED_OUT|NETWORK_SLOW/i.test(raw)) return { code: 'NETWORK_SLOW', message: '页面或网络响应超时' };
  if (/busy|正在运行|PUBLISHER_BUSY/i.test(raw)) return { code: 'PUBLISHER_BUSY', message: 'GEO Publisher 正在执行其他任务' };
  if (/PUBLISHER_UPDATE_REQUIRED|版本.*过低|discovery|CLI/i.test(raw)) return { code: 'PUBLISHER_UPDATE_REQUIRED', message: error instanceof Error ? error.message : 'GEO Publisher 需要更新或初始化' };
  return { code: 'ADAPTER_ERROR', message: error instanceof Error ? error.message : String(error) };
}

function normalizeStrings(values: unknown[], limit = 80): string[] {
  return values
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, limit)
    .sort();
}

export function pageFingerprint(inspect: unknown): { hash: string; schema: unknown } {
  const data = (inspect && typeof inspect === 'object' ? inspect : {}) as Record<string, unknown>;
  const buttons = Array.isArray(data.buttons) ? data.buttons : [];
  const editables = Array.isArray(data.editables) ? data.editables : [];
  const controls = Array.isArray(data.controls) ? data.controls : [];
  const url = typeof data.url === 'string'
    ? data.url.replace(/[?#].*$/, '').replace(/\/p\/\d+(?=\/|$)/g, '/p/:id').replace(/[a-f0-9]{24,}/gi, ':id')
    : '';
  const structuralButton = /发布|预览|封面|声明|保存|确认|提交|摘要|标签/;
  const schema = {
    url,
    buttons: normalizeStrings(buttons.map((item) => (item as Record<string, unknown>)?.text).filter((text) => structuralButton.test(String(text || '')))),
    editables: normalizeStrings(editables.map((item) => {
      const value = item as Record<string, unknown>;
      return `${value.tag || ''}|${value.type || ''}|${value.placeholder || ''}|${value.contenteditable || ''}`;
    })),
    controls: normalizeStrings(controls.map((item) => {
      const value = item as Record<string, unknown>;
      return `${value.type || ''}|${value.text || ''}|${value.value || ''}`;
    })),
  };
  return { hash: createHash('sha256').update(JSON.stringify(schema)).digest('hex'), schema };
}

export function findScreenshot(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/screenshotPath$/i.test(key) && typeof nested === 'string') return nested;
    const found = findScreenshot(nested);
    if (found) return found;
  }
  return undefined;
}

export function fillWarnings(platform: Platform, value: unknown): string[] {
  const raw = textOf(value);
  const warnings: string[] = [];
  if (/"titleFilled":false/.test(raw)) warnings.push('标题填充未确认');
  if (/"bodyFilled":false/.test(raw)) warnings.push('正文填充未确认');
  if (/"publishButtonDetected":false/.test(raw)) warnings.push('未识别到发布按钮');
  if (['baijia', 'toutiao', 'netease'].includes(platform) && /"coverUploaded":false/.test(raw)) warnings.push('封面状态未确认');
  if (/"aiDeclaration(?:Selected|Found)":false/.test(raw)) warnings.push('AI声明状态未确认');
  return warnings;
}

export async function hasPatrolCoverMarker(screenshotPath: string): Promise<boolean> {
  const image = PNG.sync.read(await readFile(screenshotPath));
  const matches = [0, 0, 0];
  const colors = [[255, 0, 255], [0, 255, 255], [255, 255, 0]];
  for (let offset = 0; offset < image.data.length; offset += 4) {
    if (image.data[offset + 3]! < 220) continue;
    for (let index = 0; index < colors.length; index += 1) {
      const color = colors[index]!;
      if (Math.abs(image.data[offset]! - color[0]!) <= 18
        && Math.abs(image.data[offset + 1]! - color[1]!) <= 18
        && Math.abs(image.data[offset + 2]! - color[2]!) <= 18) matches[index] = matches[index]! + 1;
    }
  }
  return matches.every((count) => count >= 20);
}

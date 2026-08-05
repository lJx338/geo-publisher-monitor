import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import type { Platform } from '../shared.js';

const palettes = [
  ['#0f766e', '#0b1324', '#f0fdfa'],
  ['#2563eb', '#111827', '#eff6ff'],
  ['#be123c', '#1f2937', '#fff1f2'],
  ['#7c3aed', '#172554', '#f5f3ff'],
  ['#047857', '#1c1917', '#ecfdf5'],
  ['#c2410c', '#27272a', '#fff7ed'],
];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export async function generateCover(directory: string, platform: Platform, title: string, index: number, patrolMarker = false): Promise<string> {
  await mkdir(directory, { recursive: true });
  const [accent, dark, light] = palettes[index % palettes.length]!;
  const html = `<!doctype html><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;width:1200px;height:675px;overflow:hidden;background:${dark};font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:${light}}
    main{position:relative;height:100%;padding:76px 88px;display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(135deg,${dark} 0%,${dark} 58%,${accent} 160%)}
    .mark{display:flex;align-items:center;gap:16px;font-size:25px;font-weight:650}.line{width:54px;height:7px;background:${accent}}
    h1{margin:0;max-width:980px;font-size:64px;line-height:1.2;font-weight:760;letter-spacing:0;overflow-wrap:anywhere}
    footer{display:flex;justify-content:space-between;font-size:22px;opacity:.82}.grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(to left,black,transparent 70%)}
    .patrol-marker{position:absolute;left:0;top:0;display:flex;z-index:2}.patrol-marker i{display:block;width:44px;height:44px}.patrol-marker i:nth-child(1){background:#ff00ff}.patrol-marker i:nth-child(2){background:#00ffff}.patrol-marker i:nth-child(3){background:#ffff00}
  </style><main><div class="grid"></div>${patrolMarker ? '<div class="patrol-marker"><i></i><i></i><i></i></div>' : ''}<div class="mark"><span class="line"></span>AI INDUSTRY BRIEF</div><h1>${escapeHtml(title)}</h1><footer><span>人工智能行业观察</span><span>${escapeHtml(platform.toUpperCase())}</span></footer></main>`;
  const window = new BrowserWindow({ show: false, width: 1200, height: 675, webPreferences: { sandbox: true } });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: 1200, height: 675 });
    const path = join(directory, `${platform}-cover.png`);
    await writeFile(path, image.toPNG());
    return path;
  } finally {
    window.destroy();
  }
}

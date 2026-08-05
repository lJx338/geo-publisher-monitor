import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

const evidence = join(process.cwd(), 'release', 'test-evidence');
await mkdir(evidence, { recursive: true });
const app = await electron.launch({ args: ['.'], env: { ...process.env, GEO_MONITOR_E2E: '1' } });
try {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  await window.setViewportSize({ width: 1320, height: 840 });
  await window.screenshot({ path: join(evidence, 'dashboard.png') });
  const title = await window.locator('h1').textContent();
  const cards = await window.locator('.platform-card').count();
  if (title !== '六平台发布链路巡检' || cards !== 6) throw new Error(`Unexpected dashboard: title=${title}, cards=${cards}`);
  if ((await window.locator('#toast').textContent())?.includes('No handler registered')) throw new Error('Dashboard requested state before IPC handlers were registered');
  await window.setViewportSize({ width: 1040, height: 680 });
  await window.screenshot({ path: join(evidence, 'dashboard-compact.png') });
} finally {
  await app.close();
}

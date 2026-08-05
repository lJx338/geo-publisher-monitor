import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _electron as electron } from 'playwright';

if (process.env.GEO_MONITOR_LIVE !== '1') throw new Error('Live patrol requires GEO_MONITOR_LIVE=1');
const evidence = join(process.cwd(), 'release', 'live-evidence');
await mkdir(evidence, { recursive: true });
const app = await electron.launch({ args: ['.'] });
try {
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  const requested = (process.env.GEO_MONITOR_PLATFORMS || '').split(',').map((item) => item.trim()).filter(Boolean);
  const run = requested.length
    ? await window.evaluate(async (platforms) => {
      const runs = [];
      for (const platform of platforms) runs.push(await window.monitor.runPlatform(platform));
      return { kind: 'targeted-live-patrol', runs };
    }, requested)
    : await window.evaluate(() => window.monitor.runPatrol());
  await writeFile(join(evidence, 'run.json'), JSON.stringify(run, null, 2));
  await window.screenshot({ path: join(evidence, 'dashboard-after-patrol.png'), fullPage: true });
  process.stdout.write(`${JSON.stringify(run, null, 2)}\n`);
} finally {
  await app.close();
}

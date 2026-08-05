import { readFile, writeFile } from 'node:fs/promises';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(version)) throw new Error('Usage: node scripts/set-version.mjs <major.minor.patch[-beta.N]>');
for (const path of ['package.json', 'package-lock.json']) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  value.version = version;
  if (value.packages?.['']) value.packages[''].version = version;
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

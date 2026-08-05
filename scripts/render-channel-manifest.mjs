import { readFile, writeFile } from 'node:fs/promises';
import { parse, stringify } from 'yaml';

const [input, output, artifactBaseUrl] = process.argv.slice(2);
if (!input || !output || !artifactBaseUrl) throw new Error('Usage: render-channel-manifest <input> <output> <artifact-base-url>');
const manifest = parse(await readFile(input, 'utf8'));
if (!manifest?.version || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Invalid update manifest');
const base = artifactBaseUrl.replace(/\/+$/, '');
manifest.files = manifest.files.map((file) => ({ ...file, url: `${base}/${encodeURIComponent(String(file.url).split('/').at(-1))}` }));
await writeFile(output, stringify(manifest, { lineWidth: 0 }));

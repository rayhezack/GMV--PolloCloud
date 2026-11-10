#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const destination = process.argv[2];
if (!destination) throw new Error('Usage: node install.mjs /absolute/project/components/DocumentStack');
const source = fileURLToPath(new URL('.', import.meta.url));
const target = resolve(destination);
const files = ['DocumentStack.tsx', 'DocumentStack.css'];
// Preflight every file before writing anything. Never replace differing user code.
const contents = await Promise.all(files.map(file => readFile(join(source, file), 'utf8')));
for (let i = 0; i < files.length; i++) {
  try { if (await readFile(join(target, files[i]), 'utf8') !== contents[i]) throw new Error(`Existing file differs: ${join(target, files[i])}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await mkdir(target, { recursive: true });
for (let i = 0; i < files.length; i++) await writeFile(join(target, files[i]), contents[i]);
console.log(`Installed DocumentStack into ${target}`);

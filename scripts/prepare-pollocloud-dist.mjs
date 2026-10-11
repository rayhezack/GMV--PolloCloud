import { copyFile, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const nestedIndex = path.join(root, 'dist', 'client', 'index.html');
const rootIndex = path.join(root, 'dist', 'index.html');
try {
  let html = await readFile(nestedIndex, 'utf8');
  html = html.replaceAll('../assets/', './assets/');
  await writeFile(rootIndex, html);
  await rm(path.join(root, 'dist', 'client'), { recursive: true, force: true });
} catch {
  // The Pollocloud Vite root is already `client`; keep its root index intact.
}
await copyFile(path.join(root, 'client', 'public', 'favicon.svg'), path.join(root, 'dist', 'favicon.svg')).catch(() => undefined);

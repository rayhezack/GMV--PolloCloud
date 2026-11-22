import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../worker/skills/pollo-gmv-diagnosis/', import.meta.url);
const main = await readFile(new URL('SKILL.md', root), 'utf8');
// The worker sends one bundled prompt; references must reach the runtime too.
const referencePaths = ['references/ratio-drilldown.md', 'references/diagnostic-routing.md', 'references/ratio-writing-examples.md', 'references/historical-report-style.md', 'references/daily-anomaly.md'];
const references = await Promise.all(referencePaths.map(async path => `<!-- ${path} -->\n${await readFile(new URL(path, root), 'utf8')}`));
const source = [main, ...references].join('\n\n');
const hash = createHash('sha256').update(source).digest('hex');
await writeFile(new URL('../worker/report-skill.generated.ts', import.meta.url), `// Generated from worker/skills/pollo-gmv-diagnosis/SKILL.md. Do not edit.\nexport const REPORT_SKILL_SHA256 = ${JSON.stringify(hash)};\nexport const REPORT_SKILL = ${JSON.stringify(source)};\n`);

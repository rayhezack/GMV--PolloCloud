import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = new URL('../worker/skills/pollo-gmv-diagnosis/', import.meta.url);
const main = await readFile(new URL('SKILL.md', root), 'utf8');
// The worker sends one bundled prompt; references must reach the runtime too.
const ratio = await readFile(new URL('references/ratio-drilldown.md', root), 'utf8');
const source = `${main}\n\n<!-- references/ratio-drilldown.md -->\n${ratio}`;
const hash = createHash('sha256').update(source).digest('hex');
await writeFile(new URL('../worker/report-skill.generated.ts', import.meta.url), `// Generated from worker/skills/pollo-gmv-diagnosis/SKILL.md. Do not edit.\nexport const REPORT_SKILL_SHA256 = ${JSON.stringify(hash)};\nexport const REPORT_SKILL = ${JSON.stringify(source)};\n`);

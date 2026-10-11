import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = await readFile(new URL('../worker/skills/pollo-gmv-diagnosis/SKILL.md', import.meta.url), 'utf8');
const hash = createHash('sha256').update(source).digest('hex');
await writeFile(new URL('../worker/report-skill.generated.ts', import.meta.url), `// Generated from worker/skills/pollo-gmv-diagnosis/SKILL.md. Do not edit.\nexport const REPORT_SKILL_SHA256 = ${JSON.stringify(hash)};\nexport const REPORT_SKILL = ${JSON.stringify(source)};\n`);

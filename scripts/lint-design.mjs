import fs from 'node:fs';
import path from 'node:path';
const strict=['client/src/pages','client/src/components/v62','client/src/components/system','client/src/components/charts'];
const legacy=['client/src/components/dashboard','client/src/components/bencho','client/src/components/finance-chart'];
function files(dir){return fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):/\.(css|tsx|ts)$/.test(e.name)?[path.join(dir,e.name)]:[]):[];}
function scan(file){const s=fs.readFileSync(file,'utf8');const issues=[];const add=(rule,re,valid=()=>false)=>{for(const m of s.matchAll(re))if(!valid(m))issues.push({file,line:s.slice(0,m.index).split('\n').length,rule,value:m[0]});};
add('hex',/#[0-9a-fA-F]{3,8}\b/g);
add('font-size',/font-size\s*:\s*(\d+(?:\.\d+)?)px/g,m=>[12,13,14,15,20,28].includes(+m[1]));
add('font shorthand',/font\s*:\s*(\d+(?:\.\d+)?)px/g,m=>[12,13,14,15,20,28].includes(+m[1]));
add('radius',/border-radius\s*:[^;}]*?\b(\d+(?:\.\d+)?)px/g,m=>[0,10,16,999].includes(+m[1]));
add('glass',/(?:-webkit-)?backdrop-filter\s*:(?!\s*(?:none|initial|unset)\b)/g);return issues;}
const errors=strict.flatMap(files).flatMap(scan);
for(const e of errors)console.error(`${e.file}:${e.line} ${e.rule}: ${e.value}`);
console.log(`Strict design issues: ${errors.length}`);
for(const dir of legacy){const found=files(dir).flatMap(scan);console.log(`${dir}: ${found.length} legacy issues (${['hex','font-size','radius','glass'].map(rule=>`${rule} ${found.filter(x=>x.rule===rule).length}`).join(', ')})`);}
process.exitCode=errors.length?1:0;

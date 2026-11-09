import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {REPORT_SKILL} from './report-skill.generated.ts';
const bundle=await build({entryPoints:['worker/report-jobs.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {generateMarkdown,executeReport}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const evidence=JSON.parse(await readFile('archives/report-pipeline-stage2-2026-11-08/app-evidence.json','utf8'));
function stream(markdown,finish='stop'){
  const payload=`data: ${JSON.stringify({choices:[{delta:{content:markdown},finish_reason:finish}]})}\n\ndata: [DONE]\n\n`;
  const bytes=new TextEncoder().encode(payload);
  return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=37)c.enqueue(bytes.slice(i,i+37));c.close();}}));
}
test('production sends exactly the bundled Skill and every prepared datum; returns model prose unchanged',async()=>{
  const original=globalThis.fetch;let calls=0;
  const modelText='# 模型自己组织的报告\n\n核心判断由模型撰写。\n\n<!-- 表格也由模型决定是否需要 -->\n';
  globalThis.fetch=async(url,options)=>{
    calls++;assert.equal(String(url),'https://fixture.local/chat/completions');
    const body=JSON.parse(options.body);
    assert.equal(body.messages[0].content,REPORT_SKILL,'no backend writing prompt');
    assert.equal(body.response_format,undefined,'no JSON writing contract');
    const input=JSON.parse(body.messages[1].content.split('\n')[1]);
    assert.deepEqual(input,evidence,'no country/function/action truncation or route selection');
    assert.doesNotMatch(body.messages[1].content,/summaryRequired|branchRequired|factIds|evidenceRefs/);
    return stream(modelText);
  };
  try{const stages=[];assert.equal(await generateMarkdown({KIMI_BASE_URL:'https://fixture.local',KIMI_API_KEY:'fixture'},evidence,'',async stage=>stages.push(stage)),modelText);assert.equal(calls,1);assert.deepEqual(stages,['model_accepted','model_streaming']);}finally{globalThis.fetch=original;}
});
test('only explicit human revision notes are forwarded; no automatic prose correction',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async(url,options)=>{calls++;const p=JSON.parse(options.body);assert.match(p.messages[1].content,/人工审阅意见：\n不要重复金额明细/);return stream('模型自行修订后的全文');};
  try{assert.equal(await generateMarkdown({KIMI_API_KEY:'fixture'},evidence,'不要重复金额明细'),'模型自行修订后的全文');assert.equal(calls,1);}finally{globalThis.fetch=original;}
});
test('incomplete stream is rejected and a job never persists the partial report',async()=>{
  const original=globalThis.fetch;let writes=0;
  globalThis.fetch=async()=>stream('未完整正文','length');
  const DB={prepare(){return {bind(){return this;},async run(){return {};},async first(){return {status:'running'};}};}};
  const job={runId:'fixture',platform:'app',periodStart:'2026-10-24',periodEnd:'2026-11-06',status:'running',stage:'collect',steps:['pay','chain','renewal','creative','analyze','model','write'].map(key=>({key,label:key,status:'waiting'}))};
  try{await assert.rejects(()=>generateMarkdown({KIMI_API_KEY:'fixture'},evidence),/未完整生成/);await executeReport({DB,KIMI_API_KEY:'fixture'},job,{collect:async()=>({evidence}),persist:async()=>{writes++;}});assert.equal(writes,0);assert.equal(job.status,'failed');}finally{globalThis.fetch=original;}
});
test('data conservation failure blocks the model call; provider errors redact credentials',async()=>{
  const original=globalThis.fetch;let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify({error:{type:'rate_limit_reached_error',message:'key sk-fixturePrivateCredential exceeded TPM'}}),{status:429});};
  try{const invalid=structuredClone(evidence);invalid.checks.push({id:'revenue.total.current',passed:false});await assert.rejects(()=>generateMarkdown({KIMI_API_KEY:'fixture'},invalid),/未守恒/);assert.equal(calls,0);await assert.rejects(()=>generateMarkdown({KIMI_API_KEY:'fixture'},evidence),e=>/429.*TPM/.test(e.message)&&!e.message.includes('sk-fixturePrivateCredential'));}finally{globalThis.fetch=original;}
});

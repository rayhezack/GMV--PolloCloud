// Local real-model acceptance: approved snapshots in, review artifacts out.
// Does not call the live collector, job persistence, or any database API.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import { build } from 'esbuild';
import { buildReportEvidence } from '../worker/report-evidence.ts';
import { reportEvidenceQueries } from '../worker/report-evidence-loader.ts';
import { prepareReportData } from '../worker/report-data.ts';
import { REPORT_SKILL_SHA256 } from '../worker/report-skill.generated.ts';

const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const preflight=args.includes('--preflight');
const revision=option('--revision-notes')?await readFile(option('--revision-notes'),'utf8'):'';
const platforms=option('--platform')?[option('--platform')]:['web','app'];
if(platforms.some(p=>!['web','app'].includes(p)))throw new Error('--platform must be web or app');
const config=option('--config')?parse(await readFile(option('--config'),'utf8')):{};
const env=Object.fromEntries(['KIMI_API_KEY','KIMI_BASE_URL','KIMI_MODEL'].map(k=>[k,process.env[k]||config[k]]));
if(!preflight&&!env.KIMI_API_KEY)throw new Error('缺少本地 KIMI_API_KEY；提供既有配置的 --config 路径或环境变量，不会读取线上密钥。');
const endpoint=new URL(`${(env.KIMI_BASE_URL||'https://api.moonshot.ai/v1').replace(/\/+$/,'')}/chat/completions`);
if(endpoint.username||endpoint.password||endpoint.search)throw new Error('模型地址不能包含凭证或查询参数');
const sourceRoot=option('--source-dir')?pathToFileURL(resolve(option('--source-dir'))+'/'):new URL('../archives/report-pipeline-stage2-2026-11-08/',import.meta.url);
const runId=`${preflight?'preflight':'model'}-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
const outputRoot=new URL(`../archives/report-pipeline-stage4-2026-11-08/${runId}/`,import.meta.url);
await mkdir(outputRoot,{recursive:true});
const save=(file,data)=>writeFile(new URL(file,outputRoot),typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');
const hash=data=>createHash('sha256').update(data).digest('hex');
const bundle=await build({entryPoints:[fileURLToPath(new URL('../worker/report-jobs.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {generateMarkdown}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const actionsText=await readFile(new URL('product-actions.source.json',sourceRoot),'utf8');
const actions=JSON.parse(actionsText);
const run={runId,preflight,skillSha256:REPORT_SKILL_SHA256,generatorSha256:hash(bundle.outputFiles[0].text),endpoint:endpoint.href,configuredModel:env.KIMI_MODEL||'kimi-k3',platforms:[],remoteDataWrites:0,reportPersistenceCalls:0};
await save('run.json',run);
if(revision)await save('revision-notes.txt',revision);
for(const platform of platforms){
  const window={platform,startDate:'2026-10-24',endDate:'2026-11-06'};
  const sources={actions},receipts=[{key:'actions',sha256:hash(actionsText)}];
  for(const q of reportEvidenceQueries(window)){
    const raw=await readFile(new URL(`${platform}-${q.key}.source.json`,sourceRoot),'utf8');
    const payload=JSON.parse(raw);
    if(payload.rowsWritten!==0)throw new Error('来源快照不是只读记录');
    sources[q.key]=payload;
    receipts.push({key:q.key,sha256:hash(raw),readAt:payload.readAt,rows:payload.rows.length});
  }
  const evidence=prepareReportData(buildReportEvidence(window,sources));
  await save(`${platform}-data.json`,evidence);
  await save(`${platform}-sources.json`,receipts);
  const result={platform,window,checks:evidence.checks.length,failedChecks:evidence.checks.filter(c=>!c.passed),attempts:[],status:preflight?'prepared':'running'};
  run.platforms.push(result);
  if(result.failedChecks.length)throw new Error('真实快照复算检查失败');
  if(preflight)continue;
  const originalFetch=globalThis.fetch,pending=[];
  // Capture only request bodies and public output fields; never log headers,
  // authentication, provider reasoning_content, or a full process environment.
  globalThis.fetch=async(url,options)=>{
    if(String(url)!==endpoint.href||options?.method!=='POST')throw new Error('本地验收仅允许既有模型生成接口');
    const attempt=result.attempts.length+1,stem=`${platform}-attempt-${attempt}`,started=Date.now();
    const body=JSON.parse(options.body);
    const item={attempt,requestSha256:hash(options.body),status:'requesting'};
    result.attempts.push(item);
    await save(`${stem}-request.json`,body);
    await save('run.json',run);
    const response=await originalFetch(url,options);
    item.httpStatus=response.status;
    if(!response.ok){const payload=await response.clone().json().catch(()=>({}));item.providerError={type:payload.error?.type,code:payload.error?.code,message:String(payload.error?.message||'').replace(/sk-[A-Za-z0-9_-]+/g,'[已隐藏密钥]').slice(0,300)};item.retryAfter=response.headers.get('retry-after');}
    await save('run.json',run);
    const captured=(async()=>{
      let content='',finish='',model='',usage=null,providerError=null,buffer='',captureError='',lastCheckpoint=Date.now();
      const consume=line=>{
        if(!line.startsWith('data:'))return;
        const data=line.slice(5).trim();if(!data||data==='[DONE]')return;
        try{const chunk=JSON.parse(data);content+=chunk.choices?.[0]?.delta?.content||'';finish=chunk.choices?.[0]?.finish_reason||finish;model=chunk.model||model;usage=chunk.usage||usage;if(chunk.error)providerError={type:chunk.error.type,code:chunk.error.code};}catch{item.invalidStreamJson=true;}
      };
      const reader=response.clone().body?.getReader(),decoder=new TextDecoder();
      try{if(reader)while(true){const {done,value}=await reader.read();item.receivedBytes=(item.receivedBytes||0)+(value?.length||0);buffer+=decoder.decode(value,{stream:!done});const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';lines.forEach(consume);if(Date.now()-lastCheckpoint>30000){lastCheckpoint=Date.now();item.contentCharacters=content.length;item.elapsedMs=Date.now()-started;await save('run.json',run);}if(done){if(buffer)consume(buffer);break;}}}
      catch(error){captureError=error.message;}
      const issues=[...(!content.trim()?['模型未返回正文']:[]),...(finish==='stop'?[]:['流式输出未完整结束'])];
      Object.assign(item,{elapsedMs:Date.now()-started,finish,actualModel:model,usage,status:issues.length?'incomplete':'transport-complete-awaiting-review',validationIssues:issues});
      await save(`${stem}-response.json`,{httpStatus:response.status,content,finish,model,usage,providerError,captureError});
      if(content)await save(`${stem}-model-markdown.md`,content);
      await save(`${stem}-validation.json`,{issues});
    })().catch(async error=>{Object.assign(item,{status:'capture-failed',error:error.message,elapsedMs:Date.now()-started});});
    pending.push(captured);
    return response;
  };
  console.log(`${platform}: real generation started (${runId})`);
  try{
    const markdown=await generateMarkdown(env,evidence,revision);
    await save(`${platform}-模型报告.md`,markdown);
    // Deliver the complete model report; no summary-only derivative.
    Object.assign(result,{status:'generated-awaiting-semantic-review',markdownSha256:hash(markdown),markdownCharacters:markdown.length});
    console.log(`${platform}: generated; manual semantic review still required`);
  }catch(error){result.status='failed';result.error=error.message;console.log(`${platform}: ${error.message}`);}
  finally{globalThis.fetch=originalFetch;await Promise.allSettled(pending);await save('run.json',run);}
}
await save('run.json',run);
console.log(JSON.stringify({outputRoot:fileURLToPath(outputRoot),platforms:run.platforms.map(p=>({platform:p.platform,status:p.status,attempts:p.attempts.length,checks:p.checks}))},null,2));
if(run.platforms.some(p=>p.status==='failed'))process.exitCode=1;

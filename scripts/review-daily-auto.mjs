// Real D1 SELECTs -> local persistent queue -> optional real model. Never writes remote data.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {build} from 'esbuild';
import {parse} from 'dotenv';
const exec=promisify(execFile),args=process.argv.slice(2),opt=k=>args[args.indexOf(k)+1];
const root='archives/daily-auto-2026-11-08';await mkdir(`${root}/sources`,{recursive:true});await mkdir('.local-data',{recursive:true});
const receipts=[];
const save=(name,data)=>writeFile(`${root}/${name}`,typeof data==='string'?data:JSON.stringify(data,null,2));
async function remote(sql,...binds){
 let index=0;sql=sql.replaceAll('?',()=>`'${String(binds[index++]).replaceAll("'","''")}'`);
 if(!/^\s*(SELECT|WITH)\b/i.test(sql)||sql.includes(';'))throw Error('仅允许远程只读查询');
 const hash=createHash('sha256').update(sql).digest('hex'),file=`${root}/sources/${hash}.json`;
 try{const cached=JSON.parse(await readFile(file,'utf8'));receipts.push({...cached.receipt,cached:true});return cached.rows;}catch{}
 console.log('Read',hash.slice(0,10));
 const {stdout}=await exec('pollocloud',['db','execute','--name','pollo-ai','--command',sql,'--json'],{env:{...process.env,NODE_USE_ENV_PROXY:'1'},timeout:120000,maxBuffer:128*1024*1024});
 const data=JSON.parse(stdout.slice(stdout.indexOf('[')));
 if(!data.every(r=>r.success&&r.meta.rows_written===0))throw Error('只读凭据核对失败');
 const rows=data.flatMap(r=>r.results),receipt={hash,readAt:new Date().toISOString(),rows:rows.length,rowsWritten:0};
 await writeFile(file,JSON.stringify({sql,rows,receipt}));receipts.push(receipt);return rows;
}
const local=new DatabaseSync('.local-data/daily-auto-review.sqlite');
local.exec(await readFile('db/0025_daily_diagnoses.sql','utf8'));local.exec('CREATE TABLE IF NOT EXISTS sync_jobs(run_id TEXT,status TEXT)');
const prepare=(sql)=>{const isLocal=/\bdaily_diagnosis_|\bsync_jobs\b/.test(sql);const bound=(binds=[])=>({bind:(...b)=>bound(b),all:async()=>({results:isLocal?local.prepare(sql).all(...binds):await remote(sql,...binds)}),first:async()=>isLocal?local.prepare(sql).get(...binds)||null:(await remote(sql,...binds))[0]||null,run:async()=>{if(!isLocal)throw Error('远程写入禁止');return local.prepare(sql).run(...binds);}});return bound();};
const config=args.includes('--config')?parse(await readFile(opt('--config'),'utf8')):{};
const storagePath=key=>`.local-data/daily-review-files/${key}`;
const STORAGE={
 put:async(key,value)=>{const path=storagePath(key);await mkdir(path.slice(0,path.lastIndexOf('/')),{recursive:true});await writeFile(path,value);},
 getText:async key=>readFile(storagePath(key),'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;}),
};
const env={DB:{prepare},STORAGE,...config};
const bundle=async file=>{const b=await build({entryPoints:[file],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});return import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);};
try{
 const {gmvAnomalies}=await bundle('worker/index.ts');
 const {tickDailyDiagnoses,getDailyDiagnosis,markDailyDiagnosisDirty,regenerateDailyDiagnosis}=await bundle('worker/daily-diagnosis-jobs.ts');
 const revision=args.includes('--review-notes')?await readFile(opt('--review-notes'),'utf8'):'';
 const {generateMarkdown}=revision?await bundle('worker/report-jobs.ts'):{};
 const detection=await(await gmvAnomalies(env,'2026-11-08')).json();await save('detected.json',detection);console.log('Detected',detection.latestDay,JSON.stringify(detection.alerts.map(a=>({platform:a.platform,window:a.window,change:a.change,baseline:a.baselinePeriod}))));
 if(detection.latestDay!=='2026-11-08')throw Error('最新完整日不是11/08，不能冒充本日验收');
 await markDailyDiagnosisDirty(env);
 // If generation is not requested, capture prepared input but force explicit configuration failure (no invented report).
 if(args.includes('--retry'))for(const p of ['all','web','app']){const state=await getDailyDiagnosis(env,p,'2026-11-08');if(state.status==='failed')await regenerateDailyDiagnosis(env,p,'2026-11-08');}
 const dependencies={detect:async()=>detection,...(revision?{generate:e=>generateMarkdown(env,e,revision)}:{})};
 for(let i=0;i<3;i++)console.log('Tick',await tickDailyDiagnoses(env,dependencies));
 for(const platform of ['all','web','app']){
  const state=await getDailyDiagnosis(env,platform,'2026-11-08');await save(`${platform}-status.json`,state);
  if(state.report)await save(`${platform}-模型完整诊断.md`,state.report.markdown);
 }
 const jobs=local.prepare('SELECT platform,period,baseline,input_hash,status,evidence,error FROM daily_diagnosis_jobs ORDER BY created_at').all();
 for(const j of jobs){const raw=j.evidence.startsWith('daily-storage:')?await STORAGE.getText(j.evidence.slice('daily-storage:'.length)):j.evidence;await save(`${j.platform}-evidence.json`,JSON.parse(raw));console.log('Job',j.platform,j.status,j.error||'');}
 await save('read-receipts.json',{receipts,remoteRowsWritten:0,reviewDate:'2026-11-08',generatedAt:new Date().toISOString()});
}catch(error){console.error(String(error.message).replace(/sk-[\w-]+/g,'[已隐藏密钥]'));process.exitCode=1;}finally{local.close();}

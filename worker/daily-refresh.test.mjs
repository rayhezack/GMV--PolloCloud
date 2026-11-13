import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceDailyRefresh, RefreshPausedError} from './daily-refresh.ts';
import {readFile} from 'node:fs/promises';
test('only one daily start at 09:20; five minute callback belongs to reports',async()=>{
 const config=JSON.parse(await readFile('pollocloud.json','utf8'));
 assert.deepEqual(config.cron,[{schedule:'20 9 * * *',path:'/api/cron/daily-data'},{schedule:'*/5 * * * *',path:'/api/cron/reports'}]);
});
test('bounded continuation resumes the cursor without repeating a completed source',async()=>{
 const b={day:'2026-11-11',tasks:['facts','ads','creation'],cursor:0,status:'running'};let calls=[];let ready=false;
 const exec=async t=>{calls.push(t);return t!=='facts'||ready};const save=async()=>{};
 await advanceDailyRefresh(b,exec,save);assert.equal(b.cursor,0);ready=true;
 await advanceDailyRefresh(b,exec,save);assert.equal(b.status,'success');assert.deepEqual(calls,['facts','facts','ads','creation']);
 await advanceDailyRefresh(b,exec,save);assert.equal(calls.length,4);
});
test('one failed source does not block siblings, is durable, and explicit retry skips successes',async()=>{
 const b={day:'2026-11-11',tasks:['facts','ads','creation'],cursor:0,status:'running'};const calls=[];
 const exec=async t=>{calls.push(t);if(t==='facts')throw Error('empty source');return true};
 await advanceDailyRefresh(b,exec,async()=>{});
 assert.equal(b.status,'failed');assert.equal(b.cursor,3);assert.deepEqual(calls,['facts','ads','creation']);
 assert.deepEqual(b.completed,['ads','creation']);assert.equal(b.errors.facts,'empty source');
 await advanceDailyRefresh(b,exec,async()=>{});assert.equal(calls.length,3);
 b.status='running';b.cursor=0;
 await advanceDailyRefresh(b,async t=>{calls.push(t);return true},async()=>{});
 assert.equal(b.status,'success');assert.deepEqual(calls,['facts','ads','creation','facts']);assert.equal(b.error,undefined);
});
test('explicit pause stops the whole batch without starting siblings',async()=>{
 const b={day:'2026-11-11',tasks:['facts','ads'],cursor:0,status:'running'};const calls=[];
 await advanceDailyRefresh(b,async t=>{calls.push(t);throw new RefreshPausedError('paused')},async()=>{});
 assert.equal(b.status,'failed');assert.equal(b.cursor,0);assert.deepEqual(calls,['facts']);
});

// Exercise the real Worker orchestration against SQLite, including the same JSON
// cursor and atomic lease SQL used by D1. No source or model request is permitted.
const {DatabaseSync}=await import('node:sqlite');
const {build}=await import('esbuild');
const bundled=await build({entryPoints:['worker/index.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {dailyDataRefresh}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
function store(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE daily_refresh_batches(day TEXT PRIMARY KEY,payload TEXT NOT NULL,updated_at INTEGER NOT NULL,lease_until INTEGER NOT NULL DEFAULT 0)');
 const prepare=sql=>{const statement=db.prepare(sql);const bound=(values=[])=>({bind:(...v)=>bound(v),first:async()=>statement.get(...values)||null,run:async()=>statement.run(...values)});return bound();};
 return {db,env:{DB:{prepare}}};
}
const today=()=>new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const insert=(db,b,lease=0)=>db.prepare('INSERT INTO daily_refresh_batches VALUES(?,?,?,?)').run(b.day,JSON.stringify(b),Date.now(),lease);
test('report-only callbacks do not create a source batch, even after a failure',async()=>{
 const {db,env}=store();assert.equal(await dailyDataRefresh(env),undefined);
 const b={day:today(),tasks:['facts:pay_type'],cursor:0,status:'failed',error:'not ready'};insert(db,b);
 assert.deepEqual(await dailyDataRefresh(env),b);assert.equal(db.prepare('SELECT count(*) n FROM daily_refresh_batches').get().n,1);
});
test('09:20 start is idempotent; manual retry preserves cursor instead of repeating successful sources',async()=>{
 const {db,env}=store(),b={day:today(),tasks:['actions','facts:pay_type'],cursor:1,status:'failed',error:'not ready'};
 insert(db,b,Date.now()+900000);
 assert.equal((await dailyDataRefresh(env,true)).status,'failed');
 const retry=await dailyDataRefresh(env,true,true);assert.equal(retry.status,'running');assert.equal(retry.cursor,1);assert.equal(retry.error,undefined);
 await dailyDataRefresh(env,true);assert.equal(db.prepare('SELECT count(*) n FROM daily_refresh_batches').get().n,1);
});
test('a locked previous-day batch cannot swallow the next daily start or let reports run early',async()=>{
 const {db,env}=store(),prior=new Date(Date.parse(today())-86400000).toISOString().slice(0,10);
 const b={day:prior,tasks:['facts:pay_type'],cursor:0,status:'running'};insert(db,b,Date.now()+900000);
 const returned=await dailyDataRefresh(env,true);assert.equal(returned.status,'running');
 const newBatch=JSON.parse(db.prepare('SELECT payload FROM daily_refresh_batches WHERE day=?').get(today()).payload);
 assert.equal(newBatch.day,today());assert.equal(newBatch.cursor,0);assert.equal(newBatch.tasks.length,21);
 assert.deepEqual(newBatch.tasks.slice(0,5),['facts:renewal,ads,creation_chain','actions','facts:pay_type','facts:chain','facts:creative']);
 assert.equal(db.prepare('SELECT count(*) n FROM daily_refresh_batches').get().n,2);
});

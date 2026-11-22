import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
const b=await build({entryPoints:['worker/source-refresh-policy.ts'],bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {claimSourceRefresh:claim,finishSourceRefresh:finish}=await import(`data:text/javascript;base64,${Buffer.from(b.outputFiles[0].text).toString('base64')}`);
const sql=await readFile('db/0028_source_refresh_state.sql','utf8');
function setup(){
 const db=new DatabaseSync(':memory:');db.exec(sql);
 const prepare=sql=>{let values=[];return {bind(...args){values=args;return this;},async first(){return db.prepare(sql).get(...values);},async run(){return db.prepare(sql).run(...values);}};};
 return {DB:{prepare}};
}
test('successful statistical dates refresh at most once per Shanghai day, across repeated cron invocations',async()=>{
 const env=setup(),start=Date.parse('2026-11-10T01:00:00Z');
 const claims=await Promise.all([claim(env,'creation','2026-11-09',start),claim(env,'creation','2026-11-09',start)]);
 assert.equal(claims.filter(x=>x!==null).length,1);
 await finish(env,'creation','2026-11-09',start,true);
 for(let offset=300000;offset<3600000*14;offset+=300000)assert.equal(await claim(env,'creation','2026-11-09',start+offset),null);
 assert.notEqual(await claim(env,'creation','2026-11-09',start+86400000),null);
 assert.notEqual(await claim(env,'ads','2026-11-09',start),null,'sources are independent');
});
test('missing/failed sources retry hourly, lost executions recover, old attempts cannot overwrite new state',async()=>{
 const env=setup(),start=Date.parse('2026-11-10T01:00:00Z');
 await claim(env,'creation','2026-11-09',start);await finish(env,'creation','2026-11-09',start,false);
 assert.equal(await claim(env,'creation','2026-11-09',start+300000),null);
 const retry=await claim(env,'creation','2026-11-09',start+3600000);assert.ok(retry);
 await finish(env,'creation','2026-11-09',start,true);
 assert.ok(await claim(env,'creation','2026-11-09',start+7200000),'abandoned attempt is retried after one hour');
});

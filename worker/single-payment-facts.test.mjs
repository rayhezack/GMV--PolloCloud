import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const sql=name=>readFileSync(new URL(`../db/${name}`,import.meta.url),'utf8');
test('single-copy payment view preserves all scopes, unknown devices and non-additive UV datasets',()=>{
 const db=new DatabaseSync(':memory:');
 try {
  for(const file of ['0009_pollo_da_analytics.sql','0010_pay_type_subscription_tier.sql','0011_middle_table_dimensions.sql','0018_payment_product_dimensions.sql'])db.exec(sql(file));
  const insert=db.prepare("INSERT INTO pollo_da_fact_rows(dataset,source_record_id,period,platform,device_type,gmv_usd,model_cost_usd,order_equivalent,active_uv,fields_json,updated_at) VALUES(?,?,'2026-10-20',?,?,?,?,?,?, '{}',0)");
  for(const [device,scope,gmv,cost,orders] of [['web','web',120,12,3],['ios','app',50,5,2],['android','app',30,3,1],['unknown',null,7,1,.5]]) {
   insert.run('pay_type',device+'all','all',device,gmv,cost,orders,null);
   if(scope)insert.run('pay_type',device+scope,scope,device,gmv,cost,orders,null);
  }
  insert.run('creative','all','all',null,null,null,null,90);
  insert.run('creative','web','web',null,null,null,null,60);
  insert.run('creative','app','app',null,null,null,null,50);
  const totals=table=>db.prepare(`SELECT dataset,platform,COUNT(*) n,SUM(gmv_usd) gmv,SUM(model_cost_usd) cost,SUM(order_equivalent) orders,SUM(active_uv) uv FROM ${table} GROUP BY dataset,platform ORDER BY dataset,platform`).all();
  const before=totals('pollo_da_fact_rows');
  db.exec(sql('0022_single_payment_facts.sql'));
  assert.deepEqual(totals('pollo_da_fact_rows_read'),before);
  db.exec("DELETE FROM pollo_da_fact_rows WHERE dataset='pay_type' AND platform IN ('web','app')");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM pollo_da_fact_rows WHERE dataset='pay_type'").get().n,4);
  assert.deepEqual(totals('pollo_da_fact_rows_read'),before);
  assert.equal(db.prepare("SELECT active_uv FROM pollo_da_fact_rows_read WHERE dataset='creative' AND platform='all'").get().active_uv,90);
  db.exec(sql('0023_payment_single_scope_guard.sql'));
  assert.throws(()=>insert.run('pay_type','duplicate','web','web',120,12,3,null),/canonical all scope/);
  assert.throws(()=>db.exec("UPDATE pollo_da_fact_rows SET platform='app' WHERE dataset='pay_type' AND device_type='ios'"),/canonical all scope/);
  assert.doesNotThrow(()=>db.exec("UPDATE pollo_da_fact_rows SET gmv_usd=125 WHERE dataset='pay_type' AND device_type='web'"));
  assert.equal(db.prepare("SELECT gmv_usd FROM pollo_da_fact_rows_read WHERE dataset='pay_type' AND platform='web'").get().gmv_usd,125);
 } finally {db.close();}
});

test('payment sync deduplicates scopes and refreshes one canonical copy idempotently with registration conservation',async()=>{
 const { buildSync }=await import('esbuild');
 const { mkdtempSync,rmSync }=await import('node:fs');
 const { tmpdir }=await import('node:os');
 const { join }=await import('node:path');
 const { fileURLToPath,pathToFileURL }=await import('node:url');
 const dir=mkdtempSync(join(tmpdir(),'single-payment-sync-')),db=new DatabaseSync(':memory:');
 try {
  const outfile=join(dir,'worker.mjs');
  buildSync({stdin:{contents:readFileSync(new URL('./index.ts',import.meta.url),'utf8')+'\nexport {newSyncJob,replacePaymentRange};',resolveDir:fileURLToPath(new URL('.',import.meta.url)),loader:'ts'},bundle:true,platform:'node',format:'esm',outfile,logLevel:'silent'});
  const {newSyncJob,replacePaymentRange}=await import(pathToFileURL(outfile).href);
  for(const platforms of [['all','web','app'],['web'],['app']]) {
   const job=newSyncJob('backfill','2026-10-20','2026-10-20',platforms,['pay_type','creative']);
   assert.deepEqual(job.steps.filter(s=>s.key.endsWith('-pay_type')).map(s=>s.key),['all-pay_type']);
   assert.equal(job.steps.filter(s=>s.key.endsWith('-creative')).length,platforms.length);
  }
  for(const file of ['0009_pollo_da_analytics.sql','0010_pay_type_subscription_tier.sql','0011_middle_table_dimensions.sql','0018_payment_product_dimensions.sql','0015_payment_registration.sql','0017_payment_sync_stage.sql','0022_single_payment_facts.sql','0023_payment_single_scope_guard.sql'])db.exec(sql(file));
  const adapter={prepare(statement){return {bind(...args){return {execute(){db.prepare(statement).run(...args);}};}};},async batch(statements){db.exec('BEGIN');try{for(const s of statements)s.execute();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}};
  const records=[];
  for(const [device,platform,gmv] of [['web','web',100],['ios','app',40],['unknown','unknown',3]]) {
   for(const attribution_type of ['NONE','CREATION_MODE','MODEL','ACTUAL_MODEL'])records.push({period:'2026-10-20',week_start:'2026-10-17',platform:'all',device_type:device,pay_type:'首订',pay_category:'ACTIVE_PAYMENT',attribution_type,gmv_usd:gmv});
   records.push({source_kind:'registration',period:'2026-10-20',week_start:'2026-10-17',platform,device_type:device,pay_type:'首订',user_lifecycle:'OLD',country_tier:'T1',reg_platform:'WEB',sku:'UNKNOWN',plan_tier:'UNKNOWN',plan_cycle:'UNKNOWN',credit_amount:'UNKNOWN',previous_sku:'UNKNOWN',previous_plan_tier:'UNKNOWN',previous_plan_cycle:'UNKNOWN',previous_credit_amount:'UNKNOWN',gmv_usd:gmv});
  }
  for(let attempt=0;attempt<2;attempt++)await replacePaymentRange({DB:adapter},'web','2026-10-20','2026-10-20',records);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pollo_da_fact_rows').get().n,12);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM pollo_da_payment_registration').get().n,3);
  assert.deepEqual(db.prepare("SELECT platform,SUM(gmv_usd) gmv FROM pollo_da_fact_rows_read WHERE attribution_type='NONE' GROUP BY platform ORDER BY platform").all().map(r=>[r.platform,r.gmv]),[['all',143],['app',40],['web',100]]);
  const invalid=records.map(r=>r.source_kind==='registration'?{...r,gmv_usd:0}:r);
  await assert.rejects(()=>replacePaymentRange({DB:adapter},'all','2026-10-20','2026-10-20',invalid),/未对齐/);
  assert.equal(db.prepare("SELECT SUM(gmv_usd) n FROM pollo_da_fact_rows WHERE attribution_type='NONE'").get().n,143);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

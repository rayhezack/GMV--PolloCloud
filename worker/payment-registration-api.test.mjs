import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const sql=name=>readFileSync(new URL(`../db/${name}`,import.meta.url),'utf8');
test('registration migration keeps existing money and permits SKU/platform splits at the former primary key',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(`CREATE TABLE pollo_da_payment_registration(period TEXT,week_start TEXT,platform TEXT,device_type TEXT,pay_type TEXT,user_lifecycle TEXT,reg_country TEXT,gmv_usd REAL,PRIMARY KEY(period,platform,device_type,pay_type,user_lifecycle,reg_country));
   INSERT INTO pollo_da_payment_registration VALUES('2026-10-20','2026-10-17','web','web','自动续订','OLD','US',120);`);
  db.exec(sql('0020_payment_registration_platform.sql'));
  assert.equal(db.prepare('SELECT SUM(gmv_usd) AS n FROM pollo_da_payment_registration').get().n,120);
  const row=db.prepare('SELECT * FROM pollo_da_payment_registration').get();
  assert.equal(row.reg_platform,'UNKNOWN');assert.equal(row.sku,'UNKNOWN');
  db.prepare('INSERT INTO pollo_da_payment_registration(period,week_start,platform,device_type,pay_type,user_lifecycle,reg_country,gmv_usd,reg_platform,sku) VALUES(?,?,?,?,?,?,?,?,?,?)').run('2026-10-20','2026-10-17','web','web','自动续订','OLD','US',30,'IOS','Pro_月订_800');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM pollo_da_payment_registration').get().n,2);
  db.exec(sql('0021_payment_registration_country_tier.sql'));
  assert.equal(db.prepare('SELECT SUM(gmv_usd) AS n FROM pollo_da_payment_registration').get().n,150);
  db.exec('ALTER TABLE pollo_da_payment_registration DROP COLUMN reg_country');
  assert.deepEqual(db.prepare('SELECT DISTINCT country_tier FROM pollo_da_payment_registration').all().map(r=>r.country_tier),['T2']);
  assert.ok(db.prepare('PRAGMA table_info(pollo_da_payment_registration_stage)').all().some(c=>c.name==='previous_sku'));
 }finally{db.close();}
});

test('registration trend API conserves matched payments, isolates payment platforms and leaves missing/mismatched dates empty',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'registration-api-')),db=new DatabaseSync(':memory:');
 try{
  for(const file of ['0009_pollo_da_analytics.sql','0011_middle_table_dimensions.sql','0015_payment_registration.sql'])db.exec(sql(file));
  const parent=db.prepare("INSERT INTO pollo_da_fact_rows(dataset,source_record_id,period,week_start,platform,device_type,dataset_kind,attribution_type,pay_category,pay_type,gmv_usd,fields_json,updated_at) VALUES('pay_type',?,?, '2026-10-17',?,'web','daily','NONE','ACTIVE_PAYMENT',?,?, '{}',0)");
  for(const scope of ['all','web']){parent.run(scope+'20','2026-10-20',scope,'首订',100);parent.run(scope+'21','2026-10-21',scope,'首订',110);parent.run(scope+'22','2026-10-22',scope,'积分包',20);}
  const insert=db.prepare("INSERT INTO pollo_da_payment_registration(period,week_start,platform,device_type,pay_type,user_lifecycle,country_tier,reg_platform,sku,gmv_usd) VALUES(?,'2026-10-17',?,'web','首订','OLD','T1',?,'Pro_月订_800',?)");
  insert.run('2026-10-20','web','WEB',60);insert.run('2026-10-20','web','IOS',40);
  insert.run('2026-10-21','web','WEB',99);insert.run('2026-10-20','app','ANDROID',900);
  const adapter={prepare(statement){let args=[];return {bind(...a){args=a;return this;},async run(){db.prepare(statement).run(...args);return {success:true};},async all(){return {results:db.prepare(statement).all(...args)};},async first(){return db.prepare(statement).get(...args)??null;}};}};
  const bundle=join(directory,'worker.mjs');buildSync({entryPoints:[fileURLToPath(new URL('./index.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:bundle,logLevel:'silent'});
  const {default:worker}=await import(pathToFileURL(bundle).href);
  const response=await worker.fetch(new Request('https://example.com/api/dashboard/payment-registration-trend?platform=web&startDate=2026-10-20&endDate=2026-10-23&payType='+encodeURIComponent('首订')),{DB:adapter},{waitUntil(){}});
  assert.equal(response.status,200);const result=await response.json();
  assert.deepEqual(result.points,[{period:'2026-10-20',total:100,verified:true},{period:'2026-10-21',total:110,verified:false},{period:'2026-10-22',total:0,verified:true},{period:'2026-10-23',total:null,verified:false}]);
  assert.equal(result.rows.length,2);assert.equal(result.rows.reduce((a,b)=>a+b.gmvUsd,0),100);
  assert.deepEqual(result.rows.map(r=>r.regPlatform).sort(),['IOS','WEB']);assert.ok(result.rows.every(r=>r.sku==='Pro_月订_800'));
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});


test('year payment trend reads January through the analysis window and uses actual monthly day denominators',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'payment-year-')),db=new DatabaseSync(':memory:');
 try{
  for(const file of ['0009_pollo_da_analytics.sql','0011_middle_table_dimensions.sql'])db.exec(sql(file));
  db.exec('ALTER TABLE pollo_da_fact_rows ADD COLUMN subscription_tier TEXT');
  const insert=db.prepare("INSERT INTO pollo_da_fact_rows(dataset,source_record_id,period,week_start,platform,device_type,dataset_kind,attribution_type,pay_category,pay_type,gmv_usd,fields_json,updated_at) VALUES('pay_type',?,?,?,'web','web','daily','NONE','AUTO_RENEWAL','自动续订',?,'{}',0)");
  for(const [date,value] of [['2025-12-31',900],['2026-01-01',10],['2026-01-02',30],['2026-02-01',90],['2026-02-02',110],['2026-02-03',900]])insert.run(date,date,date,value);
  const adapter={prepare(statement){let args=[];return {bind(...a){args=a;return this;},async run(){db.prepare(statement).run(...args);return {success:true};},async all(){return {results:db.prepare(statement).all(...args)};},async first(){return db.prepare(statement).get(...args)??null;}};}};
  const bundle=join(directory,'worker.mjs');buildSync({entryPoints:[fileURLToPath(new URL('./index.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',outfile:bundle,logLevel:'silent'});
  const {default:worker}=await import(pathToFileURL(bundle).href);
  const request=new Request('https://example.com/api/dashboard/payment-trend?platform=web&analysisPeriod=2026-01-27&granularity=year&income=ALL');
  const response=await worker.fetch(request,{DB:adapter},{waitUntil(){}});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
  assert.equal(result.startDate,'2026-01-01');assert.equal(result.endDate,'2026-02-02');
  assert.deepEqual(result.points.map(p=>[p.period,p.days,p.gmvUsd]),[['2026-01-01',2,40],['2026-02-01',2,200]]);
  assert.deepEqual(result.series[0].points.map((p,i)=>p.gmvUsd/result.points[i].days),[20,100]);
 }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});

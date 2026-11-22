import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

test('actual Worker collector executes its SQL against SQLite and reads the published action snapshot, without a model call or database writes', async () => {
  const bundle=await build({entryPoints:['worker/index.ts'],bundle:true,platform:'node',format:'esm',write:false});
  const {collectReportEvidence}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE pollo_da_fact_rows(period TEXT,week_start TEXT,platform TEXT,platform_type TEXT,dataset TEXT,dataset_kind TEXT,attribution_type TEXT,pay_category TEXT,pay_type TEXT,gmv_usd REAL,expire_user_cnt REAL,renew_user_cnt REAL,renew_amount_usd REAL);
    CREATE TABLE pollo_da_chain_funnel(period TEXT,week_start TEXT,platform TEXT,device_type TEXT,country_tier TEXT,user_lifecycle TEXT,creation_cnt_30d_label TEXT,active_uv REAL,paywall_expose_uv REAL,paywall_submit_uv REAL,pay_uv REAL,gmv_usd REAL);
    CREATE TABLE pollo_da_chain_breakdown(period TEXT,week_start TEXT,platform TEXT,country_tier TEXT,user_lifecycle TEXT,breakdown_type TEXT,breakdown_value TEXT,expose_uv REAL,submit_uv REAL,pay_uv REAL,gmv_usd REAL);
    CREATE TABLE pollo_da_ads_daily(period TEXT,week_start TEXT,platform TEXT,country TEXT,channel TEXT,cost_usd REAL,impressions REAL,clicks REAL,register_user_cnt REAL);
    CREATE TABLE pollo_da_creation_overall_daily(period TEXT,week_start TEXT,platform_type TEXT,creation_task_cnt REAL,valid_creation_task_cnt REAL,creation_user_cnt REAL,success_task_cnt REAL,success_output_cnt REAL,adopted_task_cnt REAL,adopted_output_cnt REAL,d3_creation_user_cnt REAL,d7_creation_user_cnt REAL,d30_creation_user_cnt REAL);
    CREATE TABLE product_action_sync_state(id INTEGER,active_snapshot TEXT,synced_at INTEGER,last_error TEXT);
    CREATE TABLE pollo_da_product_action_details(snapshot_id TEXT,source_record_id TEXT,fields_json TEXT);
    CREATE TABLE pollo_da_creation_function_daily AS SELECT *, 'functionA' AS creation_mode FROM pollo_da_creation_overall_daily WHERE 0;
  `);
  const insert=(table,values)=>db.prepare(`INSERT INTO ${table} VALUES(${values.map(()=>'?').join(',')})`).run(...values);
  for(let i=0;i<14;i++){
    const day=new Date(Date.parse('2026-10-24')+i*86400000).toISOString().slice(0,10), week=i<7?'2026-10-24':'2026-10-31',gmv=i<7?100:120;
    insert('pollo_da_fact_rows',[day,week,'web','WEB','pay_type','daily','NONE','ACTIVE_PAYMENT','首订',gmv,null,null,null]);
    insert('pollo_da_fact_rows',[day,week,'web','WEB','pay_type','daily','NONE','AUTO_RENEWAL','自动续订',20,null,null,null]);
    insert('pollo_da_fact_rows',[day,week,'web','WEB','pay_type','daily','NONE','API','API',5,null,null,null]);
    insert('pollo_da_fact_rows',[day,week,'web','WEB','renewal','daily',null,null,null,null,100,20,20]);
    insert('pollo_da_chain_funnel',[day,week,'web','web','T1','NEW','create_cnt_30d_0',100,50,20,10,gmv]);
    for(const [kind,value] of [['EXPOSE_TYPE','active'],['EXPOSE_REASON','product_design'],['SUBMIT_CHANNEL','stripe']])insert('pollo_da_chain_breakdown',[day,week,'web','T1','NEW',kind,value,50,20,10,gmv]);
    insert('pollo_da_ads_daily',[day,week,'WEB','US','test',10,1000,100,10]);
    const creation=[day,week,'WEB',10,8,5,6,6,2,2,3,null,null];
    insert('pollo_da_creation_overall_daily',creation);insert('pollo_da_creation_function_daily',[...creation,'functionA']);
  }
  db.exec(`ALTER TABLE pollo_da_fact_rows ADD COLUMN product_type TEXT; ALTER TABLE pollo_da_fact_rows ADD COLUMN plan_tier TEXT; ALTER TABLE pollo_da_fact_rows ADD COLUMN plan_cycle TEXT; UPDATE pollo_da_fact_rows SET product_type='Pro' WHERE pay_category='AUTO_RENEWAL'; UPDATE pollo_da_fact_rows SET plan_tier='PRO',plan_cycle='MONTHLY' WHERE dataset='renewal';`);
  db.exec(`INSERT INTO pollo_da_fact_rows(period,week_start,platform,platform_type,dataset,dataset_kind,attribution_type,pay_category,pay_type,gmv_usd,product_type) SELECT period,week_start,platform,platform_type,dataset,dataset_kind,attribution_type,pay_category,pay_type,10,'Lite' FROM pollo_da_fact_rows WHERE pay_category='AUTO_RENEWAL'; INSERT INTO pollo_da_fact_rows(period,week_start,platform,platform_type,dataset,dataset_kind,expire_user_cnt,renew_user_cnt,renew_amount_usd,plan_tier,plan_cycle) SELECT period,week_start,platform,platform_type,dataset,dataset_kind,50,10,10,'LITE','MONTHLY' FROM pollo_da_fact_rows WHERE dataset='renewal';`);
  // This fixture already stores canonical per-platform rows; expose the same read interface as production.
  db.exec('CREATE VIEW pollo_da_fact_rows_read AS SELECT * FROM pollo_da_fact_rows');
  const sql=[];const calls=[];const originalFetch=globalThis.fetch;
  insert('product_action_sync_state',[1,'fixture',Date.parse('2026-11-07T00:00:00Z'),null]);
  for(const [id,platform] of [['fixture-web','web'],['fixture-unknown',null]]){
    insert('pollo_da_product_action_details',['fixture',id,JSON.stringify({'上线时间':Date.parse('2026-11-01T12:00:00+08:00'),'类型':'配置变更','端':platform,'更新点':'测试动作'})]);
  }
  globalThis.fetch=async(url)=>{calls.push(String(url));throw new Error('collector must use the existing D1 snapshot');};
  const DB={prepare(statement){
    assert.match(statement.trim(),/^SELECT\b/i,'collection must never write');sql.push(statement);
    let binds=[];return {bind(...values){binds=values;return this;},async all(){return {results:db.prepare(statement).all(...binds)}}};
  }};
  try{
    const context=await collectReportEvidence({DB,FEISHU_APP_ID:'fixture',FEISHU_APP_SECRET:'fixture'}, {platform:'web',granularity:'week',startDate:'2026-10-24',endDate:'2026-11-06'},async()=>{});
    assert.equal(context.evidence.schemaVersion,2);assert.equal(context.evidence.revenue.total.current,155);
    assert.equal(context.evidence.revenue.items.find(r=>r.key==='API').current,5);
    assert.equal(context.evidence.productActions.complete,true);assert.equal(calls.length,0);
    assert.equal(context.evidence.productActions.eligible.length,1);assert.match(context.evidence.productActions.excluded[0].reason,/端未知/);
    assert.ok(sql.some(s=>s.includes('product_action_sync_state')));assert.equal(sql.filter(s=>/pollo_da_ads_daily/.test(s)).length,1);
    assert.equal(context.evidence.checks.filter(c=>!c.passed).length,0);
    assert.equal(context.evidence.compatibilityTables,undefined);
    assert.equal(context.tables,undefined);
    assert.ok(context.evidence.activeChain.lifecycle.some(r=>r.key==='NEW'));
    assert.ok(context.evidence.activeChain.lifecycle[0].lmdi.factors.some(r=>r.key==='chainPaySuccessRate'));
    assert.equal(sql.filter(s=>/creation_cnt_30d_label/.test(s)).length,0);
    assert.ok(context.evidence.renewal.lmdi.factors.some(r=>r.id==='renewal.expiry'));
    assert.equal(context.evidence.revenue.renewalTypes.length,2);
    assert.equal(context.evidence.revenue.renewalTypes.find(t=>t.key==='Pro').current,20);
    assert.equal(context.evidence.revenue.renewalTypes.find(t=>t.key==='Lite').current,10);
    assert.equal(context.evidence.renewal.productTypes.length,2);
    const pro=context.evidence.renewal.productTypes.find(t=>t.key==='Pro');
    assert.deepEqual(pro.sourceLabels,['PRO']);assert.deepEqual(pro.cycles,['MONTHLY']);
    assert.equal(pro.raw.current.expire,700);
    assert.equal(context.evidence.renewal.productTypes.find(t=>t.key==='Lite').raw.current.expire,350);
  }finally{globalThis.fetch=originalFetch;db.close();}
});

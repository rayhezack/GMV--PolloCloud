import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportEvidence, normalizeProductAction, selectProductActions, actionDate, metric } from './report-evidence.ts';
import { loadReportSources, reportEvidenceQueries } from './report-evidence-loader.ts';

const window = { platform: 'web', startDate: '2026-10-24', endDate: '2026-11-06' };
const source = rows => ({ source: 'test facts', status: 'ok', readAt: '2026-11-08T04:00:00Z', complete: true, rows });
function fixture() {
  const rows = { pay: [], funnel: [], breakdown: [], renewal: [], ads: [], creation: [], functions: [], actions: [] };
  for (let i=0; i<14; i++) {
    const period = new Date(Date.parse('2026-10-24')+i*86400000).toISOString().slice(0,10);
    const common = { period, week_start: i<7 ? '2026-10-24' : '2026-10-31', platform: 'web' };
    for (const [life,country] of [['NEW','T1'],['OLD','T3']]) {
      const f = { ...common, user_lifecycle: life, country_tier: country, active_uv: 100, expose_uv: 50, submit_uv: 20, pay_uv: i<7 ? 10 : 12, gmv_usd: i<7 ? 200 : 240 };
      rows.funnel.push(f);
      for (const [type,value] of [['SUBMIT_CHANNEL','stripe'],['EXPOSE_TYPE','active'],['EXPOSE_REASON','insufficient_credits']]) rows.breakdown.push({ ...f, breakdown_type:type, breakdown_value:value });
    }
    rows.pay.push({ ...common, pay_category:'ACTIVE_PAYMENT',pay_type:'首订',gmv_usd:i<7?420:500 },{ ...common,pay_category:'AUTO_RENEWAL',pay_type:'自动续订',gmv_usd:i<7?100:120 },{ ...common,pay_category:'API',pay_type:'API',gmv_usd:i<7?10:30 });
    rows.renewal.push({ ...common,platform_type:'WEB',expire_user_cnt:100,renew_user_cnt:i<7?50:40,renew_amount_usd:i<7?100:80 });
    rows.ads.push({ ...common,country:i<7?'UK':'GB',channel:'test',cost_usd:20,impressions:1000,clicks:100,register_user_cnt:20 },{ ...common,country:'ZZ',channel:'test',cost_usd:5,impressions:100,clicks:10,register_user_cnt:1 });
    const c = { ...common,platform_type:'WEB',creation_task_cnt:10,valid_creation_task_cnt:8,creation_user_cnt:5,success_task_cnt:6,success_output_cnt:8,adopted_task_cnt:2,adopted_output_cnt:4,d3_creation_user_cnt:3,d7_creation_user_cnt:i<7?2:null,d30_creation_user_cnt:null };
    rows.creation.push(c);
    rows.functions.push({ ...c,creation_mode:'functionA',creation_task_cnt:5,valid_creation_task_cnt:4,success_task_cnt:3,success_output_cnt:4,adopted_task_cnt:1,adopted_output_cnt:2 },{ ...c,creation_mode:'functionB',creation_task_cnt:5,valid_creation_task_cnt:4,success_task_cnt:3,success_output_cnt:4,adopted_task_cnt:1,adopted_output_cnt:2 });
  }
  return Object.fromEntries(Object.entries(rows).map(([key,rows])=>[key,source(rows)]));
}

test('total includes API independently; coverage gap is preserved even above 3%; renewal scopes remain separate', () => {
  const e=buildReportEvidence(window,fixture());
  assert.equal(e.revenue.total.baseline,530);assert.equal(e.revenue.total.current,650);
  assert.deepEqual(e.revenue.items.map(i=>i.current),[500,120,30]);
  assert.equal(e.activeChain.total.gmv.current,480);
  assert.equal(e.activeChain.coverage.gap.current,20);assert.equal(e.activeChain.coverage.threePercentIsBlockingThreshold,false);
  assert.ok(e.activeChain.coverage.gapRate.current>.03);
  assert.ok(e.revenue.items[1].delta>0);assert.ok(e.renewal.gmv.delta<0);
  assert.equal(e.checks.filter(c=>!c.passed).length,0);
});

test('new/old LMDI conserve independently; absent unknown users do not acquire invented rates', () => {
  const e=buildReportEvidence(window,fixture());
  for (const g of e.activeChain.lifecycle.slice(0,2)) {
    assert.ok(g.lmdi.valid);
    assert.ok(Math.abs(g.lmdi.factors.reduce((n,f)=>n+f.effectUsd,0)-g.gmv.delta)<1e-9);
    assert.ok(Math.abs(g.lmdi.factors.find(f=>f.key==='chainPaySuccessRate').effectUsd-40)<1e-9);
  }
  const unknown=e.activeChain.lifecycle[2];assert.equal(unknown.gmv.current,0);assert.equal(unknown.lmdi.valid,false);
  assert.equal(unknown.lmdi.factors.find(f=>f.key==='subExposeRate').current,null);
  assert.match(e.revenue.total.movement,/\+22\.64%（\$530 -> \$650）/);
});

test('movement puts signed relative change first, keeps two-decimal pp and preserves undefined comparisons',()=>{
  assert.equal(metric('a','日均DAU',100,120,'count').movement,'日均DAU +20.00%（100 -> 120）');
  const rate=metric('b','提交支付率',.2,.17,'rate');
  assert.equal(rate.movement,'提交支付率 -15.00%（20.00% -> 17.00%），变化 -3.00pp');
  assert.equal(rate.baseline,.2);assert.equal(rate.current,.17);
  assert.equal(metric('c','API',0,10,'usd').movement,'API 相对变化不可计算（$0 -> $10）');
  assert.equal(metric('d','留存率',null,null,'rate').movement,'留存率 相对变化不可计算（不可用 -> 不可用）');
});

test('nonconserving channel atoms suppress effects instead of silently dropping users', () => {
  const s=fixture();s.breakdown.rows.find(r=>r.breakdown_type==='SUBMIT_CHANNEL').submit_uv+=10;
  const e=buildReportEvidence(window,s);
  assert.equal(e.activeChain.payRate.channel.valid,false);assert.equal(e.activeChain.payRate.channel.effects,null);
  assert.match(e.activeChain.payRate.channel.reason,/不守恒/);
});

test('unknown paid users without submissions remain unresolved rather than a fictitious channel efficiency', () => {
  const s=fixture();
  for (const row of s.breakdown.rows.filter(r=>r.breakdown_type==='SUBMIT_CHANNEL')) {
    row.pay_uv-=1;
    s.breakdown.rows.push({ ...row,breakdown_value:'unknown',submit_uv:0,pay_uv:1 });
  }
  const e=buildReportEvidence(window,s), d=e.activeChain.payRate.channel;
  assert.equal(d.valid,true);
  const unknown=d.groups.find(g=>g.key==='未知');assert.equal(unknown.comparable,false);assert.equal(unknown.rate.baseline,null);assert.equal(unknown.efficiencyPp,0);
  assert.ok(Math.abs(d.effects.efficiencyPp+d.effects.structurePp+d.effects.unresolvedPp-d.movement.pp)<1e-9);
});

test('retention nulls and overlapping function UV never become zero retention or doubled overall users', () => {
  const e=buildReportEvidence(window,fixture());
  assert.equal(e.creation.retention.find(r=>r.horizon===7).rate.current,null);
  assert.equal(e.creation.retention.find(r=>r.horizon===7).comparableFullWeeks,false);
  assert.equal(e.creation.metrics.find(m=>m.id==='creation.all.creation_user_cnt').current,5);
  assert.equal(e.creation.functions.reduce((n,f)=>n+f.metrics.find(m=>m.unit==='count'&&m.label==='日均创作用户数').current,0),10);
  assert.equal(e.creation.functionCountsReconcile,true);
  assert.equal(e.creation.metrics.find(m=>m.label==='任务成功率').current,.6);
});

test('missing core atoms or dates block; missing optional facts stay unavailable instead of becoming zero', () => {
  const s=fixture();s.funnel.rows[0].active_uv=null;assert.throws(()=>buildReportEvidence(window,s),/核心原子数据缺失/);
  const missing=fixture();missing.pay.rows=missing.pay.rows.filter(r=>r.period!=='2026-10-30');assert.throws(()=>buildReportEvidence(window,missing),/缺少可比数据/);
  const optional=fixture();optional.ads={...source([]),status:'unavailable'};const e=buildReportEvidence(window,optional);assert.equal(e.ads.available,false);assert.deepEqual(e.ads.totals,[]);
  const partial=fixture();partial.creation.rows[0].valid_creation_task_cnt=null;
  assert.equal(buildReportEvidence(window,partial).creation.metrics.find(m=>m.label==='日均有效任务数').baseline,null);
});

test('country aliases, invalid codes, and source totals reconcile without assigning unknown to T2', () => {
  const e=buildReportEvidence(window,fixture());
  assert.deepEqual(e.ads.countries.map(c=>c.key).sort(),['GB','未知']);
  assert.deepEqual(e.ads.tiers.map(c=>c.key).sort(),['T1','未知']);
  assert.equal(e.ads.tiers.reduce((n,t)=>n+t.metrics[0].current,0),e.ads.totals[0].current);
});

test('four-week actions use actual effective time, six candidate types, unknown scope exclusion and release context', () => {
  const raw=(id,date,type,platform)=>normalizeProductAction({record_id:id,'统计日':'2026-11-01','上线时间':date,'端':platform,'类型':[type]});
  const s=source([raw('a','2026-10-10','策略调整','web'),raw('b','2026-10-09','优化','web'),raw('c','2026-11-01','修复',null),raw('d',null,'配置变更','web'),raw('e','2026-11-01','故障恢复','App'),raw('f','2026-11-01','版本发布','web'),raw('g','2026-10-24','配置变更','web')]);
  const a=selectProductActions(window,s);
  assert.deepEqual(a.eligible.map(r=>r.record_id),['a','g']);assert.equal(a.eligible[1].priorityWindow,true);
  assert.deepEqual(a.associatedReleases.map(r=>r.record_id),['f']);
  assert.ok(a.excluded.find(r=>r.recordId==='c').reason.includes('端未知'));
  assert.ok(a.excluded.find(r=>r.recordId==='d').reason.includes('未使用统计日'));
  assert.equal(a.searchStart,'2026-10-10');assert.equal(actionDate('2026-10-23T20:00:00Z'),'2026-10-24');
});

test('loader binds platform/date and failed action read never masquerades as a complete cached search', async () => {
  const queries=reportEvidenceQueries(window);assert.equal(queries.length,7);
  assert.ok(queries.find(q=>q.key==='renewal').binds.includes('WEB'));
  assert.match(queries.find(q=>q.key==='functions').sql,/COUNT\(d7_creation_user_cnt\)=COUNT\(\*\)/);
  const s=await loadReportSources(window,{query:async()=>[],actions:async()=>{throw new Error('access failed');}});
  assert.equal(s.actions.status,'unavailable');assert.equal(s.actions.complete,false);assert.equal(s.actions.rows.length,0);
});

function tierFixture() {
  const s=fixture();
  s.pay.rows=s.pay.rows.flatMap(row=>row.pay_category!=='AUTO_RENEWAL'?[row]:[
    {...row,product_type:'Pro',gmv_usd:row.period<'2026-10-31'?60:100},
    {...row,product_type:'Lite',gmv_usd:row.period<'2026-10-31'?40:20},
  ]);
  s.renewal.rows=s.renewal.rows.flatMap(row=>[
    {...row,plan_tier:'PRO',plan_cycle:'MONTHLY',expire_user_cnt:60,renew_user_cnt:row.period<'2026-10-31'?30:25,renew_amount_usd:row.period<'2026-10-31'?60:50},
    {...row,plan_tier:'LITE',plan_cycle:'MONTHLY',expire_user_cnt:40,renew_user_cnt:row.period<'2026-10-31'?20:15,renew_amount_usd:row.period<'2026-10-31'?40:30},
  ]);
  return s;
}

test('renewal product contributions retain offsets; each type uses its own chain denominator even when result and cohort directions differ',()=>{
  const e=buildReportEvidence(window,tierFixture());
  const pro=e.revenue.renewalTypes.find(t=>t.key==='Pro'),lite=e.revenue.renewalTypes.find(t=>t.key==='Lite');
  assert.equal(pro.contribution,2);assert.equal(lite.contribution,-1);
  assert.equal(pro.contributionDenominator,'revenue.AUTO_RENEWAL');
  assert.deepEqual(e.revenue.renewalTypeRanking.sameDirection,[pro.id]);
  assert.deepEqual(e.revenue.renewalTypeRanking.offsets,[lite.id]);
  const chain=e.renewal.productTypes.find(t=>t.key==='Pro');
  assert.equal(chain.gmv.delta,-10);assert.equal(pro.delta,40);
  assert.deepEqual(chain.sourceLabels,['PRO']);
  for(const t of e.renewal.productTypes){
    assert.ok(t.lmdi.valid);
    assert.ok(Math.abs(t.lmdi.factors.reduce((n,f)=>n+f.effectUsd,0)-t.gmv.delta)<1e-9);
    assert.ok(t.lmdi.factors.every(f=>f.contributionDenominator===t.gmv.id));
    assert.ok(Math.abs(t.lmdi.factors.reduce((n,f)=>n+f.contribution,0)-1)<1e-9);
  }
  assert.ok(Math.abs(chain.lmdi.factors.find(f=>f.key==='rate').effectUsd+10)<1e-9);
  assert.equal(e.checks.filter(c=>!c.passed).length,0);
});

test('unknown and other renewal tiers remain explicit; missing type data never acquire the whole renewal factors',()=>{
  const s=tierFixture();
  for(const row of s.pay.rows.filter(r=>r.pay_category==='AUTO_RENEWAL'))s.pay.rows.push({...row,product_type:row.product_type==='Pro'?null:'Legacy',gmv_usd:1});
  const e=buildReportEvidence(window,s);
  assert.ok(e.revenue.renewalTypes.some(t=>t.key==='未知'));
  assert.ok(e.revenue.renewalTypes.some(t=>t.key==='Legacy'));
  assert.equal(e.checks.filter(c=>!c.passed).length,0);
  s.renewal.rows=s.renewal.rows.filter(r=>!(r.plan_tier==='PRO'&&r.period==='2026-10-24'));
  const incomplete=buildReportEvidence(window,s).renewal.productTypes.find(t=>t.key==='Pro');
  assert.equal(incomplete.lmdi.valid,false);assert.deepEqual(incomplete.missingDates,['2026-10-24']);
  assert.ok(incomplete.lmdi.factors.every(f=>f.effectUsd===null&&f.contribution===null));
  const absent=tierFixture();absent.renewal.rows=absent.renewal.rows.filter(r=>r.plan_tier!=='PRO');
  assert.ok(!buildReportEvidence(window,absent).renewal.productTypes.some(t=>t.key==='Pro'));
});

test('renewal zero net result has no ranking; missing atoms and zero paid users leave type effects unavailable',()=>{
  const s=tierFixture();for(const r of s.pay.rows.filter(r=>r.pay_category==='AUTO_RENEWAL'))r.gmv_usd=r.product_type==='Pro'?60:40;
  const e=buildReportEvidence(window,s);assert.deepEqual(e.revenue.renewalTypeRanking.sameDirection,[]);
  assert.ok(e.revenue.renewalTypes.every(t=>t.contribution===null));
  s.renewal.rows.find(r=>r.plan_tier==='PRO').renew_user_cnt=null;
  assert.equal(buildReportEvidence(window,s).renewal.productTypes.find(t=>t.key==='Pro').lmdi.valid,false);
  const z=tierFixture();for(const r of z.renewal.rows.filter(r=>r.plan_tier==='PRO')){r.renew_user_cnt=0;r.renew_amount_usd=0;}
  const pro=buildReportEvidence(window,z).renewal.productTypes.find(t=>t.key==='Pro');
  assert.equal(pro.lmdi.valid,false);assert.ok(pro.lmdi.factors.every(f=>f.effectUsd===null));
});

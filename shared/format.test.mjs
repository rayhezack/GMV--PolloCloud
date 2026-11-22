import test from 'node:test';
import assert from 'node:assert/strict';
import * as f from './format.ts';
const cases={money:[143716.6,'$143,717',0,'$0',-1533,'−$1,533'],moneyCompact:[1250000,'$1.25M',0,'$0',-140000,'−$140K'],count:[6722.43,'6,722',0,'0',-6722.43,'-6,722'],countCompact:[48400,'48.4K',0,'0',-48400,'−48.4K'],rate:[.312,'31.20%',0,'0.00%',-.312,'-31.20%'],changePct:[.199,'↗ 19.9%',0,'0.0%',-.065,'↘ 6.5%'],changePp:[.0121,'↗ 1.21 pp',0,'0.00 pp',-.0121,'↘ 1.21 pp'],signedMoney:[17443,'+$17,443',0,'$0',-1533,'−$1,533'],share:[.559,'+55.9%',0,'0.0%',-1.558,'−155.8%']};
for(const[name,values]of Object.entries(cases))test(`format ${name}: values, missing, zero, negative`,()=>{for(let i=0;i<values.length;i+=2)assert.equal(f[name](values[i]),values[i+1]);for(const v of [null,undefined,NaN,Infinity])assert.equal(f[name](v),'—');});
test('day rejects invalid dates and uses UTC weekdays',()=>{assert.equal(f.day('2026-11-04'),'11/04 周三');for(const v of[null,undefined,NaN,0,-1,'2026-02-30','bad'])assert.equal(f.day(v),'—');});
test('range uses en dash and year at boundaries',()=>{assert.equal(f.range('2026-10-31','2026-11-04'),'10/31–11/04');assert.equal(f.range('2025-12-31','2026-01-01'),'2025/12/31–2026/01/01');for(const v of[null,NaN,0,-1])assert.equal(f.range(v,'2026-11-04'),'—');});
test('unit dispatch keeps percentage points distinct from percent change',()=>{assert.equal(f.metricChange(.5,.51,'rate'),'↗ 1.00 pp');assert.equal(f.metricChange(100,102,'count'),'↗ 2.0%');assert.equal(f.metricChange(0,10,'currency'),'—');assert.equal(f.metricValue(0,'rate'),'0.00%');});

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaymentView, buildPaymentDailyRows } from './payment-analysis.data.ts';
import { registrationBreakdown, registrationLayerTrend } from './payment-registration.ts';
import { paymentMonthTrend, paymentShareTrend } from './payment-history.ts';
import { formatPaymentValue } from '../../../../shared/payment-metric.ts';
import { paymentOrdersMatch } from '../../../../worker/payment-analysis-sql.ts';
const revenues=[
 ['2026-11-07','首订',100,10],['2026-11-07','自动续订',300,30],
 ['2026-11-14','首订',150,20],['2026-11-14','自动续订',250,25],
].map(([period,payType,gmvUsd,orderCount])=>({period,weekStart:period,payType,payCategory:payType==='首订'?'ACTIVE_PAYMENT':'AUTO_RENEWAL',gmvUsd,orderCount}));
const data={revenues,costs:[],costAvailable:false,comparison:{analysisPeriod:'2026-11-14',baselinePeriod:'2026-11-07',analysisPeriodDays:1,baselinePeriodDays:1},registration:{verifiedPayTypes:['首订'],verifiedOrderPayTypes:['首订'],rows:revenues.filter(r=>r.payType==='首订').map(r=>({...r,userLifecycle:'NEW',countryTier:'T1',regPlatform:'WEB',sku:'Pro_月订_800'}))}};
test('GMV/orders use independent true measures; order contributions sum to 100%',()=>{
 const money=buildPaymentView(data,'ALL','payType');const orders=buildPaymentView(data,'ALL','payType',undefined,'orders');
 assert.equal(money.total.gmv,400);assert.equal(orders.total.gmv,45);assert.equal(orders.total.baseline,40);
 assert.equal(orders.items.find(r=>r.key==='首订').contribution,2);assert.equal(orders.items.find(r=>r.key==='自动续订').contribution,-1);
 assert.equal(orders.items.reduce((n,r)=>n+r.contribution,0),1);
 assert.equal(buildPaymentDailyRows(data,'ALL','payType','orders').reduce((n,r)=>n+r.gmv,0),85);
});
test('scope filters and registration dimension totals preserve the selected order metric',()=>{
 assert.equal(buildPaymentView(data,'ACTIVE_PAYMENT','payType',undefined,'orders').total.gmv,20);
 assert.deepEqual(registrationBreakdown(data,'首订','sku','orders').map(r=>[r.baseline,r.analysis]),[[10,20]]);
 assert.equal(registrationBreakdown({...data,registration:{...data.registration,verifiedOrderPayTypes:[]}},'首订','sku','orders'),null);
});
test('missing counts never become zero or a fabricated order estimate',()=>{
 const missing={...data,revenues:data.revenues.map((r,i)=>({...r,orderCount:i===0?null:r.orderCount}))};
 assert.equal(buildPaymentView(missing,'ALL','payType',undefined,'orders'),null);
 assert.equal(formatPaymentValue(null,'orders'),'—');assert.equal(formatPaymentValue(0,'orders'),'0');assert.ok(!formatPaymentValue(20,'orders').includes('$'));
 assert.equal(paymentOrdersMatch([{order_count:10}],[{order_count:10}]),true);
 assert.equal(paymentOrdersMatch([{order_count:10}],[{order_count:null}]),false);
});
test('daily trend and share compare order counts against the same scope and last-week day',()=>{
 const history={points:revenues.filter(r=>r.payType==='首订').map(r=>({...r,days:1,orderCount:r.orderCount+10})),series:[{key:'首订',points:revenues.filter(r=>r.payType==='首订')}]};
 const trend=paymentMonthTrend(history,'首订','2026-11-07','2026-11-14','orders');
 assert.equal(trend.at(-1).analysis,20);assert.equal(trend.at(-1).baseline,10);
 const share=paymentShareTrend(history,'首订','month','orders');assert.equal(share.at(-1).share,20/30);
 const layer=registrationLayerTrend({points:history.points.map(r=>({...r,total:r.gmvUsd,verified:true,ordersVerified:r.period==='2026-11-14'})),rows:data.registration.rows},'userLifecycle','新用户',7,'2026-11-14','orders');
 assert.equal(layer.at(-1).analysis,20);assert.equal(layer.at(-1).baseline,null);
});

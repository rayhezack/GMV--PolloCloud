import type { PaymentTrendResponse } from '../../../../shared/api.interface';
const shift=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
export type PaymentShareRange = 'week' | 'month' | 'year';
export function latestPaymentDate(history: PaymentTrendResponse) {
  return history.points.filter(point => point.days > 0 && point.gmvUsd != null).map(point => point.period).sort().at(-1);
}
/** Aggregate GMV before taking a ratio; never average daily shares or fill missing coverage with zero. */
export function paymentShareTrend(history: PaymentTrendResponse, entity: string, range?: PaymentShareRange) {
  const series = history.series.find(series => series.key === entity);
  const end = latestPaymentDate(history);
  if (!series || !end) return [];
  const start = range === 'year' ? end.slice(0, 4) + '-01-01' : shift(end, range === 'week' ? -13 : -29);
  const totals = new Map(history.points.map(point => [point.period, point]));
  const amounts = new Map(series.points.map(point => [point.period, point.gmvUsd]));
  const buckets = new Map<string, {date: string; startDate: string; endDate: string; days: number; missingDays: number; gmv: number; totalGmv: number}>();
  for (let date = start; date <= end; date = shift(date, 1)) {
    const key = range === 'year' ? date.slice(0, 7) + '-01' : range === 'month'
      ? shift(date, -((new Date(date + 'T00:00:00Z').getUTCDay() + 1) % 7)) : date;
    let bucket = buckets.get(key);
    if (!bucket) { bucket = {date: key, startDate: date, endDate: date, days: 0, missingDays: 0, gmv: 0, totalGmv: 0}; buckets.set(key, bucket); }
    bucket.endDate = date;
    bucket.days++;
    const total = totals.get(date), amount = amounts.get(date);
    if (!total?.days || total.gmvUsd == null || amount == null) bucket.missingDays++;
    else { bucket.gmv += amount; bucket.totalGmv += total.gmvUsd; }
  }
  return [...buckets.values()].map(bucket => {
    const {date, startDate, endDate, days, missingDays} = bucket;
    const gmv = missingDays ? null : bucket.gmv, totalGmv = missingDays ? null : bucket.totalGmv;
    return {date, startDate, endDate, days, missingDays, gmv, totalGmv,
      dailyGmv: gmv == null ? null : gmv / days, dailyTotalGmv: totalGmv == null ? null : totalGmv / days,
      share: gmv != null && totalGmv != null && totalGmv > 0 ? gmv / totalGmv : null};
  });
}
export function paymentMonthTrend(history:PaymentTrendResponse,entity:string,baselineWeek:string,analysisWeek:string) {
  const byDate=new Map(history.series.find(series=>series.key===entity)?.points.map(point=>[point.period,point])??[]);
  const available=history.points.filter(point=>point.gmvUsd!=null);
  const end=available.at(-1)?.period;
  if(!end)return [];
  const start=shift(end,-29);
  const gap=Math.round((Date.parse(analysisWeek)-Date.parse(baselineWeek))/86400000);
  return available.filter(point=>point.period>=start).map((point,day)=>{
    const actual=byDate.get(point.period),previous=byDate.get(shift(point.period,-gap));
    return {day,date:point.period,label:point.period.slice(5).replace('-','/'),analysis:actual?.gmvUsd??0,cost:actual?.modelCostUsd??null,baseline:previous?.gmvUsd??null,baselineCost:previous?.modelCostUsd??null};
  });
}

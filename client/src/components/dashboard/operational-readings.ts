import type { AdsOverviewResponse } from '../../../../shared/api.interface.ts';
type Point = AdsOverviewResponse['trend'][number];
export type AdsTrafficKey = 'clicks' | 'costUsd' | 'impressions' | 'registerUsers';
const shift = (date: string, days: number) => new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
export function adsRangeData(points: Point[], range?: {startDate:string;endDate:string}) {
  const selected=points.filter(p=>!range||(p.period>=range.startDate&&p.period<=range.endDate)).sort((a,b)=>a.period.localeCompare(b.period));
  const byDate=new Map(points.map(p=>[p.period,p]));
  const pairs=selected.flatMap(point=>{const previous=byDate.get(shift(point.period,-7));return previous?[{point,previous}]:[];});
  return {selected,matched:pairs.map(p=>p.point),previous:pairs.map(p=>p.previous)};
}
export function adsAverage(points: Point[], key: AdsTrafficKey) { return points.length?points.reduce((sum,p)=>sum+p[key],0)/points.length:null; }
export function adsMetricComparison(top: ReturnType<typeof adsRangeData>, key: AdsTrafficKey) {
  const current=adsAverage(top.matched,key),baseline=adsAverage(top.previous,key);
  return {value:adsAverage(top.selected,key),current,baseline,change:current==null||baseline==null||baseline===0?null:(current-baseline)/baseline};
}
export function adsComparisonLabel(top: ReturnType<typeof adsRangeData>) {
  if(!top.matched.length)return '无可比日期';
  const range=(p:Point[])=>`${p[0].period.slice(5).replace('-','/')}–${p.at(-1)!.period.slice(5).replace('-','/')}`;
  return `可比日 ${range(top.matched)} · 较前移 7 天 ${range(top.previous)} · ${top.matched.length} 天日均`;
}

import type { PaymentTrendResponse } from '../../../../shared/api.interface';
const shift=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
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

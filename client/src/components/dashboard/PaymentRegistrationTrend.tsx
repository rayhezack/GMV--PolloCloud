import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getPaymentRegistrationTrend } from '@/api/dashboard';
import type { AppDeviceType, DashboardPlatform, PaymentAnalysisResponse, PaymentRegistrationTrendResponse } from '@shared/api.interface';
import type { buildPaymentView } from './payment-analysis.data';
import { registrationLayerTrend, registrationLabel, type RegistrationDimension } from './payment-registration';

type Trend = ReturnType<typeof buildPaymentView>['trend'];
const shift = (date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
export function PaymentRegistrationTrend({data,payType,dimension,layer,platform,deviceType,refreshToken,renderTrend}: {
  data:PaymentAnalysisResponse;payType:string;dimension:RegistrationDimension;layer:string;platform:DashboardPlatform;deviceType?:AppDeviceType;refreshToken:number;
  renderTrend:(trend:Trend,summary:Trend)=>ReactNode;
}) {
  const [history,setHistory]=useState<PaymentRegistrationTrendResponse|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
  const analysis=data.comparison?.analysisPeriod ?? '',baseline=data.comparison?.baselinePeriod ?? '';
  const displayEnd=data.revenues.filter(row=>row.weekStart===analysis).map(row=>row.period).sort().at(-1) ?? shift(analysis,6);
  const gap=Math.round((Date.parse(analysis)-Date.parse(baseline))/86400000);
  useEffect(()=>{
    if (!analysis || !Number.isFinite(gap)) return;
    let active=true;setHistory(null);setError(false);
    const startDate=[shift(displayEnd,-29),shift(displayEnd,-29-gap)].sort()[0],endDate=[displayEnd,shift(displayEnd,-gap)].sort().at(-1)!;
    void getPaymentRegistrationTrend({platform,deviceType,payType,startDate,endDate,cacheBust:refreshToken || retry || undefined})
      .then(result=>{if(active)setHistory(result);}).catch(()=>{if(active)setError(true);});
    return ()=>{active=false;};
  },[analysis,displayEnd,gap,payType,platform,deviceType,refreshToken,retry]);
  const trend=useMemo(()=>history?registrationLayerTrend(history,dimension,layer,gap,displayEnd):null,[history,dimension,layer,gap,displayEnd]);
  const summary=useMemo(()=>{
    if(!data.comparison || !data.registration?.verifiedPayTypes.includes(payType))return [];
    const observed=new Set(data.revenues.map(row=>row.period));
    const value=(date:string)=>observed.has(date)?data.registration!.rows.filter(row=>row.period===date && row.payType===payType && registrationLabel(row,dimension)===layer).reduce((sum,row)=>sum+row.gmvUsd,0):null;
    return Array.from({length:7},(_,day)=>({day,date:shift(analysis,day),label:shift(analysis,day).slice(5).replace('-','/'),analysis:value(shift(analysis,day)),baseline:value(shift(baseline,day)),cost:null,baselineCost:null}));
  },[data,payType,dimension,layer,analysis,baseline]);
  if (!trend) return <div className="payment-history-loading" role="status">{error?<><span>分层趋势读取失败</span><button type="button" onClick={()=>setRetry(value=>value+1)}>重新加载</button></>:'正在读取分层趋势…'}</div>;
  if(!summary.length || !trend.some(point=>point.analysis!=null))return <p className="payment-registration-note" role="status">所选分层缺少可核对的趋势数据，暂不展示。</p>;
  return <>{renderTrend(trend,summary)}</>;
}

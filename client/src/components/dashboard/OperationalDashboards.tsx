import { getAdsOverview } from '@/api/dashboard';
import { diagnoseCohort } from './ads-cohort-diagnosis';
import { CreativePayTierPicker } from './CreativePayTierPicker';
import { WeekComparisonPicker } from './WeekComparisonPicker';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@heroui/react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Picker } from '@/components/bencho/Picker';
import { IconBar } from '@/components/bencho/IconBar';
import { FinanceOverviewAreaChart } from '@/components/finance-overview-area-chart';
import { BalanceChart } from '@/components/balance-chart';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { GrowthTrendsChart } from '@/components/growth-trends-chart';
import type { AdsAggregate, AdsCountryDetail, AdsOverviewResponse, CreativeChainTrendPoint, CreativeOverviewResponse, DashboardAttributionsResponse } from '@shared/api.interface';
import './operational-dashboards.css';

const integer = (n: number) => Math.round(n).toLocaleString('en-US');
const money = (n: number) => `$${integer(n)}`;
const ratio = (n: number | null, d: number) => n != null && d > 0 ? n / d : null;
const change = (n: number, b: number) => b ? (n - b) / b : null;
const date = (s: string) => s.slice(5).replace('-', '/');
const comparisonRange=(dates:string[]|undefined,fallback:string|undefined)=>dates?.length?`${date(dates[0])}–${date(dates.at(-1)!)}`:fallback??'';
const labels: Record<string, string> = { create_cnt_30d_0: '近30日未创作', 'create_cnt_30d_[1,11)': '近30日 1–10 次', 'create_cnt_30d_[11,31)': '近30日 11–30 次', 'create_cnt_30d_[31,101)': '近30日 31–100 次', 'create_cnt_30d_[101,+inf)': '近30日 101+ 次' };
function Empty({ children }: { children: string }) { return <div className="op-empty">{children}</div>; }
function Tabs({ value, items, onChange, label }: { value: string; items: Array<[string,string]>; onChange: (value:string)=>void; label:string }) { return <IconBar value={value} onChange={onChange} label={label} items={items.map(([value,label])=>({value,label}))}/>; }
type AdsHorizon = keyof NonNullable<AdsAggregate['roasByHorizon']>;
type AdsDailyPoint = AdsOverviewResponse['trend'][number];
type AdsCohortCell = AdsOverviewResponse['cohortMatrix'][number]['values'][number];
type AdsTrafficKey = 'clicks'|'costUsd'|'impressions'|'registerUsers';
type AdsDateRange = {startDate:string;endDate:string};
const adsNumber = (n:number) => n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const adsCompact = (n:number) => Math.abs(n)>=10000?`${(n/10000).toFixed(2)}万`:adsNumber(n);
const adsMoney = money;
const adsPct = (n:number) => `${(n*100).toFixed(2)}%`;
const adsRoasFormat = (n:number) => `${n.toFixed(2)}x`;
const adsShiftDate = (period:string,days:number) => new Date(Date.parse(period)+days*86400000).toISOString().slice(0,10);
const adsMature = (period:string,horizon:string,asOf:string) => (Date.parse(asOf)-Date.parse(period))/86400000>=Number(horizon.slice(1));
function adsRangeData(points:AdsDailyPoint[],range:AdsDateRange|undefined) {
  const selected=points.filter(p=>!range||(p.period>=range.startDate&&p.period<=range.endDate)).sort((a,b)=>a.period.localeCompare(b.period));
  const byDate=new Map(points.map(p=>[p.period,p]));
  const pairs=selected.flatMap(point=>{const previous=byDate.get(adsShiftDate(point.period,-7));return previous?[{point,previous}]:[];});
  return {selected,matched:pairs.map(p=>p.point),previous:pairs.map(p=>p.previous)};
}
function adsAverage(points:AdsDailyPoint[],key:AdsTrafficKey):number|null {
  return points.length?points.reduce((sum,p)=>sum+p[key],0)/points.length:null;
}
function adsDailyRoas(point:AdsDailyPoint,horizon:AdsHorizon,asOf:string):number|null {
  const value=point[horizon==='D0'?'gmvD0':horizon==='D7'?'gmvD7':'gmvD30'];
  return adsMature(point.period,horizon,asOf)&&point.roasByHorizon?.[horizon]!=null&&value!=null&&point.costUsd>0?value/point.costUsd:null;
}
function adsWindowRoas(points:AdsDailyPoint[],horizon:AdsHorizon,asOf:string):number|null {
  if(!points.length||points.some(p=>adsDailyRoas(p,horizon,asOf)==null))return null;
  const key=horizon==='D0'?'gmvD0':horizon==='D7'?'gmvD7':'gmvD30';
  return ratio(points.reduce((sum,p)=>sum+p[key]!,0),points.reduce((sum,p)=>sum+p.costUsd,0));
}
function adsCohortValue(cell:AdsCohortCell,period:string,metric:string,asOf:string):number|null {
  // The source's null also covers unavailable recovery data, not just cohort age.
  if(cell.value==null||!adsMature(period,cell.horizon,asOf))return null;
  return metric==='roas'?ratio(cell.gmvUsd,cell.costUsd):cell.value;
}
function AdsDelta({value}:{value:number|null}) {
  return <span className={value==null?'op-muted':value>=0?'op-positive':'op-negative'}>{value==null?'—':`${value>=0?'+':'−'}${adsPct(Math.abs(value))}`}</span>;
}
function AdsMetricCard({label,value,comparisonValue,baseline,points,format,controls}:{label:string;value:number|null;comparisonValue:number|null;baseline:number|null;points:Array<{period:string;value:number}>;format:(n:number)=>string;controls?:React.ReactNode}) {
  const axes=points.filter((_,i)=>i===0||i===Math.floor((points.length-1)/2)||i===points.length-1).map(p=>date(p.period));
  return <article className="op-finance-card op-ads-metric"><header><h2>{label}</h2>{controls}</header>
    <div className="op-ads-metric-value">{value==null?'—':format(value)}</div>
    <div className="op-ads-metric-comparison"><AdsDelta value={comparisonValue==null||baseline==null?null:change(comparisonValue,baseline)}/><span>较上周同期</span></div>
    {points.length?<FinanceOverviewAreaChart className="op-finance" plotHeight={160} title={label} categoryLabel="" category="" metric={label} summaryValue={value??undefined} formatValue={format} periods={[{value:'range',label:'所选日期',points:points.map(p=>({value:p.value,label:p.period})),axis:axes}]}/>:<div className="op-ads-metric-empty">该窗口暂无数据</div>}
  </article>;
}
function CohortDiagnosis({period,label,cell,asOf}:{period:string;label:string;cell:AdsCohortCell;asOf:string}) {
  const result=diagnoseCohort({period,horizon:cell.horizon,asOf,available:cell.value!=null,gmvUsd:cell.gmvUsd,costUsd:cell.costUsd,registerUsers:cell.registerUsers});
  const perUser=(n:number|null)=>n==null?'—':`$${n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  const conclusion={covered:'已覆盖获客成本',breakeven:'恰好覆盖获客成本',shortfall:'尚未覆盖获客成本',immature:'观察窗口尚未成熟，暂不判断回本',unavailable:'回收数据缺失，暂不判断回本','no-users':'注册 UV 为零，无法计算 LTV 与 CAC','no-cost':'获客成本为零，不计算回收覆盖率'}[result.status];
  const comparable=result.coverage!=null;
  return <div className="op-cohort-diagnosis" role="status">
    <p className="op-cohort-context">{label} · {cell.horizon}</p>
    <p className="op-cohort-conclusion"><strong>{conclusion}。</strong>{comparable&&` LTV ${perUser(result.ltv)} ${result.status==='covered'?'>':result.status==='breakeven'?'=':'<'} CAC ${perUser(result.cac)}。`}</p>
    {comparable&&<p className="op-cohort-evidence">获客成本覆盖率 {adsPct(result.coverage!)}；{result.totalGap!>=0?'超出':'尚差'} {adsMoney(Math.abs(result.totalGap!))}，每注册用户{result.perUserGap!>=0?'超出':'尚差'} {perUser(Math.abs(result.perUserGap!))}。</p>}
    <dl className="op-cohort-metrics">
      <div><dt>{cell.horizon} LTV</dt><dd>{perUser(result.ltv)}</dd><span>累计 GMV {result.ltv==null?'—':adsMoney(cell.gmvUsd)}</span></div>
      <div><dt>CAC</dt><dd>{perUser(result.cac)}</dd><span>获客成本 ÷ 注册 UV</span></div>
      <div><dt>获客成本</dt><dd>{adsMoney(cell.costUsd)}</dd></div>
      <div><dt>Cohort 注册 UV</dt><dd>{integer(cell.registerUsers)}</dd></div>
    </dl>
    {comparable&&<p className="op-cohort-boundary">按本窗口累计 GMV 对比获客成本，未扣除其他成本。</p>}
  </div>;
}
export function AdsDashboard({data,tableData,detailRequest,tableWeeks,dateRange,availableWeeks=[],onComparisonChange}:{data:AdsOverviewResponse|null;tableData:AdsOverviewResponse|null;detailRequest:Omit<Parameters<typeof getAdsOverview>[0], 'country'>;tableWeeks:{baselineWeek:string;analysisWeek:string};dateRange?:AdsDateRange;availableWeeks?:string[];onComparisonChange?:(baseline:string,analysis:string)=>void}) {
  const [horizon,setHorizon]=useState('D0');
  const [metric,setMetric]=useState('clicks');
  const [cohortMetric,setCohortMetric]=useState('ltv');
  const [country,setCountry]=useState('');
  const [channel,setChannel]=useState('');
  const [channelOpen,setChannelOpen]=useState(false);
  const [cell,setCell]=useState<{cohort:string;horizon:string}|null>(null);
  const [countryDetail,setCountryDetail]=useState<{key:string;data:AdsCountryDetail|undefined;error?:string}|null>(null);
  const table=tableData?.ready&&tableData.totals?tableData:null;
  const selectedCountry=table?.countries.find(c=>c.key===country)??table?.countries[0];
  const requestKey=JSON.stringify({...detailRequest,country:selectedCountry?.key});
  useEffect(()=>{
    if(!channelOpen||!selectedCountry)return;
    let cancelled=false;
    const request=JSON.parse(requestKey) as Parameters<typeof getAdsOverview>[0];
    void getAdsOverview(request).then(result=>{
      if(!cancelled)setCountryDetail({key:requestKey,data:result.countryDetails?.find(c=>c.key===request.country)});
    }).catch(error=>{if(!cancelled)setCountryDetail({key:requestKey,data:undefined,error:error instanceof Error?error.message:'渠道数据读取失败'});});
    return ()=>{cancelled=true;};
  },[channelOpen,requestKey]);
  if(!data?.ready||!data.totals)return <Empty>暂无广告数据</Empty>;
  const asOf=data.observedThrough||data.trend.at(-1)?.period||'';
  const top=adsRangeData(data.trend,dateRange);
  const topHorizon=horizon as AdsHorizon;
  const stats=[
    ...([{key:'clicks',label:'日均点击量',format:adsCompact},{key:'costUsd',label:'日均广告成本',format:adsMoney},{key:'registerUsers',label:'日均注册用户',format:adsCompact}] as const).map(m=>({label:m.label,value:adsAverage(top.selected,m.key),comparisonValue:adsAverage(top.matched,m.key),baseline:adsAverage(top.previous,m.key),points:top.selected.map(p=>({period:p.period,value:p[m.key]})),format:m.format})),
    {label:`${horizon} ROAS`,value:adsWindowRoas(top.selected,topHorizon,asOf),comparisonValue:adsWindowRoas(top.matched,topHorizon,asOf),baseline:adsWindowRoas(top.previous,topHorizon,asOf),points:top.selected.flatMap(p=>{const value=adsDailyRoas(p,topHorizon,asOf);return value==null?[]:[{period:p.period,value}];}),format:adsRoasFormat},
  ];
  const cohortRows=data.cohortMatrix.filter(row=>!dateRange||(row.key>=dateRange.startDate&&row.key<=dateRange.endDate));
  const cohortFormat=cohortMetric==='roas'?adsRoasFormat:(n:number)=>`$${n.toFixed(2)}`;
  const cohortLabel=cohortMetric==='roas'?'ROAS':'LTV';
  const maximum=Math.max(0.01,...cohortRows.flatMap(row=>row.values.map(c=>adsCohortValue(c,row.key,cohortMetric,asOf)??0)));
  const cellText=(row:AdsOverviewResponse['cohortMatrix'][number],c:AdsCohortCell)=>{
    const value=adsCohortValue(c,row.key,cohortMetric,asOf);
    return `${row.label} · ${c.horizon} · 注册 ${adsNumber(c.registerUsers)} · GMV ${adsMoney(c.gmvUsd)} · 成本 ${adsMoney(c.costUsd)} · ${cohortLabel} ${value==null?'—':cohortFormat(value)}`;
  };
  const activeCohort=cohortRows.find(row=>row.key===cell?.cohort),activeCell=activeCohort?.values.find(c=>c.horizon===cell?.horizon);
  // Country and channel comparisons use their own selected business weeks.
  const {current,baseline}=table?.totals??data.totals;
  const days=table?.comparison?.analysisPeriodDays||1,baseDays=table?.comparison?.baselinePeriodDays||1;
  const trafficMetrics=[{value:'clicks',label:'点击量'},{value:'costUsd',label:'广告成本'},{value:'impressions',label:'展示量'},{value:'registerUsers',label:'注册用户'}];
  const trafficKey=metric as AdsTrafficKey,trafficLabel=trafficMetrics.find(m=>m.value===metric)!.label;
  const trafficFormat=metric==='costUsd'?money:integer;
  const totalChange=current[trafficKey]/days-baseline[trafficKey]/baseDays;
  const comparison=table?.comparison;
  const countryRow=(row:AdsOverviewResponse['countries'][number],total=false)=>{
    const b=row.baseline[trafficKey]/baseDays,v=row.current[trafficKey]/days,d=v-b;
    return <tr key={row.key} className={total?'op-ads-total-row':undefined}><th scope="row">{row.label}</th><td>{trafficFormat(b)}</td><td>{trafficFormat(v)}</td><td className={d>=0?'op-positive':'op-negative'}>{d>=0?'+':'−'}{trafficFormat(Math.abs(d))}</td><td><AdsDelta value={change(v,b)}/></td><td>{total?(totalChange===0?'—':'100.00%'):<AdsDelta value={totalChange===0?null:d/totalChange}/>}</td></tr>;
  };
  const detail=table?.countryDetails?.find(c=>c.key===selectedCountry?.key)??(countryDetail?.key===requestKey?countryDetail.data:undefined);
  const selectedChannel=detail?.channels.find(c=>c.key===channel)??detail?.channels[0];
  const channelTrend=selectedChannel?.trend??[];

  return <div className="op-dashboard op-ads-dashboard">
    <div className="op-stats">{stats.map((s,i)=><AdsMetricCard key={s.label} {...s} controls={i===3?<Picker label="ROAS 回收窗口" value={horizon} onChange={setHorizon} items={['D0','D7','D30'].map(value=>({value,label:value}))}/>:undefined}/>)}</div>
    <section className="op-panel"><header className="op-heading"><h2>注册 Cohort · {cohortLabel}</h2><Picker label="Cohort 指标" value={cohortMetric} onChange={setCohortMetric} items={[{value:'ltv',label:'LTV'},{value:'roas',label:'ROAS'}]}/></header>
      {activeCohort&&activeCell&&<CohortDiagnosis period={activeCohort.key} label={activeCohort.label} cell={activeCell} asOf={asOf}/>}
      {cohortRows.length?<div className="op-table-scroll op-cohort-scroll"><table className="op-matrix"><thead><tr><th>注册日期</th>{['D0','D14','D30','D60','D90','D180'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{cohortRows.map(row=><tr key={row.key}><th>{row.label}</th>{row.values.map(c=>{
        const value=adsCohortValue(c,row.key,cohortMetric,asOf),level=value==null?null:Math.max(0,Math.min(1,value/maximum));
        return <td key={c.horizon}><button type="button" aria-label={cellText(row,c)} aria-pressed={cell?.cohort===row.key&&cell.horizon===c.horizon} onClick={()=>setCell(current=>current?.cohort===row.key&&current.horizon===c.horizon?null:{cohort:row.key,horizon:c.horizon})} style={level==null?undefined:{background:`color-mix(in srgb,#533afd ${6+level*49}%,white)`,color:'#0d253d'}}>{value==null?'—':cohortFormat(value)}</button></td>;
      })}</tr>)}</tbody></table></div>:<Empty>所选日期暂无 Cohort 数据</Empty>}
    </section>
    <section className="op-panel"><header className="op-heading"><h2>国家{trafficLabel}变化</h2><div className="op-ads-table-actions">{onComparisonChange&&<WeekComparisonPicker baselineWeek={tableWeeks.baselineWeek} analysisWeek={tableWeeks.analysisWeek} availableWeeks={availableWeeks} onWeekChange={value=>onComparisonChange(value.baselineWeek??tableWeeks.baselineWeek,value.analysisWeek??tableWeeks.analysisWeek)}/>}<Picker label="国家流量指标" value={metric} onChange={setMetric} items={trafficMetrics}/><Button type="button" size="sm" variant="tertiary" className="op-ads-channel-button" onPress={()=>setChannelOpen(true)} isDisabled={!table?.countries.length}>渠道分析</Button></div></header>
      {table?<div className="op-table-scroll op-country-scroll"><table className="op-table"><thead><tr><th>国家</th><th title="所选基准周：按可比日期计算日均">基准周日均</th><th title="所选分析周：按可比日期计算日均，降序">分析周日均 ↓</th><th>绝对变化</th><th>周环比</th><th>变化贡献度</th></tr></thead><tbody>{countryRow({key:'total',label:'合计',current,baseline},true)}{[...table.countries].sort((a,b)=>b.current[trafficKey]-a.current[trafficKey]||a.key.localeCompare(b.key)).map(c=>countryRow(c))}</tbody></table></div>:<Empty>对比周数据加载中</Empty>}
    </section>
    <Dialog open={channelOpen&&!!table} onOpenChange={setChannelOpen}><DialogContent className="op-country-dialog op-ads-dialog" onEscapeKeyDown={event=>{if(document.querySelector('.op-ads-dialog .bencho-picker-popover'))event.preventDefault();}} onInteractOutside={event=>{if(event.target instanceof Element&&event.target.closest('.bencho-picker-popover'))event.preventDefault();}}><DialogTitle>{selectedCountry?.label??'国家'} · 渠道表现</DialogTitle><div className="op-country-controls"><span>{comparisonRange(table?.comparisonDates?.analysis,comparison?.analysisPeriod)} / {comparisonRange(table?.comparisonDates?.baseline,comparison?.baselinePeriod)} · 日均</span><div className="op-ads-channel-pickers"><Picker label="渠道分析国家" searchable value={selectedCountry?.key??''} onChange={value=>{setCountry(value);setChannel('');}} items={table?.countries.map(c=>({value:c.key,label:c.label}))??[]}/><Picker label="国家广告渠道" value={selectedChannel?.key??''} onChange={setChannel} items={detail?.channels.map(c=>({value:c.key,label:c.label}))??[]}/></div></div>
      <div className="op-ads-channel-body">{selectedChannel?<><div className="op-table-scroll"><table className="op-table"><thead><tr><th>日均指标</th><th>基准周</th><th>分析周</th><th>周环比</th></tr></thead><tbody>{([{label:'点击量',key:'clicks',format:adsCompact},{label:'CTR',key:'ctr',format:creativePct},{label:'广告成本',key:'costUsd',format:adsMoney},{label:'CPC',key:'cpc',format:(n:number)=>`$${n.toFixed(2)}`},{label:'注册量',key:'registerUsers',format:adsCompact},{label:'D0 收入',key:'gmvD0',format:adsMoney},{label:'D0 ROAS',key:'roas',format:adsRoasFormat}] as const).map(m=>{
        const c=m.key==='cpc'?ratio(selectedChannel.current.costUsd,selectedChannel.current.clicks):m.key==='roas'?selectedChannel.current.roasByHorizon?.D0??null:m.key==='ctr'?(selectedChannel.current.impressions?selectedChannel.current.clicks/selectedChannel.current.impressions:null):selectedChannel.current[m.key]/days;
        const b=m.key==='cpc'?ratio(selectedChannel.baseline.costUsd,selectedChannel.baseline.clicks):m.key==='roas'?selectedChannel.baseline.roasByHorizon?.D0??null:m.key==='ctr'?(selectedChannel.baseline.impressions?selectedChannel.baseline.clicks/selectedChannel.baseline.impressions:null):selectedChannel.baseline[m.key]/baseDays;
        return <tr key={m.key}><th>{m.label}</th><td>{b==null?'—':m.format(b)}</td><td>{c==null?'—':m.format(c)}</td><td><AdsDelta value={b==null||c==null?null:change(c,b)}/></td></tr>;
      })}</tbody></table></div>{channelTrend.length?<GrowthTrendsChart key={`${selectedCountry?.key}:${selectedChannel.key}`} className="op-growth" title={`${selectedCountry?.label} ${selectedChannel.label} 每日趋势`} months={channelTrend.map(p=>p.period)} bars={30} compareMonths={7} thisMonthLabel="最新一日" formatCompare={n=>`较前 ${n} 日均值`} formatMonth={date} formatValue={(n,m)=>!Number.isFinite(n)?'—':m.id==='ctr'?creativePct(n):['clicks','registers'].includes(m.id)?integer(n):m.id==='roas'?adsRoasFormat(n):adsMoney(n)} metrics={[{id:'clicks',title:'点击量',label:'点击',color:'purple',values:channelTrend.map(p=>p.clicks)},{id:'ctr',title:'CTR',label:'CTR',color:'blue',values:channelTrend.map(p=>p.impressions?p.clicks/p.impressions:NaN)},{id:'cost',title:'广告成本',label:'成本',color:'blue',values:channelTrend.map(p=>p.costUsd)},{id:'registers',title:'注册量',label:'注册',color:'green',values:channelTrend.map(p=>p.registerUsers)},{id:'gmv',title:'D0 收入',label:'收入',color:'purple',values:channelTrend.map(p=>p.gmvD0)},{id:'roas',title:'D0 ROAS',label:'ROAS',color:'green',values:channelTrend.map(p=>adsDailyRoas(p,'D0',asOf)??NaN)}]}/>:<Empty>暂无渠道趋势</Empty>}</>:<Empty>{countryDetail?.key!==requestKey?'渠道数据加载中':countryDetail.error??'暂无渠道明细'}</Empty>}</div>
    </DialogContent></Dialog>
  </div>;
}

const creativeNumber = (n:number) => n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const creativeCompact = (n:number) => Math.abs(n)>=10000?`${(n/10000).toFixed(2)}万`:creativeNumber(n);
const creativePct = (n:number) => `${(n*100).toFixed(2)}%`;
const creativeRatio = (n:number|null|undefined,d:number|null|undefined) => n!=null&&d!=null&&d>0?n/d:null;
const creativeWeekBefore = (period:string) => new Date(Date.parse(period)-7*86400000).toISOString().slice(0,10);
const creativeAtomicKeys = ['creationUserCnt','creationTaskCnt','validCreationTaskCnt','successTaskCnt','successOutputCnt','adoptedTaskCnt','adoptedOutputCnt','d3CreationUserCnt','d7CreationUserCnt','d30CreationUserCnt'] as const;
type CreativeAtomicKey = typeof creativeAtomicKeys[number];
type CreativeRateKey = 'creationPenetrationRate'|'avgCreationTaskCntPerCreator'|'requestRate'|'successRate'|'adoptionRate'|'d3Rate'|'d7Rate'|'d30Rate';
type CreativeInput = {period:CreativeChainTrendPoint['period'];activity?:{activeUv:number|null;creationUv:number|null;creationTaskCnt:number|null}|null} & Partial<Record<CreativeAtomicKey,number|null>>;
type CreativePoint = {period:string} & Record<CreativeAtomicKey|CreativeRateKey,number|null>;
type CreativeMetric = {key:Exclude<keyof CreativePoint,'period'>;label:string;format:(n:number)=>string;formula?:string};
const creativeMetrics:CreativeMetric[] = [
  {key:'creationPenetrationRate',label:'创作渗透率',format:creativePct,formula:'活跃人群中的创作 UV / 活跃 UV；分子与分母来自同一日、同一活跃人群。'},
  {key:'avgCreationTaskCntPerCreator',label:'人均创作任务数',format:creativeNumber,formula:'活跃人群的创作任务数 / 活跃 UV；按活跃用户计算，与诊断报告一致。'},
  {key:'creationUserCnt',label:'创作用户',format:creativeCompact,formula:'整体按用户去重；同一用户可使用多个功能，功能行的人数不可相加为整体人数。'},
  {key:'creationTaskCnt',label:'创作任务',format:creativeCompact},
  {key:'validCreationTaskCnt',label:'已请求任务',format:creativeCompact},
  {key:'requestRate',label:'请求率',format:creativePct,formula:'已请求任务数 / 创作任务数；已请求任务指已提交模型请求的创作任务。'},
  {key:'successRate',label:'任务成功率',format:creativePct,formula:'成功任务数 / 创作任务数'},
  {key:'adoptionRate',label:'任务采纳率',format:creativePct,formula:'采纳任务数 / 成功任务数'},
  ...([3,7,30] as const).map(horizon=>({key:`d${horizon}Rate` as const,label:`D${horizon} 创作留存率`,format:creativePct,formula:`D${horizon} 留存用户数 / 对应创作日用户数；仅统计截至数据观测日已满 ${horizon} 天且留存数据完整的创作日。周值为留存用户合计 / 对应创作用户合计。`})),
  ...([3,7,30] as const).map(horizon=>({key:`d${horizon}CreationUserCnt` as const,label:`D${horizon} 留存用户`,format:creativeCompact,formula:'整体按用户去重；同一用户可使用多个功能，功能行的留存人数不可相加为整体人数。'})),
];
function withRates(p:CreativeInput,asOf:string):CreativePoint {
  const values=Object.fromEntries(creativeAtomicKeys.map(key=>[key,p[key]??null])) as Record<CreativeAtomicKey,number|null>;
  const age=(Date.parse(asOf)-Date.parse(p.period))/86400000;
  for(const horizon of [3,7,30] as const) if(!(age>=horizon)) values[`d${horizon}CreationUserCnt`]=null;
  return {...values,period:p.period,
    creationPenetrationRate:creativeRatio(p.activity?.creationUv,p.activity?.activeUv),
    avgCreationTaskCntPerCreator:creativeRatio(p.activity?.creationTaskCnt,p.activity?.activeUv),
    requestRate:creativeRatio(values.validCreationTaskCnt,values.creationTaskCnt),
    successRate:creativeRatio(values.successTaskCnt,values.creationTaskCnt),
    adoptionRate:creativeRatio(values.adoptedTaskCnt,values.successTaskCnt),
    d3Rate:creativeRatio(values.d3CreationUserCnt,values.creationUserCnt),
    d7Rate:creativeRatio(values.d7CreationUserCnt,values.creationUserCnt),
    d30Rate:creativeRatio(values.d30CreationUserCnt,values.creationUserCnt),
  };
}
function combine(points:CreativeInput[],period:string,asOf:string):CreativePoint {
  const values=Object.fromEntries(creativeAtomicKeys.map(key=>[key,points.length&&points.every(p=>p[key]!=null)?points.reduce((sum,p)=>sum+p[key]!,0):null]));
  return withRates({...values,period},asOf);
}
function creativeWeeklyPoint(points:CreativeInput[],period:string,asOf:string,days:number):CreativePoint {
  // Combine each date first so a missing segment cannot become a partial retention numerator.
  const daily=[...new Set(points.map(p=>p.period))].map(day=>combine(points.filter(p=>p.period===day),day,asOf));
  const result=combine(daily,period,asOf);
  for(const key of creativeAtomicKeys) if(result[key]!=null) result[key]=days>0?result[key]!/days:null;
  for(const horizon of [3,7,30] as const){
    const key=`d${horizon}CreationUserCnt` as const,rateKey=`d${horizon}Rate` as const;
    const eligible=daily.filter(p=>p[key]!=null&&p.creationUserCnt!=null);
    const retained=eligible.reduce((sum,p)=>sum+p[key]!,0),creators=eligible.reduce((sum,p)=>sum+p.creationUserCnt!,0);
    result[key]=eligible.length?retained/eligible.length:null;
    result[rateKey]=creativeRatio(eligible.length?retained:null,creators);
  }
  return result;
}
function CreativeDelta({value,baseline,isRate=false}:{value:number|null;baseline:number|null;isRate?:boolean}) {
  const delta=value==null||baseline==null?null:isRate?value-baseline:change(value,baseline);
  return <span className={delta==null?'op-muted':delta>=0?'op-positive':'op-negative'}>{delta==null?'—':`${delta>=0?'+':'−'}${isRate?`${(Math.abs(delta)*100).toFixed(2)}pp`:creativePct(Math.abs(delta))}`}</span>;
}
function CreativeMetricHeader({metric}:{metric:CreativeMetric}) {
  return metric.formula?<Popover><PopoverTrigger asChild><button type="button" className="op-creative-formula-trigger" aria-label={`${metric.label}计算公式`}>{metric.label}</button></PopoverTrigger><PopoverContent className="op-creative-formula" align="end" side="bottom" sideOffset={6}><strong>{metric.label}</strong><p>{metric.formula}</p></PopoverContent></Popover>:<>{metric.label}</>;
}
function CreativeMetricCard({metric,point,baseline,trend,controls}:{metric:CreativeMetric;point:CreativePoint|undefined;baseline:CreativePoint|undefined;trend:CreativePoint[];controls?:React.ReactNode}) {
  const value=point?.[metric.key]??null,prior=baseline?.[metric.key]??null;
  const points=trend.filter(p=>p[metric.key]!=null);
  const axes=points.filter((_,i)=>i===0||i===Math.floor((points.length-1)/2)||i===points.length-1).map(p=>date(p.period));
  return <article className="op-finance-card op-creative-metric"><header><h2><CreativeMetricHeader metric={metric}/></h2>{controls}</header>
    <div className="op-creative-metric-value">{value==null?'—':metric.format(value)}</div>
    <div className="op-creative-metric-comparison"><span><CreativeDelta value={value} baseline={prior} isRate={metric.key.endsWith('Rate')}/> <span className="op-muted">较上周同期</span></span>{point&&<time dateTime={point.period}>{point.period}</time>}</div>
    {value!=null&&points.length?<FinanceOverviewAreaChart className="op-finance" plotHeight={160} title={metric.label} categoryLabel="" category="" metric={metric.label} summaryValue={value} formatValue={metric.format} periods={[{value:'data',label:'所选日期',points:points.map(p=>({value:p[metric.key]!,label:p.period})),axis:axes}]}/>:<div className="op-creative-metric-empty">暂无可用数据</div>}
  </article>;
}
type CreativeWeeks = {baselineWeek:string;analysisWeek:string};
export function CreativeDashboard({data,chain,dateRange,availableWeeks,featureWeeks,tierWeeks,onFeatureWeeksChange,onTierWeeksChange}:{
  data:DashboardAttributionsResponse|null;chain:CreativeOverviewResponse|null;
  dateRange:{startDate:string;endDate:string};availableWeeks:string[];
  featureWeeks:CreativeWeeks;tierWeeks:CreativeWeeks;
  onFeatureWeeksChange:(value:CreativeWeeks)=>void;onTierWeeksChange:(value:CreativeWeeks)=>void;
}) {
  const [metricKey,setMetricKey]=useState('creationUserCnt'),[tierMetric,setTierMetric]=useState('activeUv'),[functionName,setFunctionName]=useState(''),[userType,setUserType]=useState('all'),[payGroup,setPayGroup]=useState('all'),[payTier,setPayTier]=useState('all'),[mode,setMode]=useState('day'),[retentionHorizon,setRetentionHorizon]=useState('3');
  const functions=(chain?.functions??[]).filter(f=>f.label!=='未归因'),names=[...new Set(functions.map(f=>f.label))];
  const activeName=functionName==='__overall__'||names.includes(functionName)?functionName:names[0]??'';
  const users=[...new Set(functions.map(f=>f.userType))];
  const payTierOrder=['(0,10]','(10,50]','(50,100]','(100,300]','(300,1000]','(1000,+inf)'];
  const payTiers=[...new Set(functions.map(f=>f.payGmv30d))].filter(value=>value!=='未付费').sort((a,b)=>{
    const left=payTierOrder.indexOf(a),right=payTierOrder.indexOf(b);
    return (left<0?payTierOrder.length:left)-(right<0?payTierOrder.length:right)||a.localeCompare(b);
  });
  const asOf=chain?.observedThrough||chain?.trend.at(-1)?.period||'';
  const matchesPayTier=(value:string)=>payGroup==='all'||(payGroup==='unpaid'?value==='未付费':value!=='未付费'&&(payTier==='all'||value===payTier));
  const filter=(name:string)=>functions.filter(f=>f.label===name&&(userType==='all'||f.userType===userType)&&matchesPayTier(f.payGmv30d));
  const daily=useMemo(()=>{if(activeName==='__overall__')return (chain?.trend??[]).filter(p=>p.period>=dateRange.startDate&&p.period<=dateRange.endDate).sort((a,b)=>b.period.localeCompare(a.period)).map(p=>withRates(p,asOf));const selected=functions.filter(f=>f.label===activeName&&(userType==='all'||f.userType===userType)&&(payGroup==='all'||(payGroup==='unpaid'?f.payGmv30d==='未付费':f.payGmv30d!=='未付费'&&(payTier==='all'||f.payGmv30d===payTier))));const dates=[...new Set(selected.flatMap(f=>f.daily.map(p=>p.period)))].filter(period=>period>=dateRange.startDate&&period<=dateRange.endDate).sort().reverse();return dates.map(period=>combine(selected.flatMap(f=>f.daily.filter(p=>p.period===period)),period,asOf));},[chain?.trend,functions,activeName,userType,payGroup,payTier,asOf,dateRange.startDate,dateRange.endDate]);
  if(!chain?.ready)return <section className="op-panel"><header className="op-heading"><h2>功能表现</h2><WeekComparisonPicker className="op-inline-week-picker" {...featureWeeks} availableWeeks={availableWeeks} onWeekChange={value=>onFeatureWeeksChange({...featureWeeks,...value})}/></header><Empty>所选业务周暂无可比创作数据，请选择其他业务周。</Empty></section>;
  const allTrend=[...chain.trend].sort((a,b)=>a.period.localeCompare(b.period)).map(p=>withRates(p,asOf));
  const selected=creativeMetrics.find(m=>m.key===metricKey)??creativeMetrics[0];
  const visibleTrend=allTrend.filter(p=>p.period>=dateRange.startDate&&p.period<=dateRange.endDate);
  const valid=visibleTrend.filter(p=>p[selected.key]!=null),last=valid.at(-1);
  const before=last?allTrend.find(p=>p.period===creativeWeekBefore(last.period)):undefined;
  const retentionMetric=creativeMetrics.find(m=>m.key===`d${retentionHorizon}Rate`)!;
  const retentionTrend=visibleTrend.filter(p=>p[retentionMetric.key]!=null),retentionPoint=retentionTrend.at(-1);
  const stats=[creativeMetrics[0],creativeMetrics[1],{...retentionMetric,label:'创作留存率'},creativeMetrics.find(m=>m.key==='adoptionRate')!];
  const tierLabels:Record<string,string>={activeUv:'活跃 UV',creationUv:'创作 UV',creationPenetrationRate:'创作渗透率',avgCreationTaskCntPerCreator:'人均创作任务数'};
  const tierValue=(m:Record<string,number>)=>tierMetric==='creationPenetrationRate'?creativeRatio(m.creationUv,m.activeUv):tierMetric==='avgCreationTaskCntPerCreator'?creativeRatio(m.creationTaskCnt,m.activeUv):m[tierMetric]??null;
  const tierFormat=tierMetric==='creationPenetrationRate'?creativePct:creativeCompact;
  const columns:CreativeMetric[]=[
    ...creativeMetrics.filter(m=>['creationUserCnt','creationTaskCnt','validCreationTaskCnt','requestRate'].includes(m.key)),
    {key:'successTaskCnt',label:'成功任务',format:creativeCompact},
    ...creativeMetrics.filter(m=>['successRate','adoptionRate','d3Rate','d7Rate','d30Rate','d3CreationUserCnt','d7CreationUserCnt','d30CreationUserCnt'].includes(m.key)),
  ];
  const aggregateWeek=(name:string,week:string)=>{
    const calendar=week===chain.comparison?.analysisPeriod?chain.comparisonDates?.analysis:chain.comparisonDates?.baseline;
    const points=filter(name).flatMap(f=>f.daily).filter(p=>calendar?calendar.includes(p.period):p.period>=week&&p.period<new Date(Date.parse(week)+7*86400000).toISOString().slice(0,10));
    const days=(week===chain.comparison?.analysisPeriod?chain.comparison.analysisPeriodDays:chain.comparison?.baselinePeriodDays)??calendar?.length??new Set(points.map(p=>p.period)).size;
    return creativeWeeklyPoint(points,week,asOf,days);
  };
  return <div className="op-dashboard op-creative-dashboard"><div className="op-stats">{stats.map((metric,i)=>{
    const point=i===2?retentionPoint:visibleTrend.at(-1),baseline=point?allTrend.find(p=>p.period===creativeWeekBefore(point.period)):undefined;
    return <CreativeMetricCard key={metric.key} metric={metric} point={point} baseline={baseline} trend={i===2?retentionTrend:visibleTrend} controls={i===2?<Picker label="创作留存窗口" value={retentionHorizon} onChange={setRetentionHorizon} items={['3','7','30'].map(value=>({value,label:`D${value}`}))}/>:undefined}/>;
  })}</div>
    <div className="op-creative-grid"><section className="op-panel op-balance-panel"><header className="op-heading"><h2>创作趋势</h2><Picker label="创作趋势指标" value={metricKey} onChange={setMetricKey} items={creativeMetrics.map(m=>({value:m.key,label:m.label}))}/></header>{last?<BalanceChart key={metricKey} className="op-balance" title={selected.label} icon={null} totalLabel={last.period} valueLabel={selected.label} formatValue={selected.format} formatChange={n=>!before?.[selected.key]?'—':`${n>=0?'+':'−'}${Math.abs(n).toFixed(2)}%`} years={[{value:'range',label:`${date(valid[0].period)} – ${date(last.period)}`,total:last[selected.key]!,change:!before?.[selected.key]?0:(last[selected.key]!/before[selected.key]!-1)*100,changeLabel:'较上周同期',months:valid.map(p=>({label:date(p.period),value:p[selected.key]!})),defaultMonth:valid.length-1}]}/>:<Empty>{selected.key.startsWith('d')?'暂无成熟留存窗口':'暂无该指标数据'}</Empty>}</section>
      <section className="op-panel"><header className="op-heading"><h2>创作分层</h2><div className="op-tier-actions"><WeekComparisonPicker className="op-inline-week-picker" {...tierWeeks} availableWeeks={availableWeeks} onWeekChange={value=>onTierWeeksChange({...tierWeeks,...value})}/><Picker label="创作分层指标" value={tierMetric} onChange={setTierMetric} items={Object.entries(tierLabels).map(([value,label])=>({value,label}))}/></div></header><div className="op-table-scroll"><table className="op-table op-tier-table"><thead><tr><th>近30日创作次数</th><th>基准周</th><th>分析周</th><th>周环比</th></tr></thead><tbody>{[...(data?.items??[])].sort((a,b)=>Object.keys(labels).indexOf(a.key)-Object.keys(labels).indexOf(b.key)).map(item=>{const v=tierValue(item.metrics),b=tierValue(item.previousMetrics);return <tr key={item.key}><th>{labels[item.key]??item.key}</th><td>{b==null?'—':tierFormat(b)}</td><td>{v==null?'—':tierFormat(v)}</td><td><CreativeDelta value={v} baseline={b}/></td></tr>;})}</tbody></table></div></section></div>
    <section className="op-panel"><header className="op-heading"><h2>功能表现</h2><Tabs label="功能表现粒度" value={mode} onChange={setMode} items={[["day","日"],["week","周对比"]]}/></header><div className="op-filters">{mode==='day'&&<Picker label="创作功能" searchable value={activeName} onChange={value=>{setFunctionName(value);if(value==='__overall__'){setUserType('all');setPayGroup('all');setPayTier('all');}}} items={[{value:'__overall__',label:'汇总'},...names.map(value=>({value,label:value}))]}/>}<Picker label="功能注册用户类型" disabled={mode==='day'&&activeName==='__overall__'} value={userType} onChange={setUserType} items={[{value:'all',label:'全部用户'},...users.map(value=>({value,label:value==='NEW'?'注册新用户':value==='OLD'?'注册老用户':value}))]}/><div className="op-pay-tier-control"><CreativePayTierPicker group={payGroup} tier={payTier} tiers={payTiers} disabled={mode==='day'&&activeName==='__overall__'} onChange={(group,tier)=>{setPayGroup(group);setPayTier(tier);}}/><Popover><PopoverTrigger asChild><button type="button" className="op-creative-formula-trigger op-tier-help" aria-label="30日付费分层口径">?</button></PopoverTrigger><PopoverContent className="op-creative-formula" align="end" side="bottom" sideOffset={6}><strong>30日付费分层</strong><p>按数据源的滚动 30 日累计付费金额分组，单位为美元。未付费单独成组；(0,10] 表示大于 $0、且不超过 $10，其他区间同理。</p><p>此筛选描述用户的历史付费分层，不是当前所选日期的收入。统计指标仍按所选日期计算。</p></PopoverContent></Popover></div>{mode==='week'&&<WeekComparisonPicker className="op-text-week-picker" {...featureWeeks} availableWeeks={availableWeeks} onWeekChange={value=>onFeatureWeeksChange({...featureWeeks,...value})} triggerText={
    comparisonRange(chain.comparisonDates?.analysis,chain.comparison?.analysisPeriod)+' / '+comparisonRange(chain.comparisonDates?.baseline,chain.comparison?.baselinePeriod)+' · 日均'
  }/>}</div>
      <div key={mode} className="op-table-scroll op-daily-scroll"><table className="op-table"><thead><tr><th>{mode==='day'?'日期':'功能'}</th>{columns.map(m=><th key={m.key}><CreativeMetricHeader metric={m}/></th>)}</tr></thead><tbody>{mode==='day'?daily.map(row=><tr key={row.period}><th>{row.period}</th>{columns.map(m=>{const value=row[m.key];return <td key={m.key}>{value==null?'—':m.format(value)}</td>;})}</tr>):chain.comparison?names.map(name=>{const c=aggregateWeek(name,chain.comparison!.analysisPeriod),b=aggregateWeek(name,chain.comparison!.baselinePeriod);return <tr key={name}><th>{name}</th>{columns.map(m=>{const cv=c[m.key],bv=b[m.key];return <td key={m.key} title={`基准周 ${bv==null?'—':m.format(bv)}`}><div>{cv==null?'—':m.format(cv)}</div><div className="op-table-delta"><CreativeDelta value={cv} baseline={bv} isRate={m.key.endsWith('Rate')}/></div></td>;})}</tr>;}):null}</tbody></table></div>
    </section>
  </div>;
}

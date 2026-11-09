import type { PaymentAnalysisResponse, PaymentRegistrationTrendResponse } from '../../../../shared/api.interface';

export type RegistrationDimension = 'userLifecycle' | 'countryTier' | 'regPlatform' | 'sku' | 'upgradeCombination' | 'creditAmount' | 'cycleTransition';
export const registrationDimensionLabels: Record<RegistrationDimension,string> = { userLifecycle:'注册新老',countryTier:'国家层级',regPlatform:'注册端',sku:'续订 SKU',upgradeCombination:'升级组合',creditAmount:'积分档位',cycleTransition:'周期组合' };
type RegistrationRow = PaymentRegistrationTrendResponse['rows'][number];
const baseDimensions: RegistrationDimension[] = ['userLifecycle','countryTier','regPlatform'];
export function registrationDimensions(payType: string): RegistrationDimension[] {
  const special:Record<string,RegistrationDimension> = {'自动续订':'sku','套餐升级':'upgradeCombination','积分包':'creditAmount','重置订阅周期':'cycleTransition'};
  return special[payType] ? [special[payType],...baseDimensions] : baseDimensions;
}
const known = (value?:string) => !!value && !['UNKNOWN','未知','其他'].includes(value);
const cycleLabel = (value?:string) => ({'月订':'月付','年订':'年付','周订':'周付',monthly:'月付',yearly:'年付',weekly:'周付'}[value ?? ''] ?? (known(value) ? value! : '周期未知'));
const creditsLabel = (value?:string) => known(value) && Number.isFinite(Number(value)) ? `${Number(value).toLocaleString('en-US')} 积分` : '积分未知';
export function formatRegistrationSku(sku?:string) {
  if (!known(sku)) return 'SKU 未知';
  // Warehouse SKU combo is tier_cycle_credits, not a product title (which can be just "Pro").
  const parts=sku!.split('_');
  if (parts.length===3 && /^\d+$/.test(parts[2])) return `${parts[0]} · ${creditsLabel(parts[2])} · ${cycleLabel(parts[1])}`;
  return sku!.replace(/_/g,' ').replace(/\b(monthly|yearly|weekly)\b/gi,value=>cycleLabel(value.toLowerCase()));
}
export function registrationLabel(row: RegistrationRow, dimension: RegistrationDimension): string {
  switch(dimension) {
    case 'userLifecycle':return ({NEW:'新用户',OLD:'老用户'}[row.userLifecycle] ?? '未知');
    case 'countryTier':return row.countryTier || '未知';
    case 'regPlatform':return ({WEB:'Web',IOS:'iOS',ANDROID:'Android',OTHER:'其他',UNKNOWN:'未知'}[row.regPlatform] ?? row.regPlatform) || '未知';
    case 'sku':return formatRegistrationSku(row.sku);
    case 'creditAmount':return creditsLabel(row.creditAmount);
    case 'upgradeCombination':return `${known(row.previousSku)?formatRegistrationSku(row.previousSku):'变更前未知'} → ${formatRegistrationSku(row.sku)}`;
    case 'cycleTransition':return known(row.previousPlanCycle) && row.previousPlanCycle===row.planCycle ? `${cycleLabel(row.planCycle)}内重置` : `${known(row.previousPlanCycle)?cycleLabel(row.previousPlanCycle):'变更前未知'} → ${cycleLabel(row.planCycle)}`;
  }
}

export function registrationBreakdown(data: PaymentAnalysisResponse, payType: string, dimension: RegistrationDimension) {
  if (!data.comparison || !data.registration?.verifiedPayTypes.includes(payType)) return null;
  const { analysisPeriod, baselinePeriod } = data.comparison;
  const offsets = (week: string) => new Set(data.revenues.filter(row => row.weekStart === week).map(row => Date.parse(row.period) - Date.parse(week)));
  const analysisOffsets = offsets(analysisPeriod), baselineOffsets = offsets(baselinePeriod);
  const matched = new Set([...analysisOffsets].filter(offset => baselineOffsets.has(offset)));
  if (!matched.size) return null;
  const groups = new Map<string, { key: string; baseline: number; analysis: number }>();
  for (const row of data.registration.rows) {
    if (row.payType !== payType || ![analysisPeriod, baselinePeriod].includes(row.weekStart) || !matched.has(Date.parse(row.period) - Date.parse(row.weekStart))) continue;
    const key = registrationLabel(row,dimension);
    const group = groups.get(key) ?? { key, baseline:0, analysis:0 };
    group[row.weekStart === analysisPeriod ? 'analysis' : 'baseline'] += row.gmvUsd / matched.size;
    groups.set(key, group);
  }
  return groups.size ? [...groups.values()].sort((a,b) => b.analysis-a.analysis || a.key.localeCompare(b.key)) : null;
}


/** Match the selected table layer exactly. Missing or unreconciled days stay null. */
export function registrationLayerTrend(history: PaymentRegistrationTrendResponse,dimension: RegistrationDimension,layer:string,gap:number,displayEnd:string) {
  const shift=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  const totals=new Map<string,number>();
  for(const row of history.rows)if(registrationLabel(row,dimension)===layer)totals.set(row.period,(totals.get(row.period) ?? 0)+row.gmvUsd);
  const valid=new Set(history.points.filter(point=>point.verified).map(point=>point.period));
  const value=(date:string)=>valid.has(date)?totals.get(date) ?? 0:null;
  return history.points.filter(point=>point.period>=shift(displayEnd,-29) && point.period<=displayEnd).map((point,day)=>({day,date:point.period,label:point.period.slice(5).replace('-','/'),analysis:value(point.period),baseline:value(shift(point.period,-gap)),cost:null,baselineCost:null}));
}

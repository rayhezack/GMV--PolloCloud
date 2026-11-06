import { ChevronRight } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { getChainFunnel } from '@/api/dashboard';
import { LOCAL_DATA_WINDOW } from '@/lib/local-data-window';
import LoadingWave from './LoadingWave';
import { Picker } from '@/components/bencho/Picker';
import { IconBar } from '@/components/bencho/IconBar';
import type { ChainFunnelGroup, ChainFunnelMetrics, ChainFunnelResponse, DashboardPlatform } from '@shared/api.interface';
import { comparableChannels, decomposeCount, decomposeRate, directionShare, netChangeShare, summarizeChanges } from './chain-diagnostics';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import './chain-workbench.css';

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const count = (n: number) => Math.round(n).toLocaleString('en-US');
const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const signed = (n: number, f: (n: number) => string) => `${n >= 0 ? '+' : '−'}${f(Math.abs(n))}`;
const deltaPct = (a: number, b: number) => b ? signed((a - b) / b, pct) : '—';
const tone = (n: number | null) => n == null || Math.abs(n) < 1e-10 ? '' : n > 0 ? 'cw-positive' : 'cw-negative';
const tierNames: Record<string, string> = { create_cnt_30d_0: '近30日未创作', 'create_cnt_30d_[1,11)': '近30日 1–10 次', 'create_cnt_30d_[11,31)': '近30日 11–30 次', 'create_cnt_30d_[31,101)': '近30日 31–100 次', 'create_cnt_30d_[101,+inf)': '近30日 101+ 次' };
const lifecycleNames: Record<string, string> = { NEW: '注册新用户', OLD: '注册老用户', UNKNOWN: '未知' };
const metricFormat = (key: string, value: number) => key.endsWith('Rate') ? pct(value) : key === 'aov' ? `$${value.toFixed(2)}` : count(value);
const changeFormat = (key: string, n: number) => key.endsWith('Rate') ? `${n >= 0 ? '+' : '−'}${(Math.abs(n) * 100).toFixed(2)}pp` : signed(n, v => metricFormat(key, v));
type Diagnosis = 'traffic' | 'conversion' | 'exposure';
type Detail = 'country' | 'PAYMENT_CHANNEL' | 'EXPOSE_TYPE' | 'EXPOSE_REASON';
const exposureName = (key: string) => ({ insufficient_credits: '积分不足', insufficient_permission: '权限不足', product_design: '产品设计触发', active: '主动打开', passive: '被动触发', unknown: '未记录', '未知': '未记录', '__MULTI__': '多种触发（去重归类）' }[key] ?? key);
const channelName = (key: string) => ({ stripe: 'Stripe', payinsider: 'PayInsider', paypal: 'PayPal', '未知': '未记录渠道', unknown: '未记录渠道' }[key.toLowerCase()] ?? key);

const shareText = (effect: number, net: number) => {
  const share = directionShare(effect, net);
  return share == null ? '—' : signed(share, pct);
};
const pp = (n: number) => changeFormat('payRate', n);

function ContributionHeading({ method }: { method: 'dimension' | 'chain' }) {
  return <Tooltip><TooltipTrigger asChild><button type="button" className="cw-formula-trigger" aria-label={method === 'dimension' ? '贡献度：维度下钻口径' : '贡献度：链路拆解口径'}>贡献度</button></TooltipTrigger>
    <TooltipContent className="cw-formula-tooltip" side="bottom" align="end" sideOffset={8}>
      <strong>{method === 'dimension' ? '贡献度 · 维度下钻' : '贡献度 · 链路拆解'}</strong>
      {method === 'dimension' ? <p>该分组日均 GMV 增量 ÷ |父层日均 GMV 净增量| × 100%。一级分组对比全部用户，展开后的子分组对比所在父分组。</p> : <><p>GMV = DAU × 付费墙曝光率 × 付费墙提交率 × 提交支付率 × 客单价。</p><p>采用 LMDI 对数平均分解：正值因子的影响 = 两期日均 GMV 的对数平均 × ln(分析期因子 ÷ 基准期因子)，各项影响之和等于 GMV 净增量。贡献度 = 该影响 ÷ |所选人群日均 GMV 净增量| × 100%。</p><p>零值采用同一 ε 趋零的极限：仅一期 GMV 为零时，增减量均分给该期为零的因子；两期 GMV 均为零时各项影响为零。这是约定下的核算分解，不代表因果。</p></>}
      <p>正值拉高 GMV，负值拉低 GMV；合计为增长时 +100%、下降时 −100%。增减相抵时，单项可超过 100%；净增量为零时显示“—”。</p>
    </TooltipContent>
  </Tooltip>;
}

function RateDiagnosis({ result, label, dimensionLabel, weightLabel }: { result: ReturnType<typeof decomposeRate>; label: string; dimensionLabel: string; weightLabel: string }) {
  if (!result.valid || result.delta == null) return <p className="cw-data-note">{result.reason}</p>;
  const { baselineRate, currentRate, delta, structure, efficiency, groups } = result;
  const strongest = (key: 'efficiency' | 'structure') => [...groups].filter(g => Math.abs(g[key]) > 1e-10).sort((a, b) => Math.abs(b[key]) - Math.abs(a[key])).slice(0, 2);
  const dominant = Math.abs(efficiency) >= Math.abs(structure) ? `细分${label}变化` : '人群占比变化';
  const action = (n: number) => n > 1e-10 ? '拉动' : n < -1e-10 ? '拖累' : '影响';
  return <>
    <p className="cw-conclusion cw-core-conclusion"><strong>{label}{delta > 0 ? '上升' : delta < 0 ? '下降' : '持平'}{Math.abs(delta) > 1e-10 ? ` ${pp(Math.abs(delta)).slice(1)}` : ''}，{Math.abs(delta) > 1e-10 ? `主要来自${dominant}` : '结构与效率变化相抵'}。</strong> 当前 {pct(currentRate!)}，基准 {pct(baselineRate!)}。</p>
    <div className="cw-effect-summary">{[{ label: '效率变化', value: efficiency, meaning: `同一分层自身${label}的变化` }, { label: '结构变化', value: structure, meaning: `${weightLabel}向${label}较高／较低的分层转移` }].map(effect => <article key={effect.label}>
      <span>{effect.label}<small>{effect.meaning}</small></span><strong className={tone(effect.value)}>{pp(effect.value)}</strong>
      <span>{action(effect.value)}大盘 · 方向贡献 <b className={tone(effect.value)}>{shareText(effect.value, delta)}</b></span>
    </article>)}</div>
    <div className="cw-reasoning">
      <p><strong>效率侧{action(efficiency)} {pp(efficiency)}，贡献 {shareText(efficiency, delta)}：</strong>{strongest('efficiency').length ? strongest('efficiency').map((g, i) => <span key={g.key}>{i ? '；其次是' : '主要是'}{g.label}，自身{label}从 {pct(g.rate0!)} {g.rate1! >= g.rate0! ? '升至' : '降至'} {pct(g.rate1!)}，{action(g.efficiency)}大盘 <b className={tone(g.efficiency)}>{pp(g.efficiency)}</b>（占效率净变化 {shareText(g.efficiency, efficiency)}）</span>) : `各分层自身${label}没有净影响`}。</p>
      <p><strong>结构侧{action(structure)} {pp(structure)}，贡献 {shareText(structure, delta)}：</strong>{strongest('structure').length ? strongest('structure').map((g, i) => <span key={g.key}>{i ? '；' : ''}{label}{(g.rate0! + g.rate1!) / 2 >= (baselineRate! + currentRate!) / 2 ? '较高' : '较低'}的{g.label}，{weightLabel}占比从 {pct(g.w0)} {g.w1 >= g.w0 ? '升至' : '降至'} {pct(g.w1)}，{action(g.structure)}大盘 <b className={tone(g.structure)}>{pp(g.structure)}</b></span>) : '分母人群占比变化没有净影响'}。</p>
    </div>
    {result.simpson && <p className="cw-data-note">辛普森反转：所有可比细分自身{label}的变化与大盘方向相反，整体变化由人群占比转移主导。</p>}
    <div className="cw-scroll"><table className="cw-table"><thead><tr><th>{dimensionLabel}</th><th>基准{weightLabel}占比</th><th>分析{weightLabel}占比</th><th>基准率</th><th>分析率</th><th>效率影响</th><th>结构影响</th><th>效率方向贡献</th><th>结构方向贡献</th></tr></thead><tbody>{groups.map(g => <tr key={g.key}>
      <th>{g.label}</th><td>{pct(g.w0)}</td><td>{pct(g.w1)}</td><td>{g.rate0 == null ? '—' : pct(g.rate0)}</td><td>{g.rate1 == null ? '—' : pct(g.rate1)}</td><td className={tone(g.efficiency)}>{pp(g.efficiency)}</td><td className={tone(g.structure)}>{pp(g.structure)}</td><td className={tone(g.efficiency)}>{shareText(g.efficiency, delta)}</td><td className={tone(g.structure)}>{shareText(g.structure, delta)}</td>
    </tr>)}</tbody></table></div>
    <p className="cw-data-note cw-method-note">效率影响 + 结构影响 = 大盘净变化。结构以大盘两期平均{label}为参照：{label}较高的分层占比上升为拉动，{label}较低的分层占比上升为拖累。方向贡献按影响 ÷ |净变化| 计算。</p>
  </>;
}

function ExposureDiagnosis({ rows, parent, label, rateChange }: { rows: ChainFunnelGroup[]; parent: ChainFunnelGroup; label: string; rateChange: number }) {
  const result = decomposeCount(rows.map(g => ({ key: g.key, label: exposureName(g.label), baseline: g.baseline.exposeUv, current: g.current.exposeUv })), { baseline: parent.baseline.exposeUv, current: parent.current.exposeUv });
  const impacts = summarizeChanges(result.groups);
  const lift = impacts.lifts[0], drag = impacts.drags[0];
  return <>
    <p className="cw-conclusion cw-core-conclusion"><strong>每天{result.delta >= 0 ? '多' : '少'}曝光 {count(Math.abs(result.delta))} 人{(result.delta >= 0 ? lift : drag) ? `，主要来自${(result.delta >= 0 ? lift : drag)!.label}` : ''}。</strong>{lift && drag ? `${lift.label}增加 ${count(lift.change)} 人，${drag.label}减少 ${count(Math.abs(drag.change))} 人，部分相互抵消。` : ''}</p>
    <p className="cw-data-note">大盘曝光率变化 {pp(rateChange)}；这里按{label}拆解曝光 UV 的增减。未曝光用户没有曝光原因，不按此维度拆 DAU，也不拆结构与效率。</p>
    {!result.valid && <p className="cw-data-note">此维度未通过曝光 UV 合计校验，暂不显示贡献度。</p>}
    <div className="cw-scroll"><table className="cw-table"><thead><tr><th>{label}</th><th>基准日均曝光 UV</th><th>分析日均曝光 UV</th><th>每天增减</th><th>周环比</th><th>曝光 UV 方向贡献</th></tr></thead><tbody>
      <tr className="cw-total"><th>合计</th><td>{count(parent.baseline.exposeUv)}</td><td>{count(parent.current.exposeUv)}</td><td className={tone(result.delta)}>{signed(result.delta, count)}</td><td className={tone(result.delta)}>{deltaPct(parent.current.exposeUv, parent.baseline.exposeUv)}</td><td className={tone(result.delta)}>{result.valid ? shareText(result.delta, result.delta) : '—'}</td></tr>
      {[...result.groups].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).map(g => <tr key={g.key}><th>{g.label}</th><td>{count(g.baseline)}</td><td>{count(g.current)}</td><td className={tone(g.change)}>{signed(g.change, count)}</td><td className={tone(g.change)}>{deltaPct(g.current, g.baseline)}</td><td className={tone(g.contribution)}>{g.contribution == null ? '—' : signed(g.contribution, pct)}</td></tr>)}
    </tbody></table></div>
    <p className="cw-data-note cw-method-note">贡献 = 该分类曝光 UV 增减 ÷ |总曝光 UV 净变化|。分类之间有增有减时，单项贡献可超过 100%；人数显示取整，贡献使用原始精度。</p>
  </>;
}

function GmvRow({ row, label, selected, onSelect, denominator, child = false, total = false }: { row: ChainFunnelGroup; label: string; selected: boolean; onSelect: () => void; denominator: number; child?: boolean; total?: boolean }) {
  const contribution = directionShare(row.gmvChange, denominator);
  return <tr className={`${selected ? 'cw-selected' : ''}${child ? ' cw-child' : ''}${total ? ' cw-total' : ''}`}><th scope="row"><button type="button" onClick={onSelect} aria-pressed={selected} className={total ? undefined : "cw-drill-trigger"}>{label}{!total&&<ChevronRight aria-hidden="true" size={14} className={selected ? "is-expanded" : undefined}/>}</button></th><td>{money(row.baseline.gmvUsd)}</td><td>{money(row.current.gmvUsd)}</td><td className={tone(row.gmvChange)}>{signed(row.gmvChange, money)}</td><td className={tone(row.gmvChange)}>{deltaPct(row.current.gmvUsd, row.baseline.gmvUsd)}</td><td className={tone(contribution)}>{contribution == null ? '—' : signed(contribution, pct)}</td></tr>;
}
export function ChainWorkbench({ data, selectedTier, selectedLifecycle, platform, deviceType, refreshToken, onTierChange, onLifecycleChange, onReset, onAds }: {
  data: ChainFunnelResponse; selectedTier: string; selectedLifecycle: string; platform: DashboardPlatform; deviceType?: 'ios' | 'android'; refreshToken: number;
  onTierChange: (key: string) => void; onLifecycleChange: (key: string) => void; onReset: () => void; onAds: () => void;
}) {
  const [dimension, setDimension] = useState('tier');
  const [scoped, setScoped] = useState<{ key: string; data: ChainFunnelResponse } | null>(null);
  const [diagnosis, setDiagnosis] = useState<Diagnosis | null>(null);
  const diagnosisId = useId();
  const [detail, setDetail] = useState<Detail>('country');
  const [drillError, setDrillError] = useState(false);
  const scopeKey = `${selectedTier}|${selectedLifecycle}|${refreshToken}|${data.comparison?.analysisPeriod}|${data.comparison?.baselinePeriod}|${platform}|${deviceType}`;
  const isAll = selectedTier === 'all' && selectedLifecycle === 'all';
  const active = isAll ? data : scoped?.key === scopeKey ? scoped.data : null;
  useEffect(() => {
    setDrillError(false);
    if (isAll || !data.comparison) return;
    let cancelled = false;
    const { baselinePeriod, analysisPeriod } = data.comparison;
    getChainFunnel({ platform, deviceType, baselinePeriod, analysisPeriod, startDate: LOCAL_DATA_WINDOW?.startDate ?? baselinePeriod, endDate: LOCAL_DATA_WINDOW?.endDate ?? analysisPeriod, creationTier: selectedTier, userLifecycle: selectedLifecycle, cacheBust: refreshToken || undefined }).then(result => {
      if (!cancelled) { setScoped({ key: scopeKey, data: result }); setDrillError(!result.ready); }
    }).catch(() => { if (!cancelled) setDrillError(true); });
    return () => { cancelled = true; };
  }, [scopeKey, data, isAll, platform, deviceType, selectedTier, selectedLifecycle, refreshToken]);
  const [branch, setBranch] = useState<{ key: string; data: ChainFunnelResponse } | null>(null);
  const branchValue = dimension === 'tier' ? selectedTier : selectedLifecycle;
  const branchKey = `${dimension}|${branchValue}|${scopeKey}`;
  useEffect(() => {
    if (branchValue === 'all' || !data.comparison) return;
    let cancelled = false;
    getChainFunnel({ platform, deviceType, ...data.comparison, startDate: LOCAL_DATA_WINDOW?.startDate ?? data.comparison.baselinePeriod, endDate: LOCAL_DATA_WINDOW?.endDate ?? data.comparison.analysisPeriod, creationTier: dimension === 'tier' ? selectedTier : 'all', userLifecycle: dimension === 'lifecycle' ? selectedLifecycle : 'all', cacheBust: refreshToken || undefined }).then(result => { if (!cancelled) setBranch({ key: branchKey, data: result }); }).catch(() => { if (!cancelled) setBranch(null); });
    return () => { cancelled = true; };
  }, [branchKey]);
  const tierOrder = Object.keys(tierNames);
  const lifecycleOrder = Object.keys(lifecycleNames);
  const ordered = (groups: ChainFunnelGroup[], order: string[]) => [...groups].sort((a,b) => {
    const aIndex = order.indexOf(a.key), bIndex = order.indexOf(b.key);
    return (aIndex < 0 ? order.length : aIndex) - (bIndex < 0 ? order.length : bIndex);
  });
  const rows = dimension === 'tier' ? ordered(data.tiers, tierOrder) : ordered(data.lifecycles, lifecycleOrder);
  const children = branch?.key === branchKey ? (dimension === 'tier' ? ordered(branch.data.lifecycles, lifecycleOrder) : ordered(branch.data.tiers, tierOrder)) : [];
  const rootDelta = data.totals?.gmvChange ?? 0;
  useEffect(() => { setDiagnosis(null); }, [scopeKey]);
  const openDiagnosis = (key: Diagnosis) => {
    setDiagnosis(previous => previous === key ? null : key);
    if (diagnosis !== key) setDetail(key === 'exposure' ? 'EXPOSE_REASON' : 'country');
  };
  const drivers = active?.drivers ?? [];
  const netGmv = active?.totals?.gmvChange ?? 0;
  const driverShare = (ratio: number | null) => ratio == null || Math.abs(netGmv) <= 1e-10 ? null : ratio * Math.sign(netGmv);
  // Channel choice is observed at submission; keep both numerator and denominator in that same cohort.
  const details = diagnosis === 'traffic' || detail === 'country' ? active?.countries ?? [] : active?.breakdowns[detail === 'PAYMENT_CHANNEL' ? 'SUBMIT_CHANNEL' : detail] ?? [];
  const atomicKey: keyof ChainFunnelMetrics = diagnosis === 'traffic' ? 'activeUv' : 'exposeUv';
  const changes = summarizeChanges(details.map(g => ({ label: g.label, change: g.current[atomicKey] - g.baseline[atomicKey] })));
  const totalMetrics = active?.totals;
  const rateAtoms = (metrics: ChainFunnelMetrics) => ({ numerator: diagnosis === 'exposure' ? metrics.exposeUv : metrics.payUv, denominator: diagnosis === 'exposure' ? metrics.activeUv : metrics.submitUv });
  const rateRows = details.map(g => ({ key: g.key, label: detail === 'PAYMENT_CHANNEL' ? channelName(g.label) : g.label, baseline: rateAtoms(g.baseline), current: rateAtoms(g.current) }));
  const channels = detail === 'PAYMENT_CHANNEL' ? comparableChannels(rateRows) : { rows: rateRows, pooled: [] };
  const rateAnalysis = totalMetrics ? decomposeRate(channels.rows, { baseline: rateAtoms(totalMetrics.baseline), current: rateAtoms(totalMetrics.current) }) : null;
  const isExposureCount = diagnosis === 'exposure' && detail !== 'country';
  const canDecompose = diagnosis !== 'traffic' && !isExposureCount && rateAnalysis?.valid;
  const trafficConclusion = Math.abs(changes.net) <= 1e-10
    ? `日均活跃人数持平${changes.drags.length || changes.lifts.length ? '，国家分组增减相抵' : ''}。`
    : `日均活跃人数每天${changes.net < 0 ? '少' : '多'} ${count(Math.abs(changes.net))} 人${changes.top.length ? `，其中 ${changes.top.map(g => g.label).join(' + ')} 合计${changes.net < 0 ? '少' : '多'} ${count(Math.abs(changes.topEffect))} 人，占净${changes.net < 0 ? '减少' : '增加'} ${pct(Math.abs(changes.topShare!))}` : ''}。`;
  const diagnosticCards = [
    { key: 'traffic' as const, title: '国家活跃人数', metric: 'activeUv' },
    { key: 'exposure' as const, title: '付费墙曝光', metric: 'exposeRate' },
    { key: 'conversion' as const, title: '支付转化', metric: 'payRate' },
  ];
  const dates=data.comparisonDates;
  const range=(values:string[])=>`${values[0].slice(5).replace('-','/')}–${values.at(-1)!.slice(5).replace('-','/')}`;
  const chosenTitle = [selectedTier !== 'all' ? tierNames[selectedTier] ?? selectedTier : '全部创作分层', selectedLifecycle !== 'all' ? lifecycleNames[selectedLifecycle] ?? selectedLifecycle : '全部用户'].join(' · ');
  return <div className="cw-workbench">
    <section><header className="cw-heading"><h2>GMV 分层</h2><IconBar label="GMV 分层维度" value={dimension} onChange={setDimension} items={[{value:'tier',label:'创作分层'},{value:'lifecycle',label:'注册新老'}]}/></header>
      <div className="cw-scroll"><table className="cw-table"><thead><tr><th>{dimension === 'tier' ? '创作分层' : '注册新老'}</th><th>基准周日均 GMV</th><th>分析周日均 GMV</th><th>日均增量</th><th>周环比</th><th><ContributionHeading method="dimension" /></th></tr></thead><tbody>
        {data.totals && <GmvRow row={data.totals} denominator={rootDelta} total label="合计" selected={isAll} onSelect={onReset} />}
        </tbody>{rows.map(row => <tbody key={row.key} className="cw-branch"><GmvRow row={row} denominator={rootDelta} label={dimension === 'tier' ? tierNames[row.key] ?? row.label : lifecycleNames[row.key] ?? row.label} selected={row.key === branchValue} onSelect={() => dimension === 'tier' ? onTierChange(row.key) : onLifecycleChange(row.key === selectedLifecycle ? 'all' : row.key)} />{row.key === branchValue && children.map(child => <GmvRow key={child.key} child row={child} denominator={row.gmvChange} label={dimension === 'tier' ? lifecycleNames[child.key] ?? child.label : tierNames[child.key] ?? child.label} selected={dimension === 'tier' ? child.key === selectedLifecycle : child.key === selectedTier} onSelect={() => dimension === 'tier' ? onLifecycleChange(child.key === selectedLifecycle ? 'all' : child.key) : onTierChange(child.key)} />)}</tbody>)}
      </table></div>
    </section>
    <section><header className="cw-heading"><h2>支付链路归因</h2><span>{chosenTitle}{dates?.analysis.length&&dates?.baseline.length?` · ${range(dates.analysis)} / ${range(dates.baseline)}`:""}</span></header>
      {!active?.ready ? <div className="cw-loading">{drillError ? '下钻数据读取失败' : <LoadingWave label="读取链路数据" />}</div> : <div className="cw-scroll"><table className="cw-table"><thead><tr><th>过程因子</th><th>基准周</th><th>分析周</th><th>绝对变化</th><th>周环比</th><th><ContributionHeading method="chain" /></th></tr></thead><tbody>{drivers.map(d => <tr key={d.metricKey}><th>{d.metric}</th><td>{metricFormat(d.metricKey, d.baseline)}</td><td>{metricFormat(d.metricKey, d.current)}</td><td className={tone(d.change)}>{changeFormat(d.metricKey, d.change)}</td><td className={tone(d.wowChange)}>{d.wowChange == null ? '—' : signed(d.wowChange, pct)}</td><td className={tone(driverShare(d.contribution))}>{driverShare(d.contribution) == null ? '—' : signed(driverShare(d.contribution)!, pct)}</td></tr>)}</tbody></table></div>}
    </section>
    {active?.ready && <section><header className="cw-heading"><h2>下钻诊断</h2><span>绿色为拉动，红色为拖累 · 方向贡献按净变化绝对值计算</span></header>
      <div className="cw-diagnostics" aria-label="下钻诊断">{diagnosticCards.map(card => {
        const driver = drivers.find(d => d.metricKey === card.metric);
        const share = driverShare(driver?.contribution ?? null);
        const expanded = diagnosis === card.key;
        return <button key={card.key} type="button" id={`${diagnosisId}-${card.key}`} aria-expanded={expanded} aria-controls={`${diagnosisId}-panel`} className="cw-diagnostic" onClick={() => openDiagnosis(card.key)}>
          <span className="cw-diagnostic-title">{card.title}<span aria-hidden="true">{expanded ? '−' : '+'}</span></span>
          <strong>{driver ? metricFormat(driver.metricKey, driver.current) : '—'}</strong><span className={`cw-diagnostic-change ${tone(driver?.change ?? null)}`}>{driver ? changeFormat(driver.metricKey, driver.change) : '—'}</span>
          <span className="cw-card-contribution">GMV 方向贡献 <b className={tone(share)}>{share == null ? '—' : signed(share, pct)}</b></span>
          <span className="cw-card-action">{expanded ? '点击收起诊断' : '点击展开诊断'}</span>
        </button>;
      })}</div>
      {diagnosis && <div className="cw-detail" id={`${diagnosisId}-panel`} role="region" aria-labelledby={`${diagnosisId}-${diagnosis}`}>
        <header className="cw-heading"><h3>{diagnosis === 'traffic' ? '国家活跃人数变化' : diagnosis === 'conversion' ? '提交支付率诊断' : isExposureCount ? '曝光 UV 变化' : '付费墙曝光率诊断'}</h3><div className="cw-detail-controls">{diagnosis !== 'traffic' && <Picker label="诊断维度" value={detail} onChange={v => setDetail(v as Detail)} items={(diagnosis === 'conversion' ? [['country', '国家'], ['PAYMENT_CHANNEL', '支付渠道']] : [['EXPOSE_REASON', '曝光原因'], ['EXPOSE_TYPE', '曝光类型'], ['country', '国家']]).map(([value, label]) => ({ value, label }))} />}<button type="button" className="cw-collapse" onClick={() => setDiagnosis(null)}>收起诊断</button></div></header>
        {diagnosis === 'traffic' ? <>
          <p className="cw-conclusion"><strong>{trafficConclusion}</strong></p>
          <div className="cw-traffic-summary">{[{ title: '主要驱动', row: changes.net < 0 ? changes.drags[0] : changes.lifts[0] }, { title: '反向抵消', row: changes.net < 0 ? changes.lifts[0] : changes.drags[0] }].map(item => <article key={item.title}><span>{item.title}</span><strong className={tone(item.row?.change ?? null)}>{item.row ? `${item.row.label} ${signed(item.row.change, count)} 人/天` : '无'}</strong></article>)}</div>
          <p className="cw-data-note">这是日均活跃人数下降或增长，不能仅凭 DAU 断言渠道流量占比变差；需结合各渠道人数、占比及转化继续核验。</p>
        </> : isExposureCount && totalMetrics ? <ExposureDiagnosis rows={details} parent={totalMetrics} label={detail === 'EXPOSE_TYPE' ? '曝光类型' : '曝光原因'} rateChange={totalMetrics.current.exposeRate - totalMetrics.baseline.exposeRate} /> : canDecompose && rateAnalysis ? <>
          <RateDiagnosis result={rateAnalysis} label={diagnosis === 'exposure' ? '付费墙曝光率' : '提交支付率'} dimensionLabel={detail === 'country' ? '国家分层' : '支付渠道'} weightLabel={diagnosis === 'exposure' ? '活跃人数' : '提交人数'} />
          {detail === 'PAYMENT_CHANNEL' && <p className="cw-data-note">按用户提交支付时选择的支付渠道分组，支付 UV 与提交 UV 属于同一批分组用户。{channels.pooled.length ? `其他合并${channels.pooled.join('、')}，避免为仅单期出现的渠道虚构基准提交支付率；合计人数保持一致。` : ''}</p>}
        </> : <>
          <p className="cw-conclusion">{diagnosis === 'conversion' ? '当前明细不足以解释整体提交支付率变化。' : '当前曝光分类仅支持人数变化定位。'}</p>
          <p className="cw-data-note">{rateAnalysis?.reason}</p>
        </>}
        {(diagnosis === 'traffic' || (!canDecompose && !isExposureCount)) && <div className="cw-scroll"><table className="cw-table"><thead><tr><th>{detail === 'country' || diagnosis === 'traffic' ? '国家分层' : '分类'}</th><th>基准日均人数</th><th>分析日均人数</th><th>人数变化</th><th>周环比</th><th>{diagnosis === 'conversion' ? '日均 GMV 增量' : '变化贡献度'}</th></tr></thead><tbody>{details.map(g => {
          const key = diagnosis === 'conversion' ? 'payUv' : atomicKey;
          const c = g.current[key], b = g.baseline[key];
          return <tr key={g.key}><th>{g.label}</th><td>{count(b)}</td><td>{count(c)}</td><td className={tone(c - b)}>{signed(c - b, count)}</td><td className={tone(c - b)}>{deltaPct(c, b)}</td><td className={tone(diagnosis === 'conversion' ? g.gmvChange : netChangeShare(c - b, changes.net))}>{diagnosis === 'conversion' ? signed(g.gmvChange, money) : diagnosis === 'traffic' ? netChangeShare(c - b, changes.net) == null ? '—' : signed(netChangeShare(c - b, changes.net)!, pct) : '—'}</td></tr>;
        })}</tbody></table></div>}
        {diagnosis === 'traffic' && <p className="cw-data-note">变化贡献度 = 分层人数变化 ÷ 整体人数变化；{Math.abs(changes.net) <= 1e-10 ? '净变化为 0 时不计算' : '合计 100%'}。正值为本次变化的驱动，负值为反向抵消。</p>}
        {diagnosis === 'traffic' && <button type="button" className="cw-analysis-link" onClick={onAds}>查看广告侧渠道分布 →</button>}
        {!details.length && <div className="cw-loading">暂无此维度数据</div>}
      </div>}
    </section>}

  </div>;
}

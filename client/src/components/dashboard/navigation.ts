import { getBusinessWeekStart } from '../../../../shared/business-week.ts';
export const DASHBOARD_VIEWS = [
  {
    id: 'trend',
    label: 'GMV 趋势',
    description: '从总体趋势出发，定位收入变化。',
    icon: 'chart-line',
  },
  {
    id: 'payment',
    label: '付费类型',
    description: '查看主动付费与自动续订的增量贡献。',
    icon: 'credit-card',
  },
  {
    id: 'chain',
    label: '支付链路',
    description: '从 GMV 驱动下钻到支付漏斗、国家结构与渠道效率。',
    icon: 'link',
  },
  {
    id: 'creative',
    label: '创作积极性',
    description: '创作 UV、任务数按业务日均展示，渗透率为创作 UV ÷ 活跃 UV；分层按分析期开始前 30 日创作次数划分。',
    icon: 'paintbrush',
  },
  {
    id: 'ads',
    label: '付费广告',
    description: '从国家结构继续查看广告点击变化。',
    icon: 'megaphone',
  },
  {
    id: 'details',
    label: '明细数据',
    description: '查看核心数据集每日数据。',
    icon: 'table',
  },
  {
    id: 'report',
    label: '诊断报告',
    description: '从核心结论到证据，回溯完整业务周的变化。',
    icon: 'file-chart',
  },
  {
    id: 'data',
    label: '数据与口径',
    description: '先看覆盖差异，再核对统计窗口和各指标定义。',
    icon: 'database',
  },
] as const;

export function dashboardView(pathname: string, search: string) {
  const id = pathname.endsWith('/report') ? 'report' : new URLSearchParams(search).get('tab');
  return DASHBOARD_VIEWS.find((view) => view.id === id) ?? DASHBOARD_VIEWS[0];
}

export const GLOBAL_PARAMS = ['platform', 'deviceType'] as const;
export function dashboardHref(id: string, search: string) {
  const current = new URLSearchParams(search),
    params = new URLSearchParams({ tab: id });
  for (const key of GLOBAL_PARAMS) {
    const value = current.get(key);
    if (value && (key !== 'deviceType' || (current.get('platform') === 'app' && ['ios', 'android'].includes(value))))
      params.set(key, value);
  }
  return `${id === 'report' ? '/report' : '/'}?${params}`;
}
export function chainContextHref({
  platform,
  analysisDate,
  baselineDate,
  chainType,
  deviceType,
  factor,
}: {
  platform: string;
  analysisDate: string;
  baselineDate: string;
  chainType: string;
  deviceType?: string;
  factor?: string;
}) {
  const params = new URLSearchParams({ tab: 'chain', platform, mode: 'day', analysisDate, baselineDate, chainType });
  if (factor) {
    params.set('mode', 'week');
    params.set('analysisWeek', getBusinessWeekStart(analysisDate));
    params.set('baselineWeek', getBusinessWeekStart(baselineDate));
    params.set('factor', factor);
    params.delete('analysisDate');
    params.delete('baselineDate');
  }
  if (platform === 'app' && deviceType && ['ios', 'android'].includes(deviceType)) params.set('deviceType', deviceType);
  return `/?${params}${factor ? '#chain-factors' : ''}`;
}
export function paymentContextHref({
  platform,
  date,
  deviceType,
  payType,
  income,
}: {
  platform: string;
  date: string;
  deviceType?: string;
  payType?: string;
  income?: 'ALL' | 'ACTIVE_PAYMENT' | 'AUTO_RENEWAL';
}) {
  const analysisWeek = getBusinessWeekStart(date);
  const baselineWeek = new Date(Date.parse(analysisWeek + 'T00:00:00Z') - 7 * 86400000).toISOString().slice(0, 10);
  const params = new URLSearchParams({ tab: 'payment', platform, analysisWeek, baselineWeek });
  if (payType) params.set('focusPayType', payType);
  if (income) params.set('income', income);
  if (platform === 'app' && deviceType && ['ios', 'android'].includes(deviceType)) params.set('deviceType', deviceType);
  return `/?${params}`;
}

export function anomalyDashboardHref(
  search: string,
  alert: { platform: string; metric: string; period: string; window: string },
  visibleWindow: { startDate: string; endDate: string },
) {
  const params = new URLSearchParams(search);
  for (const [key, value] of Object.entries({
    tab: 'trend',
    platform: alert.platform,
    granularity: 'day',
    focusMetric: alert.metric,
    focusPlatform: alert.platform,
    focusPeriod: alert.period,
    focusWindow: alert.window,
  }))
    params.set(key, value);
  // The observation must be in the chart's visible range, not just its source data.
  if (alert.period < visibleWindow.startDate || alert.period > visibleWindow.endDate) {
    const start = new Date(`${alert.period}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - 29);
    params.set('trendStartDate', start.toISOString().slice(0, 10));
    params.set('trendEndDate', alert.period);
  }
  params.delete('deviceType');
  return `/?${params.toString()}`;
}

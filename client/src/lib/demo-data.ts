import type {
  AttributionDimension,
  DashboardPlatform,
  DashboardAttributionsResponse,
  DashboardGmvCoverageResponse,
  DashboardOverviewResponse,
  OverviewTrendPoint,
  Platform,
  Granularity,
  PaymentChainType,
  RenewalPlanTier,
  SyncRunStatus,
} from '@shared/api.interface';
import { getBusinessWeekStart } from '@shared/business-week';

export const STATIC_DEMO_MODE = import.meta.env.VITE_DATA_MODE === 'demo';

const demoStart = Date.UTC(2026, 0, 1);
const demoEnd = Date.UTC(2026, 9, 9);
const demoIndexOffset = (Date.UTC(2026, 8, 12) - demoStart) / 86400000;
const days = Array.from({ length: (demoEnd - demoStart) / 86400000 + 1 }, (_, index) => {
  const date = new Date(demoStart + index * 86400000);
  return date.toISOString().slice(0, 10);
});

function averageTrendRows(rows: OverviewTrendPoint[], period: string): OverviewTrendPoint {
  const average = (key: keyof OverviewTrendPoint) =>
    rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0) / Math.max(1, rows.length);
  const payTypeKeys = [...new Set(rows.flatMap((row) => Object.keys(row.activePayTypeGmv ?? {})))];
  return {
    period,
    totalGmv: Math.round(average('totalGmv')),
    activeGmv: Math.round(average('activeGmv')),
    renewalGmv: Math.round(average('renewalGmv')),
    expireUserCnt: Math.round(average('expireUserCnt')),
    renewalRate: average('renewalRate'),
    renewalAov: average('renewalAov'),
    activePayTypeGmv: Object.fromEntries(payTypeKeys.map((key) => [
      key,
      Math.round(rows.reduce((sum, row) => sum + Number(row.activePayTypeGmv?.[key] ?? 0), 0) / Math.max(1, rows.length)),
    ])),
    gmv: Math.round(average('gmv')),
    dau: Math.round(average('dau')),
    paywallExposureRate: average('paywallExposureRate'),
    submitRate: average('submitRate'),
    payRate: average('payRate'),
    aov: average('aov'),
  };
}

function buildOverview(
  platform: DashboardPlatform,
  startDate: string,
  endDate: string,
  granularity: Granularity = 'day',
  trendUserTag?: string,
  planTier?: RenewalPlanTier,
): DashboardOverviewResponse {
  const multiplier = platform === 'all' ? 1.48 : platform === 'web' ? 1 : 0.48;
  const userScale = trendUserTag === '新用户' ? 0.58 : trendUserTag === '老用户' ? 0.42 : 1;
  const renewalTierScale = planTier === 'LITE' ? 0.26 : planTier === 'PRO' ? 0.56 : planTier === 'ULTRA' ? 0.18 : 1;
  const trend: OverviewTrendPoint[] = days.filter((period) => period >= startDate && period <= endDate).map((period) => {
    const index = days.indexOf(period) - demoIndexOffset;
    const wave = Math.sin(index / 2.4) * 2800 + index * 180;
    const totalGmv = Math.round((118000 + wave) * multiplier);
    const activeGmv = Math.round(totalGmv * 0.72);
    const renewalGmv = (totalGmv - activeGmv) * renewalTierScale;
    const expireUserCnt = Math.round((900 * multiplier + index * 2) * renewalTierScale);
    const renewalRate = 0.62 + Math.sin(index / 4) * 0.012;
    return {
      period,
      totalGmv,
      activeGmv: Math.round(activeGmv * userScale),
      renewalGmv,
      expireUserCnt,
      renewalRate,
      renewalAov: renewalGmv / Math.max(1, expireUserCnt * renewalRate),
      activePayTypeGmv: {
        首订: Math.round(activeGmv * 0.42),
        积分包: Math.round(activeGmv * 0.18),
        '套餐升级': Math.round(activeGmv * 0.2),
        重新订阅: Math.round(activeGmv * 0.2),
      },
      gmv: totalGmv,
      dau: Math.round(18400 * multiplier + index * 80),
      paywallExposureRate: 0.5,
      submitRate: 0.1,
      payRate: 0.5,
      aov: 20,
    };
  });
  const groupedTrend = granularity === 'week'
    ? [...trend.reduce((groups, row) => {
        const key = getBusinessWeekStart(row.period);
        const bucket = groups.get(key) ?? [];
        bucket.push(row);
        groups.set(key, bucket);
        return groups;
      }, new Map<string, OverviewTrendPoint[]>())].map(([period, rows]) => averageTrendRows(rows, period))
    : trend;
  const current = groupedTrend.at(-1)!;
  const previous = granularity === 'week' ? groupedTrend.at(-2) ?? groupedTrend[0] : groupedTrend.at(-8) ?? groupedTrend[0];
  return {
    selectedPeriod: current.period,
    gmvTotal: current.totalGmv,
    gmvPrev: previous.totalGmv,
    wowChange: current.totalGmv / previous.totalGmv - 1,
    dau: current.dau,
    paywallExposureRate: current.paywallExposureRate,
    submitRate: current.submitRate,
    payRate: current.payRate,
    aov: current.aov,
    trend: groupedTrend,
  };
}

function item(key: string, baseline: number, delta: number, metrics: Record<string, number> = {}) {
  const analysis = baseline + delta;
  const enrichedMetrics = {
    ...metrics,
    ...(metrics.activeUv
      ? {
          creationPenetrationRate: (metrics.creationUv ?? 0) / metrics.activeUv,
          avgCreationTaskCntPerCreator: (metrics.creationTaskCnt ?? 0) / metrics.activeUv,
        }
      : {}),
  };
  const previousMetrics = Object.fromEntries(
    Object.entries(enrichedMetrics).map(([metricKey, value]) => [metricKey, value * 0.95]),
  );
  return {
    key,
    value: analysis,
    previousValue: baseline,
    change: delta,
    analysisDailyAvg: analysis,
    baselineDailyAvg: baseline,
    wowChange: baseline ? delta / baseline : null,
    contribution: delta / 4022,
    metrics: enrichedMetrics,
    previousMetrics,
  };
}

function buildAttribution(
  dimension: AttributionDimension,
  platform: DashboardPlatform,
  options: { creationTier?: string; userTag?: string; chainType?: PaymentChainType; planTier?: RenewalPlanTier } = {},
): DashboardAttributionsResponse {
  const scale = platform === 'all' ? 1.48 : platform === 'web' ? 1 : 0.48;
  const common = {
    baselinePeriod: '2026-09-26',
    analysisPeriod: '2026-10-03',
    periodDays: 7,
    baselinePeriodDays: 7,
    analysisPeriodDays: 7,
  };
  const payItems = [
    item('首订', 18200 * scale, 1680 * scale),
    item('积分包', 8200 * scale, 720 * scale),
    item('套餐升级', 12600 * scale, 1262 * scale),
    item('重新订阅', 14100 * scale, 880 * scale),
  ];
  const chainItems = [
    item('create_cnt_30d_0', 5100 * scale, 1005 * scale),
    item('create_cnt_30d_[1,11)', 20500 * scale, 4022 * scale),
    item('create_cnt_30d_[11,31)', 18500 * scale, 3005 * scale),
    item('create_cnt_30d_[31,101)', 19500 * scale, 1978 * scale),
    item('create_cnt_30d_[101,+inf)', 16400 * scale, 1989 * scale),
  ];
  const creativeItems = [
    item('create_cnt_30d_0', 5200 * scale, 1005 * scale, {
      activeUv: 46000 * scale, creationUv: 10500 * scale, creationTaskCnt: 44000 * scale,
    }),
    item('create_cnt_30d_[1,11)', 20500 * scale, 4022 * scale, {
      activeUv: 14000 * scale, creationUv: 3300 * scale, creationTaskCnt: 12300 * scale,
    }),
    item('create_cnt_30d_[11,31)', 18500 * scale, 3005 * scale, {
      activeUv: 8100 * scale, creationUv: 3380 * scale, creationTaskCnt: 13900 * scale,
    }),
    item('create_cnt_30d_[31,101)', 19500 * scale, 1978 * scale, {
      activeUv: 6400 * scale, creationUv: 3750 * scale, creationTaskCnt: 26000 * scale,
    }),
    item('create_cnt_30d_[101,+inf)', 16400 * scale, 1989 * scale, {
      activeUv: 5050 * scale, creationUv: 3860 * scale, creationTaskCnt: 142000 * scale,
    }),
  ];
  const items = dimension === 'pay_type' ? payItems : dimension === 'chain' ? chainItems : creativeItems;
  const primaryPayItems = [
    item('主动付费', 53100 * scale, 4550 * scale),
    // Keep the primary automatic-renewal total equal to its Lite/Pro/Ultra drilldown.
    item('自动续订', 5262 * scale, 448 * scale),
  ];
  const renewalPlanItems = [
    item('LITE', 1420 * scale, 180 * scale),
    item('PRO', 2860 * scale, 310 * scale),
    item('ULTRA', 982 * scale, -42 * scale),
  ];
  const renewalTierScale = options.planTier === 'LITE' ? 0.26 : options.planTier === 'PRO' ? 0.56 : options.planTier === 'ULTRA' ? 0.18 : 1;
  const renewalDrivers = [
    { metricKey: 'expireUserCnt', metric: '到期用户数', value: 910 * scale * renewalTierScale, previousValue: 870 * scale * renewalTierScale },
    { metricKey: 'renewalRate', metric: '续订率', value: 0.625, previousValue: 0.608 },
    { metricKey: 'renewalAov', metric: '续订客单价', value: 58.4, previousValue: 56.1 },
  ].map((driver, index) => ({
    tier: options.planTier ?? '全部套餐',
    metricKey: driver.metricKey,
    metric: driver.metric,
    value: driver.value,
    previousValue: driver.previousValue,
    change: driver.value - driver.previousValue,
    wowChange: driver.previousValue ? driver.value / driver.previousValue - 1 : null,
    contribution: [0.39, 0.34, 0.27][index],
  }));
  const trend = days.map((period, index) => ({
    period,
    gmv: Math.round((90000 + (index - demoIndexOffset) * 420) * scale),
    dau: Math.round(18000 * scale + (index - demoIndexOffset) * 60),
    activeUv: Math.round(18000 * scale + (index - demoIndexOffset) * 60),
    creationUv: Math.round(9000 * scale + (index - demoIndexOffset) * 35),
    creationTaskCnt: Math.round(13000 * scale + (index - demoIndexOffset) * 48),
    creationPenetrationRate: 0.5,
    avgCreationTaskCntPerCreator: 1.4,
  }));
  return {
    dimension,
    valueLabel: dimension === 'creative' ? '创作积极性' : 'GMV',
    comparison: common,
    metricLabels: {
      activeUv: '活跃UV',
      creationUv: '创作UV',
      creationTaskCnt: '创作数量',
      creationPenetrationRate: '创作渗透率',
      avgCreationTaskCntPerCreator: '人均创作数量',
    },
    items: dimension === 'pay_type' ? primaryPayItems : items,
    sections: dimension === 'pay_type'
      ? [
          { title: '一级付费类型贡献', description: '只比较主动付费和自动续订对周度 GMV 变化的贡献。', valueLabel: 'GMV', metricLabels: {}, items: primaryPayItems },
          { title: '主动付费下钻', description: '只在主动付费内部拆解首订、积分包、套餐升级、重新订阅等。', valueLabel: 'GMV', metricLabels: {}, items: payItems },
          { title: '自动续订套餐下钻', description: '只在自动续订内部拆解 Lite、Pro、Ultra 套餐对 GMV 变化的贡献。', valueLabel: 'GMV', metricLabels: {}, items: renewalPlanItems },
        ]
      : dimension === 'chain' && options.chainType !== 'renewal'
      ? [
          { title: '创作分层增量贡献', valueLabel: 'GMV', metricLabels: {}, items: chainItems },
          { title: '用户类型', valueLabel: 'GMV', metricLabels: {}, items: [item('新用户', 24000 * scale, 2200 * scale), item('老用户', 38200 * scale, 1800 * scale)] },
        ]
      : undefined,
    drivers: dimension === 'chain' && options.chainType === 'renewal'
      ? renewalDrivers
      : dimension === 'chain'
      ? [
          { tier: options.creationTier ?? 'create_cnt_30d_[1,11)', userTag: options.userTag ?? '全部用户', metricKey: 'activeUv', metric: 'DAU', value: 20475 * scale, previousValue: 18493 * scale, change: 1982 * scale, wowChange: 0.107, contribution: 0.49 },
          { tier: options.creationTier ?? 'create_cnt_30d_[1,11)', userTag: options.userTag ?? '全部用户', metricKey: 'subExposeRate', metric: '付费墙曝光率', value: 0.72, previousValue: 0.68, change: 0.04, wowChange: 0.059, contribution: 0.15 },
          { tier: options.creationTier ?? 'create_cnt_30d_[1,11)', userTag: options.userTag ?? '全部用户', metricKey: 'subSubmitRate', metric: '付费墙提交率', value: 0.081, previousValue: 0.073, change: 0.008, wowChange: 0.11, contribution: 0.3 },
          { tier: options.creationTier ?? 'create_cnt_30d_[1,11)', userTag: options.userTag ?? '全部用户', metricKey: 'chainPaySuccessRate', metric: '提交支付率', value: 0.37, previousValue: 0.39, change: -0.02, wowChange: -0.051, contribution: -0.11 },
          { tier: options.creationTier ?? 'create_cnt_30d_[1,11)', userTag: options.userTag ?? '全部用户', metricKey: 'chainArppu', metric: '客单价', value: 58, previousValue: 51, change: 7, wowChange: 0.137, contribution: 0.42 },
        ]
      : undefined,
    drill: dimension === 'chain' ? { path: 'tier_to_user_to_chain', creationTier: options.creationTier ?? 'all', userTag: options.userTag ?? 'all', chainType: options.chainType ?? 'active', planTier: options.planTier } : undefined,
    trend,
  };
}

export function getDemoOverview(platform: DashboardPlatform, startDate: string, endDate: string, granularity: Granularity = 'day', trendUserTag?: string, planTier?: RenewalPlanTier) {
  return buildOverview(platform, startDate, endDate, granularity, trendUserTag, planTier);
}
export function getDemoAttributions(
  dimension: AttributionDimension,
  platform: DashboardPlatform,
  options: { creationTier?: string; userTag?: string; chainType?: PaymentChainType; planTier?: RenewalPlanTier } = {},
) {
  return buildAttribution(dimension, platform, options);
}

export function getDemoCoverage(): DashboardGmvCoverageResponse {
  const platform = (name: Platform, scale: number) => ({
    platform: name,
    weeks: ['2026-09-12', '2026-09-19', '2026-09-26', '2026-10-03'].map((period) => ({ period, payTypeDailyAvg: 97000 * scale, chainDailyAvg: 95000 * scale, unattributedDailyAvg: 2000 * scale, unattributedRate: 0.021 })),
    payTypeDailyAvg: 97000 * scale,
    chainDailyAvg: 95000 * scale,
    unattributedDailyAvg: 2000 * scale,
    unattributedRate: 0.021,
  });
  return { weekCount: 4, platforms: { web: platform('web', 1), app: platform('app', 0.48) } };
}

export function getDemoSyncRun(): SyncRunStatus {
  return {
    runId: 'demo-sync',
    status: 'success',
    stage: 'write',
    startDate: '2026-10-09',
    endDate: '2026-10-09',
    platforms: ['all', 'web', 'app'],
    rowsSynced: 420,
    startedAt: '2026-10-09T08:25:00.000Z',
    finishedAt: '2026-10-09T08:25:04.000Z',
  };
}

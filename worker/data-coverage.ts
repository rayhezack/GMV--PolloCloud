import type { CoverageDataset, DataCoverage } from '../shared/data-coverage';
import type { DashboardPlatform, GmvAttributionType } from '../shared/api.interface';

// Read stored dates, never the state or scope of the latest sync job. LIMIT lets
// the existing period indexes stop immediately rather than materializing history.
export function coverageQuery(
  dataset: CoverageDataset,
  platform: DashboardPlatform,
  deviceType?: string,
  attributionType: GmvAttributionType = 'NONE',
) {
  let table = 'pollo_da_fact_rows';
  const conditions: string[] = [];
  const binds: unknown[] = [];
  if (dataset === 'ads') {
    table = 'pollo_da_ads_daily';
    if (platform !== 'all') {
      conditions.push('LOWER(platform)=?');
      binds.push(platform);
    }
  } else if (dataset === 'creation_chain') {
    table = 'pollo_da_creation_overall_daily';
    conditions.push(
      deviceType
        ? 'platform_type=?'
        : platform === 'all'
          ? "platform_type='汇总'"
          : platform === 'web'
            ? "platform_type='WEB'"
            : "platform_type IN ('IOS','ANDROID')",
    );
    if (deviceType) binds.push(deviceType.toUpperCase());
  } else if (dataset === 'chain') {
    table = 'pollo_da_chain_funnel';
    if (platform !== 'all') {
      conditions.push('platform=?');
      binds.push(platform);
    }
    if (deviceType) {
      conditions.push('device_type=?');
      binds.push(deviceType);
    }
  } else {
    conditions.push('dataset=?', "dataset_kind='daily'", 'platform=?');
    binds.push(dataset, dataset === 'pay_type' ? 'all' : platform);
    if (dataset === 'pay_type') {
      if (attributionType === 'NONE')
        conditions.push(
          "(attribution_type IS NULL OR (attribution_type='NONE' AND pay_category IN ('ACTIVE_PAYMENT','AUTO_RENEWAL','API') AND pay_type<>'汇总'))",
        );
      else {
        conditions.push('attribution_type=?');
        binds.push(attributionType);
      }
      if (platform !== 'all')
        conditions.push(platform === 'web' ? "device_type='web'" : "device_type IN ('ios','android')");
    }
    if (deviceType) {
      conditions.push(dataset === 'renewal' ? 'platform_type=?' : 'device_type=?');
      binds.push(dataset === 'renewal' ? deviceType.toUpperCase() : deviceType);
    }
  }
  return { table, where: conditions.length ? conditions.join(' AND ') : '1=1', binds };
}

export async function readDataCoverage(
  dataset: CoverageDataset,
  platform: DashboardPlatform,
  deviceType: string | undefined,
  query: (sql: string, ...binds: unknown[]) => Promise<Record<string, unknown>[]>,
): Promise<DataCoverage | null> {
  const { table, where, binds } = coverageQuery(dataset, platform, deviceType);
  const [first, last] = await Promise.all(
    ['ASC', 'DESC'].map((direction) =>
      query(`SELECT period FROM ${table} WHERE ${where} ORDER BY period ${direction} LIMIT 1`, ...binds),
    ),
  );
  return first[0]?.period && last[0]?.period
    ? { startDate: String(first[0].period), endDate: String(last[0].period) }
    : null;
}

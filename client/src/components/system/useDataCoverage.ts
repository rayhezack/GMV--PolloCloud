import { useEffect, useState } from 'react';
import { getDataCoverage } from '@/api/dashboard';
import { STATIC_DEMO_MODE } from '@/lib/demo-data';
import type { CoverageDataset, DataCoverage } from '@shared/data-coverage';
import type { AppDeviceType, DashboardPlatform } from '@shared/api.interface';

export function useDataCoverage(
  dataset: CoverageDataset,
  platform: DashboardPlatform,
  deviceType?: AppDeviceType,
  revision = 0,
) {
  const scope = `${dataset}:${platform}:${deviceType || ''}`;
  const key = `${scope}:${revision}`;
  const [state, setState] = useState<{
    key: string;
    scope: string;
    coverage: DataCoverage | null;
    error: string;
  } | null>(null);
  useEffect(() => {
    let live = true;
    void getDataCoverage({ dataset, platform, deviceType, cacheBust: revision })
      .then((coverage) => {
        if (live) setState({ key, scope, coverage, error: '' });
      })
      .catch(() => {
        if (live)
          setState((previous) => ({
            key,
            scope,
            coverage: previous?.scope === scope ? previous.coverage : null,
            error: '可用数据日期读取失败，请重试',
          }));
      });
    return () => {
      live = false;
    };
  }, [key]);
  // A refresh keeps the current scope's dates usable while its request is in
  // flight. A platform/dataset change must never reuse another scope's dates.
  const current = state?.scope === scope ? state : null;
  return {
    coverage: STATIC_DEMO_MODE ? { startDate: '2026-01-01', endDate: '2026-10-09' } : (current?.coverage ?? null),
    loading: !STATIC_DEMO_MODE && state?.key !== key,
    error: state?.key === key ? state.error : '',
  };
}

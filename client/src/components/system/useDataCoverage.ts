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
  const key = `${dataset}:${platform}:${deviceType || ''}:${revision}`;
  const [state, setState] = useState<{ key: string; coverage: DataCoverage | null; error: string } | null>(null);
  useEffect(() => {
    let live = true;
    void getDataCoverage({ dataset, platform, deviceType, cacheBust: revision })
      .then((coverage) => {
        if (live) setState({ key, coverage, error: '' });
      })
      .catch(() => {
        if (live) setState({ key, coverage: null, error: '可用数据日期读取失败，请重试' });
      });
    return () => {
      live = false;
    };
  }, [key]);
  const current = state?.key === key ? state : null;
  return {
    coverage: STATIC_DEMO_MODE ? { startDate: '2026-01-01', endDate: '2026-10-09' } : (current?.coverage ?? null),
    loading: !STATIC_DEMO_MODE && !current,
    error: current?.error || '',
  };
}

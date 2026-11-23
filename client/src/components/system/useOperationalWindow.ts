import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDataCoverage } from './useDataCoverage';
import type { CoverageDataset } from '@shared/data-coverage';
import { getBusinessWeekStart, isValidDateString } from '@shared/business-week';
import { shiftDay } from '@/components/v62/trend-data';
import type { DashboardPlatform, AppDeviceType } from '@shared/api.interface';

/** The monitoring window is independent of each panel's business-week comparison. */
export function useOperationalWindow(kind: 'creative' | 'ads' | 'details') {
  const [params, setParams] = useSearchParams();
  const [revision, setRevision] = useState(0);
  const platform: DashboardPlatform =
    params.get('platform') === 'web' ? 'web' : params.get('platform') === 'app' ? 'app' : 'all';
  const deviceType =
    platform === 'app' && ['ios', 'android'].includes(params.get('deviceType') || '')
      ? (params.get('deviceType') as AppDeviceType)
      : undefined;
  const requestedDataset = params.get('dataset') || 'pay_type';
  const datasets = ['pay_type', 'chain', 'creative', 'creation_chain', 'renewal', 'ads'];
  const dataset: CoverageDataset =
    kind === 'creative'
      ? 'creation_chain'
      : kind === 'ads'
        ? 'ads'
        : datasets.includes(requestedDataset)
          ? (requestedDataset as CoverageDataset)
          : 'pay_type';
  const {
    coverage,
    loading: coverageLoading,
    error,
  } = useDataCoverage(dataset, platform, kind === 'creative' ? deviceType : undefined, revision);
  const update = (values: Record<string, string>) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        Object.entries(values).forEach(([key, value]) => next.set(key, value));
        return next;
      },
      { replace: true },
    );
  const latest = coverage?.endDate ?? '',
    earliest = coverage?.startDate ?? '2026-01-01';
  const clamp = (value: string) => (value < earliest ? earliest : latest && value > latest ? latest : value);
  const paramDate = (key: string, fallback: string) => {
    const value = params.get(key);
    return value && isValidDateString(value) ? value : fallback;
  };
  const startKey = kind === 'details' ? 'detailsStartDate' : kind === 'ads' ? 'adsStartDate' : 'trendStartDate',
    endKey = kind === 'details' ? 'detailsEndDate' : kind === 'ads' ? 'adsEndDate' : 'trendEndDate';
  const endDate = clamp(paramDate(endKey, latest));
  const startDate = endDate ? clamp(paramDate(startKey, shiftDay(endDate, -29))) : '';
  const dateRange = { startDate: startDate > endDate ? endDate : startDate, endDate };
  const analysis = latest ? getBusinessWeekStart(latest) : '';
  const weeks = (prefix: string) => ({
    analysisWeek: getBusinessWeekStart(paramDate(`${prefix}AnalysisWeek`, analysis || earliest)),
    baselineWeek: getBusinessWeekStart(
      paramDate(`${prefix}BaselineWeek`, analysis ? shiftDay(analysis, -7) : earliest),
    ),
  });
  const availableWeeks: string[] = [];
  if (latest)
    for (let day = getBusinessWeekStart(earliest); day <= latest; day = shiftDay(day, 7)) availableWeeks.push(day);
  return {
    params,
    update,
    coverage,
    coverageLoading,
    latest,
    error,
    platform,
    deviceType,
    revision,
    refresh: () => setRevision((n) => n + 1),
    dateRange,
    weeks,
    availableWeeks,
    onRangeChange: (range: { startDate: string; endDate: string }) =>
      update({ [startKey]: range.startDate, [endKey]: range.endDate }),
  };
}

import { useEffect, useState } from 'react';
import { Selector } from '@astryxdesign/core/Selector';
import { getAdsOverview } from '@/api/dashboard';
import type { AdsCountryDetail, AdsChannelRow } from '@shared/api.interface';
import { DataTable, Modal, PanelState, DeltaBadge } from '@/components/system';
import { FinanceOverviewAreaChart } from '@/components/finance-overview-area-chart';
import { money, count, rate } from '@shared/format';
import { adsBuckets, type AdsMetric } from './ads-data';
import { shiftDay } from '@/components/v62/trend-data';
import { Popover, PopoverTrigger } from '@/components/ui/popover';
import { Content as PopoverContent } from '@radix-ui/react-popover';
import { Info } from 'lucide-react';

type Request = Parameters<typeof getAdsOverview>[0];
export function CountryChannels({
  open,
  onOpenChange,
  countries,
  request,
  asOf,
  days,
  baseDays,
  initialCountry,
  comparisonDates,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  countries: AdsChannelRow[];
  request: Request;
  asOf: string;
  days: number;
  baseDays: number;
  initialCountry?: string;
  comparisonDates?: { baseline: string[]; analysis: string[] };
}) {
  const [country, setCountry] = useState(''),
    [channel, setChannel] = useState(''),
    [metric, setMetric] = useState('clicks'),
    [detail, setDetail] = useState<AdsCountryDetail | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (open && initialCountry) {
      setCountry(initialCountry);
      setChannel('');
    }
  }, [open, initialCountry]);
  const selected = countries.find((c) => c.key === country) || countries[0];
  const key = JSON.stringify({ ...request, country: selected?.key });
  useEffect(() => {
    if (!open || !selected) return;
    let live = true;
    setLoading(true);
    setDetail(null);
    setError('');
    void getAdsOverview(JSON.parse(key))
      .then((data) => {
        if (live) setDetail(data.countryDetails?.find((c) => c.key === selected.key) || null);
      })
      .catch(() => {
        if (live) setError('渠道明细读取失败');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [open, key]);
  const active = detail?.channels.find((c) => c.key === channel) || detail?.channels[0];
  const metrics: {
    key: AdsMetric;
    label: string;
    unit: 'count' | 'currency' | 'rate';
    format: (n: number) => string;
  }[] = [
    { key: 'impressions', label: '曝光量', unit: 'count', format: count },
    { key: 'clicks', label: '点击量', unit: 'count', format: count },
    { key: 'ctr', label: 'CTR', unit: 'rate', format: rate },
    {
      key: 'cpc',
      label: 'CPC',
      unit: 'currency',
      format: (n) =>
        n.toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
    },
    { key: 'costUsd', label: '广告成本', unit: 'currency', format: money },
    { key: 'registerUsers', label: '注册用户', unit: 'count', format: count },
    { key: 'roas', label: 'ROAS · D0', unit: 'count', format: (n) => `${n.toFixed(2)}×` },
    {
      key: 'ltv',
      label: 'LTV · D0',
      unit: 'currency',
      format: (n) =>
        n.toLocaleString('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }),
    },
  ];
  const currentMetric = metrics.find((m) => m.key === metric) || metrics[1];
  const [selectedDay, setSelectedDay] = useState('');
  const [grain, setGrain] = useState<'day' | 'week' | 'month'>('day');
  const trend = active
    ? adsBuckets(
        active.trend,
        currentMetric.key,
        'D0',
        asOf,
        request.startDate,
        request.endDate < asOf ? request.endDate : asOf,
        grain,
      )
    : [];
  const side = (key: string, which: 'baseline' | 'current') => {
    if (!active) return null;
    const p = active[which];
    if (key === 'roas') return p.roasByHorizon?.D0 ?? null;
    if (key === 'ltv') return p.registerUsers > 0 ? p.gmvD0 / p.registerUsers : null;
    if (key === 'ctr') return p.impressions > 0 ? p.clicks / p.impressions : null;
    if (key === 'cpc') return p.clicks > 0 ? p.costUsd / p.clicks : null;
    return p[key as 'impressions' | 'clicks' | 'costUsd' | 'registerUsers'] / (which === 'baseline' ? baseDays : days);
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="渠道表现" width={880}>
      <div className="ads-country-detail">
        <div className="ops-panel-controls">
          <Selector
            label="国家"
            isLabelHidden
            variant="ghost"
            value={selected?.key || ''}
            onChange={(v) => {
              setCountry(v);
              setChannel('');
            }}
            options={countries.map((c) => ({ value: c.key, label: c.label }))}
          />
          <Selector
            label="渠道"
            isLabelHidden
            variant="ghost"
            value={active?.key || ''}
            onChange={setChannel}
            options={detail?.channels.map((c) => ({ value: c.key, label: c.label })) || []}
          />
        </div>
        {loading ? (
          <PanelState state="loading" />
        ) : error ? (
          <PanelState state="error" reason={error} />
        ) : !active ? (
          <PanelState state="empty" reason="该国家暂无渠道数据" />
        ) : (
          <>
            <DataTable
              selectedRowId={metric}
              onRowActivate={(row) => setMetric(row.id)}
              rows={metrics.map((m) => ({
                id: m.key,
                label: m.label,
                format: m.format,
                b: side(m.key, 'baseline'),
                v: side(m.key, 'current'),
              }))}
              columns={[
                {
                  key: 'label',
                  header: '指标',
                  render: (r) => (
                    <button
                      type="button"
                      className="ads-metric-row"
                      aria-pressed={r.id === metric}
                      onClick={() => setMetric(r.id)}
                    >
                      {r.label}
                    </button>
                  ),
                },
                {
                  key: 'b',
                  header: (
                    <PeriodLabel
                      label="基准期"
                      dates={comparisonDates?.baseline}
                      from={request.baselinePeriod}
                      days={baseDays}
                    />
                  ),
                  numeric: true,
                  render: (r) => (r.b == null ? '—' : r.format(r.b)),
                },
                {
                  key: 'v',
                  header: (
                    <PeriodLabel
                      label="分析期"
                      dates={comparisonDates?.analysis}
                      from={request.analysisPeriod}
                      days={days}
                    />
                  ),
                  numeric: true,
                  render: (r) => (r.v == null ? '—' : r.format(r.v)),
                },
                {
                  key: 'delta',
                  header: '变化',
                  numeric: true,
                  render: (r) => (
                    <DeltaBadge
                      unit={r.id === 'ctr' ? 'pp' : 'pct'}
                      value={
                        r.b != null && r.v != null
                          ? r.id === 'ctr'
                            ? r.v - r.b
                            : r.b !== 0
                              ? (r.v - r.b) / r.b
                              : null
                          : null
                      }
                    />
                  ),
                },
              ]}
            />
            <section className="ops-trend">
              <FinanceOverviewAreaChart
                title={currentMetric.label}
                unit={currentMetric.unit}
                showRelativeDifference={currentMetric.key !== 'roas'}
                unitLabel={currentMetric.key === 'clicks' ? '次' : currentMetric.key === 'roas' ? '倍' : undefined}
                formatValue={currentMetric.format}
                buckets={trend}
                selectedDay={selectedDay || trend.at(-1)?.date || asOf}
                onSelect={setSelectedDay}
                granularity={grain}
                onGranularityChange={setGrain}
              />
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}

function PeriodLabel({ label, dates, from, days }: { label: string; dates?: string[]; from: string; days: number }) {
  const observed = [...(dates || [])].sort();
  const start = observed[0] || from,
    end = observed.at(-1) || shiftDay(from, days - 1);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="ads-period-label" aria-label={`${label}时间范围`}>
          {label}
          <Info size={12} />
        </button>
      </PopoverTrigger>
      <PopoverContent data-slot="popover-content" align="end" sideOffset={8} className="ads-period-note">
        <strong>{label}</strong>
        <span>
          {start} – {end}
        </span>
        <span>{observed.length || days} 天 · 同业务日日均</span>
      </PopoverContent>
    </Popover>
  );
}

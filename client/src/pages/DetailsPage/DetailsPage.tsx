import { useEffect, useState } from 'react';
import { Selector } from '@astryxdesign/core/Selector';
import { apiRequest } from '@/lib/pollocloud';
import { STATIC_DEMO_MODE } from '@/lib/demo-data';
import { DAILY_DATASETS, type DailyDataResponse, type DailyDataset, type DailyColumn } from '@shared/daily-data';
import { PageHeader, DataTable, PanelState, PanelHeader } from '@/components/system';
import { Download } from 'lucide-react';
import { useOperationalWindow } from '@/components/system/useOperationalWindow';
import DashboardDateRangePicker from '@/components/dashboard/DashboardDateRangePicker';
import PlatformSelect from '@/components/v62/PlatformSelect';
import { Segment, exportCsv } from '@/components/v62/primitives';
import { count, rate } from '@shared/format';
import '../operational-pages.css';
import './details.css';

export default function DetailsPage() {
  const window = useOperationalWindow('details');
  const { params, update, platform, dateRange, latest, revision } = window;
  const requested = params.get('dataset') || 'pay_type',
    dataset: DailyDataset = Object.prototype.hasOwnProperty.call(DAILY_DATASETS, requested)
      ? (requested as DailyDataset)
      : 'pay_type';
  const page = Math.max(1, Number(params.get('dataPage')) || 1),
    pageSize = [20, 50, 100].includes(Number(params.get('dataPageSize'))) ? Number(params.get('dataPageSize')) : 50;
  const sort = DAILY_DATASETS[dataset].columns.some((c) => c.key === params.get('dataSort'))
      ? params.get('dataSort')!
      : 'period',
    direction = params.get('dataDirection') === 'asc' ? 'asc' : 'desc';
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState(''),
    [data, setData] = useState<DailyDataResponse | null>(null),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search !== query) {
        setQuery(search);
        update({ dataPage: '1' });
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!latest) return;
    let live = true;
    setLoading(true);
    setData(null);
    setError('');
    const queryString = new URLSearchParams({
      dataset,
      platform,
      ...dateRange,
      search: query,
      sort,
      direction,
      page: String(page),
      pageSize: String(pageSize),
      revision: String(revision),
    });
    const load = STATIC_DEMO_MODE
      ? Promise.resolve({
          dataset,
          source: 'demo',
          fields: [...DAILY_DATASETS[dataset].columns],
          items: [],
          total: 0,
          page: 1,
          pageSize,
        } as DailyDataResponse)
      : apiRequest<DailyDataResponse>(`/api/dashboard/daily-data?${queryString}`).then((r) => r.data);
    void load
      .then((result) => {
        if (live) setData(result);
      })
      .catch(() => {
        if (live) setError('明细数据读取失败');
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [
    dataset,
    platform,
    dateRange.startDate,
    dateRange.endDate,
    latest,
    revision,
    query,
    sort,
    direction,
    page,
    pageSize,
  ]);
  const fields = data?.fields || [...DAILY_DATASETS[dataset].columns];
  const textLabels: Record<string, string> = {
    ACTIVE_PAYMENT: '主动付费',
    AUTO_RENEWAL: '自动续订',
    API: 'API',
    create_cnt_30d_0: '近30日未创作',
    'create_cnt_30d_[1,11)': '近30日 1–10 次',
    'create_cnt_30d_[11,31)': '近30日 11–30 次',
    'create_cnt_30d_[31,101)': '近30日 31–100 次',
    'create_cnt_30d_[101,+inf)': '近30日 101+ 次',
  };
  const format = (value: unknown, column: DailyColumn) =>
    value == null || value === ''
      ? '—'
      : typeof value !== 'number'
        ? (textLabels[String(value)] ?? String(value))
        : column.kind === 'rate'
          ? rate(value)
          : column.kind === 'count'
            ? count(value)
            : value.toLocaleString('en-US', { maximumFractionDigits: 6 });
  const exportPage = () =>
    data &&
    exportCsv(`Pollo-${dataset}-${dateRange.startDate}-${dateRange.endDate}-page-${data.page}.csv`, [
      fields.map((c) => c.label),
      ...data.items.map((row) => fields.map((c) => row[c.key])),
    ]);
  const change = (values: Record<string, string>) => update({ ...values, dataPage: '1' });
  const actualPage = data?.page || page,
    lastPage = Math.max(1, Math.ceil((data?.total || 0) / pageSize));
  return (
    <div className="v62-page v62-sheet-page operational-page details-page">
      <PageHeader
        title="明细数据"
        tools={
          <>
            {latest && (
              <DashboardDateRangePicker
                selectedRange={dateRange}
                availableRange={window.coverage}
                onRangeChange={(range) => {
                  window.onRangeChange(range);
                  update({ dataPage: '1' });
                }}
              />
            )}
            <PlatformSelect deviceEnabled={false} value={platform} onChange={(v) => change({ platform: v })} />
            <button className="v62-button" onClick={window.refresh} disabled={loading}>
              刷新
            </button>
            <button className="v62-button" disabled={!data?.items.length || loading} onClick={exportPage}>
              <Download size={16} strokeWidth={1.7} aria-hidden="true" />
              导出本页
            </button>
          </>
        }
      />
      <div className="details-dataset-bar">
        <Segment
          label="核心数据集"
          variant="icons"
          value={dataset}
          onChange={(v) => change({ dataset: v, dataSort: 'period', dataDirection: 'desc' })}
          items={Object.entries(DAILY_DATASETS).map(([value, c]) => ({
            value,
            label: c.label,
            icon:
              (
                {
                  pay_type: 'chart-pie',
                  chain: 'workflow',
                  creative: 'blocks',
                  creation_chain: 'clapperboard',
                  renewal: 'coins',
                  ads: 'target',
                } as const
              )[value as DailyDataset] || 'database',
          }))}
        />
      </div>
      <section className="ops-panel details-table-panel">
        <PanelHeader
          title={DAILY_DATASETS[dataset].label}
          info={
            <>
              {DAILY_DATASETS[dataset].source}
              。每日原始维度数据，不跨数据集加总；同一数据集也可能含多种维度，核对维度后再汇总。金额单位
              USD，人数展示整数；订单当量保留小数。导出保留源精度。缺失留空，不补零。
              <br />
              {fields.map((c) => `${c.label}：${c.key}`).join('；')}
            </>
          }
          tools={
            <Selector
              label="每页行数"
              isLabelHidden
              variant="ghost"
              size="sm"
              value={String(pageSize)}
              onChange={(v) => change({ dataPageSize: v })}
              options={[20, 50, 100].map((v) => ({ value: String(v), label: `每页 ${v} 行` }))}
            />
          }
        />
        <div className="details-filters">
          <input
            className="details-search"
            aria-label="搜索明细数据"
            placeholder="搜索当前数据集"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <span>{data?.total != null ? `${count(data.total)} 条` : '—'}</span>
        </div>
        {error ? (
          <PanelState state="error" reason={error} onRetry={window.refresh} />
        ) : loading && !data ? (
          <PanelState state="loading" />
        ) : !data?.items.length ? (
          <PanelState
            state="empty"
            reason={
              STATIC_DEMO_MODE ? 'Demo未提供可验证的每日明细' : query ? '没有匹配的数据' : '所选日期未被当前快照覆盖'
            }
          />
        ) : (
          <div aria-busy={loading} className="details-table-body" data-loading={loading}>
            <DataTable
              stickyFirst
              rows={data.items.map((row, i) => ({ ...row, id: `${data.page}-${i}` }))}
              columns={fields.map((column) => ({
                key: column.key,
                minWidth: column.key === 'period' ? 118 : column.kind === 'text' ? 130 : 120,
                header: column.label,
                numeric: column.kind !== 'text',
                sortable: true,
                onSort: () =>
                  change({
                    dataSort: column.key,
                    dataDirection: sort === column.key && direction === 'desc' ? 'asc' : 'desc',
                  }),
                render: (row) => format(row[column.key], column),
              }))}
            />
          </div>
        )}
        <footer className="details-pagination">
          <span>
            {data?.total
              ? `${(actualPage - 1) * pageSize + 1}–${Math.min(actualPage * pageSize, data.total)} / ${count(data.total)}`
              : '0 条'}
          </span>
          <div>
            <button
              className="v62-button"
              aria-label="上一页"
              disabled={actualPage <= 1 || loading}
              onClick={() => update({ dataPage: String(actualPage - 1) })}
            >
              上一页
            </button>
            <span>
              {actualPage} / {lastPage}
            </span>
            <button
              className="v62-button"
              aria-label="下一页"
              disabled={actualPage >= lastPage || loading}
              onClick={() => update({ dataPage: String(actualPage + 1) })}
            >
              下一页
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

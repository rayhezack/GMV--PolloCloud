import { useState } from 'react';
import type { ChainComparison, ChainGroup } from '@shared/chain-comparison';
import { money, signedMoney } from '@shared/format';
import { DataTable, DeltaBadge, PanelHeader, DivergingBar, PeriodHeading } from '@/components/system';
import { ChevronDown, ChevronRight } from 'lucide-react';

type Scope = { lifecycle?: string; creationTier?: string; planTier?: string };
type PopulationRow = ChainGroup & { id: string; kind: 'row' | 'child'; scope: Scope; selected: boolean };
export function PopulationPicker({ data, onSelect }: { data: ChainComparison; onSelect: (scope: Scope) => void }) {
  const { chainType, lifecycle, creationTier, planTier } = data.comparison;
  const [open, setOpen] = useState<string | null>(lifecycle || null);
  const active = chainType === 'active';
  const groups = active ? data.lifecycleGroups || [] : data.groups;
  const selected = active ? lifecycle : planTier;
  const rows: PopulationRow[] = groups.flatMap((group) => {
    const parent: PopulationRow = {
      ...group,
      id: group.key,
      kind: 'row',
      scope: active ? { lifecycle: group.key } : { planTier: group.key },
      selected: selected === group.key && !creationTier,
    };
    const children: PopulationRow[] =
      active && open === group.key
        ? data.groups
            .filter((child) => child.key.split(' × ')[1] === group.key)
            .map((child) => {
              const tier = child.key.split(' × ')[0];
              return {
                ...child,
                id: child.key,
                label: child.label.split(' × ')[0],
                kind: 'child',
                scope: { lifecycle: group.key, creationTier: tier },
                selected: lifecycle === group.key && creationTier === tier,
              };
            })
        : [];
    return [parent, ...children];
  });
  const net = groups.reduce((sum, group) => sum + group.current - group.baseline, 0);
  const contribution = (row: PopulationRow) => (net === 0 ? null : (row.current - row.baseline) / net);
  const scale = Math.max(Number.EPSILON, ...rows.map((row) => Math.abs(contribution(row) || 0)));
  return (
    <section className="chain-populations">
      <PanelHeader
        title={active ? '分析人群' : '分析套餐'}
        info="贡献度 = 该行 GMV 变化 / 所有列示人群的 GMV 净变化；创作子层使用相同分母。净变化为零时不计算。与支付结果表的未归因差额不分摊给人群。"
        tools={
          <button
            className="v62-button"
            aria-pressed={!selected}
            onClick={() => {
              setOpen(null);
              onSelect({});
            }}
          >
            全部
          </button>
        }
      />
      <DataTable
        rows={rows}
        columns={[
          {
            key: 'label',
            minWidth: 220,
            header: active ? '注册新老 / 创作分层' : '套餐',
            render: (r) => (
              <span className="chain-population-label" data-child={r.kind === 'child'} data-selected={r.selected}>
                {active && r.kind === 'row' && (
                  <button
                    className="chain-population-toggle"
                    aria-label={`${open === r.key ? '收起' : '展开'}${r.label}创作分层`}
                    aria-expanded={open === r.key}
                    onClick={() => setOpen(open === r.key ? null : r.key)}
                  >
                    {open === r.key ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                )}
                <button
                  className="chain-population-select"
                  aria-pressed={r.selected}
                  onClick={() => {
                    if (r.kind === 'row' && active) setOpen(r.selected ? null : r.key);
                    onSelect(r.selected ? {} : r.scope);
                  }}
                >
                  {r.label}
                </button>
              </span>
            ),
          },
          {
            key: 'baseline',
            minWidth: 110,
            header: <PeriodHeading label="基准期 GMV" dates={data.dates.baseline} mode={data.comparison.mode} />,
            numeric: true,
            render: (r) => money(r.baseline),
          },
          {
            key: 'current',
            minWidth: 110,
            header: <PeriodHeading label="分析期 GMV" dates={data.dates.analysis} mode={data.comparison.mode} />,
            numeric: true,
            render: (r) => money(r.current),
          },
          {
            key: 'delta',
            minWidth: 110,
            header: '变化',
            numeric: true,
            render: (r) => (
              <span data-effect={r.current < r.baseline ? 'negative' : 'positive'}>
                {signedMoney(r.current - r.baseline)}
              </span>
            ),
          },
          {
            key: 'change',
            minWidth: 100,
            header: '变化率',
            numeric: true,
            render: (r) => <DeltaBadge value={r.baseline ? (r.current - r.baseline) / r.baseline : null} />,
          },
          {
            key: 'contribution',
            minWidth: 140,
            header: 'GMV 贡献度',
            numeric: true,
            render: (r) => (
              <DivergingBar
                value={contribution(r)}
                effect={r.current - r.baseline}
                scaleMax={scale}
                variant={r.kind === 'child' ? 'child' : 'root'}
              />
            ),
          },
        ]}
      />
    </section>
  );
}

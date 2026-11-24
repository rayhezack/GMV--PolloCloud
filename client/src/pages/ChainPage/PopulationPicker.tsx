import { useState } from 'react';
import type { ChainComparison, ChainGroup } from '@shared/chain-comparison';
import { populationContribution } from '@shared/chain-display';
import { money, share, signedMoney } from '@shared/format';
import { DataTable, PanelHeader, DivergingBar, PeriodHeading } from '@/components/system';
import { Segment } from '@/components/v62/primitives';
import { ChevronDown, ChevronRight } from 'lucide-react';

type Scope = { lifecycle?: string; creationTier?: string; countryTier?: string; planTier?: string };
type PopulationRow = ChainGroup & { id: string; kind: 'row' | 'child'; scope: Scope; selected: boolean };
export function PopulationPicker({
  data,
  populationDimension,
  onSelect,
  onDimensionChange,
}: {
  data: ChainComparison;
  populationDimension: 'creation' | 'country';
  onSelect: (scope: Scope) => void;
  onDimensionChange: (dimension: 'creation' | 'country') => void;
}) {
  const { chainType, lifecycle, creationTier, planTier } = data.comparison;
  const countryDimension = populationDimension === 'country';
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
      selected: selected === group.key && !creationTier && !data.comparison.countryTier,
    };
    const children: PopulationRow[] =
      active && open === group.key
        ? (countryDimension ? data.countryGroups || [] : data.creationGroups || data.groups)
            .filter((child) => child.key.split(' × ')[1] === group.key)
            .map((child) => {
              const tier = child.key.split(' × ')[0];
              return {
                ...child,
                id: child.key,
                label: child.label.split(' × ')[0],
                kind: 'child',
                scope: countryDimension
                  ? { lifecycle: group.key, countryTier: tier }
                  : { lifecycle: group.key, creationTier: tier },
                selected:
                  lifecycle === group.key &&
                  (countryDimension ? data.comparison.countryTier === tier : creationTier === tier),
              };
            })
        : [];
    return [parent, ...children];
  });
  const contribution = (row: PopulationRow) =>
    populationContribution(row, groups, row.kind === 'child' ? row.scope.lifecycle : undefined);
  const scale = Math.max(Number.EPSILON, ...rows.map((row) => Math.abs(contribution(row) || 0)));
  return (
    <section className="chain-populations">
      <PanelHeader
        title={active ? '分析人群' : '分析套餐'}
        info="注册新老贡献度以全部人群 GMV 净变化为分母；下拆国家或创作分层以所属注册人群 GMV 净变化为分母，子层合计为 100%。分母为零时不计算；抵消项可能为负。支付结果表的未归因差额不分摊给人群。"
        tools={
          <div className="chain-population-tools">
            {active && (
              <Segment
                label="人群下钻维度"
                variant="icons"
                value={populationDimension}
                onChange={onDimensionChange}
                items={[
                  { value: 'creation', label: '创作分层', icon: 'blocks' },
                  { value: 'country', label: '国家分层', icon: 'globe' },
                ]}
              />
            )}
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
          </div>
        }
      />
      <DataTable
        rows={rows}
        columns={[
          {
            key: 'label',
            minWidth: 220,
            header: active ? `注册新老 / ${countryDimension ? '国家分层' : '创作分层'}` : '套餐',
            render: (r) => (
              <span className="chain-population-label" data-child={r.kind === 'child'} data-selected={r.selected}>
                {active && r.kind === 'row' && (
                  <button
                    className="chain-population-toggle"
                    aria-label={`${open === r.key ? '收起' : '展开'}${r.label}${countryDimension ? '国家分层' : '创作分层'}`}
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
            render: (r) => share(r.baseline ? (r.current - r.baseline) / r.baseline : null),
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

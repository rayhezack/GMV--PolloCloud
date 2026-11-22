import { useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { X } from 'lucide-react';
import { diagnoseCohort } from '@/components/dashboard/ads-cohort-diagnosis';
import { count, money } from '@shared/format';
import { Selector } from '@astryxdesign/core/Selector';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { PanelHeader, PanelState } from '@/components/system';
import type { AdsCohortMatrixRow } from '@shared/api.interface';
import { cohortRows, mature } from './ads-data';

export function CohortPanel({ data, asOf }: { data: AdsCohortMatrixRow[]; asOf: string }) {
  const [metric, setMetric] = useState<'ltv' | 'roas'>('ltv');
  const [selected, setSelected] = useState<{ row: string; horizon: string; index: number } | null>(null);
  const reduced = useReducedMotion();
  const refs = useRef(new Map<number, HTMLButtonElement>());
  const rows = cohortRows(data, 'day', metric, asOf);
  const horizons = ['D0', 'D14', 'D30', 'D60', 'D90', 'D180'];
  const maxima = horizons.map((h) =>
    Math.max(
      0.00001,
      ...rows.flatMap((r) => r.values.filter((c) => c.horizon === h && c.value != null).map((c) => c.value!)),
    ),
  );
  const selectedRow = rows.find((row) => row.key === selected?.row);
  const selectedCell = selectedRow?.values.find((cell) => cell.horizon === selected?.horizon);
  const diagnosis =
    selectedRow && selectedCell
      ? diagnoseCohort({
          period: selectedRow.key,
          horizon: selectedCell.horizon,
          asOf,
          available: selectedCell.value != null,
          ...selectedCell,
        })
      : null;
  const closeReading = () => {
    if (selected) refs.current.get(selected.index)?.focus();
    setSelected(null);
  };
  const format = (v: number) => (metric === 'roas' ? `${v.toFixed(2)}×` : `$${v.toFixed(2)}`);
  return (
    <section className="ops-panel ads-cohort-panel">
      <PanelHeader
        title="注册 Cohort"
        unit={metric === 'ltv' ? 'USD / 人' : '倍'}
        info="按注册日展示累计回收。每列独立色阶；待观察表示尚未达到该窗口，缺失表示已成熟但来源数据缺失。悬浮或方向键查看所在日期与窗口，不联动其他模块。"
        tools={
          <Selector
            label="Cohort指标"
            isLabelHidden
            variant="ghost"
            size="sm"
            value={metric}
            onChange={(v) => setMetric(v as 'ltv' | 'roas')}
            options={[
              { value: 'ltv', label: 'LTV' },
              { value: 'roas', label: 'ROAS' },
            ]}
          />
        }
      />
      {!rows.length ? (
        <PanelState state="empty" reason="所选范围无 Cohort 数据" />
      ) : (
        <div className="ads-cohort-workspace">
          <div className="ads-cohort-scroll">
            <div className="ads-cohort-chart" role="group" aria-label="按注册日和观察窗口排列的回收热力图">
              <div className="ads-cohort-axis">
                <span>注册日</span>
                {horizons.map((h) => (
                  <span key={h}>{h}</span>
                ))}
              </div>
              {rows.map((r, ri) => (
                <div className="ads-cohort-row" key={r.key}>
                  <strong>{r.label}</strong>
                  {r.values.map((c, ci) => {
                    const pending = !mature(r.observedEnd, c.horizon, asOf);
                    const level = c.value == null ? 0 : Math.max(1, Math.min(5, Math.ceil((c.value / maxima[ci]) * 5)));
                    const text = pending ? '待观察' : c.value == null ? '缺失' : format(c.value);
                    const index = ri * 6 + ci;
                    return (
                      <Tooltip
                        key={c.horizon}
                        content={`${r.label} · ${c.horizon} · ${text}`}
                        hasHoverIndication={false}
                        focusTrigger="always"
                      >
                        <button
                          type="button"
                          className="ads-cohort-cell"
                          data-state={pending ? 'pending' : c.value == null ? 'missing' : 'mature'}
                          data-level={level}
                          style={level ? { background: `var(--seq-${level})` } : undefined}
                          aria-label={`${r.label} ${c.horizon} ${text}`}
                          aria-expanded={selected?.row === r.key && selected?.horizon === c.horizon}
                          aria-controls="cohort-reading"
                          onClick={() =>
                            setSelected((old) =>
                              old?.row === r.key && old.horizon === c.horizon
                                ? null
                                : { row: r.key, horizon: c.horizon, index },
                            )
                          }
                          tabIndex={index === 0 ? 0 : -1}
                          ref={(el) => {
                            if (el) refs.current.set(index, el);
                            else refs.current.delete(index);
                          }}
                          onKeyDown={(e) => {
                            const step: Record<string, number> = {
                              ArrowLeft: -1,
                              ArrowRight: 1,
                              ArrowUp: -6,
                              ArrowDown: 6,
                            };
                            if (e.key === 'Escape') {
                              e.preventDefault();
                              closeReading();
                            }
                            if (e.key in step) {
                              e.preventDefault();
                              refs.current.get(index + step[e.key])?.focus();
                            }
                          }}
                        >
                          {pending ? '' : c.value == null ? '—' : format(c.value)}
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <AnimatePresence initial={false}>
            {selected && selectedRow && selectedCell && diagnosis && (
              <motion.aside
                id="cohort-reading"
                className="ads-cohort-reading"
                aria-label="Cohort 回收分析"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 280, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 29, mass: 0.8 }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') closeReading();
                }}
              >
                <div className="ads-cohort-reading-content">
                  <button
                    type="button"
                    className="v62-icon-button"
                    aria-label="收起 Cohort 分析"
                    onClick={closeReading}
                  >
                    <X size={16} />
                  </button>
                  <strong>
                    {diagnosis.status === 'immature'
                      ? '观察窗口尚未成熟'
                      : diagnosis.status === 'unavailable'
                        ? '回收数据暂缺'
                        : diagnosis.status === 'no-users'
                          ? '无注册用户'
                          : diagnosis.status === 'no-cost'
                            ? '未记录获客成本'
                            : diagnosis.status === 'covered'
                              ? '已覆盖获客成本'
                              : diagnosis.status === 'breakeven'
                                ? '已达到收支平衡'
                                : '尚未覆盖获客成本'}
                  </strong>
                  <p>
                    {selectedRow.label} · {selectedCell.horizon}
                  </p>
                  <dl>
                    <div>
                      <dt>LTV</dt>
                      <dd>{diagnosis.ltv == null ? '—' : `$${diagnosis.ltv.toFixed(2)}`}</dd>
                    </div>
                    <div>
                      <dt>CAC</dt>
                      <dd>{diagnosis.cac == null ? '—' : `$${diagnosis.cac.toFixed(2)}`}</dd>
                    </div>
                    <div>
                      <dt>注册用户</dt>
                      <dd>{count(selectedCell.registerUsers)}</dd>
                    </div>
                  </dl>
                  {diagnosis.coverage != null && (
                    <p className="ads-cohort-verdict">
                      已回收获客成本的 <b>{(diagnosis.coverage * 100).toFixed(1)}%</b>
                      {diagnosis.totalGap! < 0
                        ? `，尚差 ${money(-diagnosis.totalGap!)}。`
                        : diagnosis.totalGap! > 0
                          ? `，超出 ${money(diagnosis.totalGap!)}。`
                          : '。'}
                    </p>
                  )}
                </div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      )}
      <footer className="ads-cohort-legend">
        <span>
          低{' '}
          {['1', '2', '3', '4', '5'].map((n) => (
            <i key={n} style={{ background: `var(--seq-${n})` }} />
          ))}{' '}
          高
        </span>
        <span>
          <i />
          待观察
        </span>
        <span>— 缺失</span>
      </footer>
    </section>
  );
}

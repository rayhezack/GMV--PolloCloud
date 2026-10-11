import { Download, RotateCcw, Table2 } from 'lucide-react';
import type { Granularity } from '@shared/api.interface';

/* Canvas toolbar's rail and selected pad, adapted to the chart's real actions.
   Day and week are modes; range, details and export are commands. */
export function CanvasToolbar({
  granularity,
  onGranularityChange,
  onResetRange,
  showData,
  onToggleData,
  onExport,
}: {
  granularity: Granularity;
  onGranularityChange: (value: Granularity) => void;
  onResetRange: () => void;
  showData: boolean;
  onToggleData: () => void;
  onExport: () => void;
}) {
  return (
    <div className="canvas-toolbar" aria-label="图表工具栏">
      <div className="canvas-toolbar-rail">
        {(['day', 'week'] as const).map((value) => (
          <button
            key={value}
            type="button"
            className="canvas-toolbar-tool"
            data-on={granularity === value}
            aria-pressed={granularity === value}
            aria-label={value === 'day' ? '日趋势' : '周趋势'}
            title={value === 'day' ? '日趋势' : '周趋势'}
            onClick={() => onGranularityChange(value)}
          >
            <span>{value === 'day' ? '日' : '周'}</span>
          </button>
        ))}
        <span className="canvas-toolbar-divider" aria-hidden="true" />
        <button type="button" className="canvas-toolbar-tool" aria-label="全部范围" onClick={onResetRange}>
          <RotateCcw size={17} strokeWidth={2} />
          <span className="canvas-toolbar-tip" role="tooltip">全部范围</span>
        </button>
        <button type="button" className="canvas-toolbar-tool" aria-pressed={showData} aria-label={showData ? '收起明细' : '数据明细'} onClick={onToggleData}>
          <Table2 size={17} strokeWidth={2} />
          <span className="canvas-toolbar-tip" role="tooltip">{showData ? '收起明细' : '数据明细'}</span>
        </button>
        <button type="button" className="canvas-toolbar-tool" aria-label="导出 CSV" onClick={onExport}>
          <Download size={17} strokeWidth={2} />
          <span className="canvas-toolbar-tip" role="tooltip">导出 CSV</span>
        </button>
      </div>
    </div>
  );
}

import { shortDay } from '@shared/format';
import { shiftDay } from '@/components/v62/trend-data';

export function DetailComparison({ day, onReset }: { day: string | null; onReset: () => void }) {
  return (
    <div className="sys-detail-comparison" aria-live="polite">
      <span>{day ? `单日对比 · 分析 ${shortDay(day)} · 基准 ${shortDay(shiftDay(day, -7))}` : '业务周对比'}</span>
      {day && (
        <button type="button" className="v62-button" onClick={onReset}>
          恢复周对比
        </button>
      )}
    </div>
  );
}

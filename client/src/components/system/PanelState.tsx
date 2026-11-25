import { Skeleton } from '@astryxdesign/core/Skeleton';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
/** <PanelState state="loading"/>; <PanelState state="partial" days={5}/> */
export function PanelState({
  state,
  reason,
  onRetry,
  days,
}: {
  state: 'loading' | 'empty' | 'partial' | 'error';
  reason?: string;
  onRetry?: () => void;
  days?: number;
}) {
  if (state === 'partial') return <Badge variant="warning" label={`不完整周 ${days ?? '—'}/7 天`} />;
  if (state === 'loading')
    return (
      <div className="sys-panel-loading" role="status" aria-label="正在读取数据">
        <div className="sys-panel-skeleton" aria-hidden="true">
          <Skeleton width="40%" height={16} />
          <Skeleton width="100%" height={48} />
          <Skeleton width="70%" height={16} />
        </div>
      </div>
    );
  return (
    <div className="sys-panel-state" role={state === 'error' ? 'alert' : 'status'}>
      <EmptyState
        isCompact
        title={reason ?? (state === 'error' ? '数据读取失败' : '该日期无数据')}
        actions={
          state === 'error' && onRetry ? <Button label="重试" variant="secondary" onClick={onRetry} /> : undefined
        }
      />
    </div>
  );
}

import { Swirl } from 'loading-dev';
import { WorkbenchIcon } from '@/components/icons/WorkbenchIcon';

/** Shared page refresh: one compact control and the same pending state everywhere. */
export function RefreshButton({ loading, onRefresh, label = '刷新数据' }: {
  loading: boolean;
  onRefresh: () => void;
  label?: string;
}) {
  return <button type="button" className="v62-icon-button sys-refresh-button" aria-label={label}
    title={loading ? '正在刷新…' : label} aria-busy={loading} disabled={loading} onClick={onRefresh}>
    {loading ? <Swirl size={20} color="var(--primary)" aria-hidden="true" /> : <WorkbenchIcon name="rotate-cw" />}
  </button>;
}

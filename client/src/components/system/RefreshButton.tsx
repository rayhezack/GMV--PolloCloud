import { Tooltip } from '@astryxdesign/core/Tooltip';
import { Swirl } from 'loading-dev';
import { WorkbenchIcon } from '@/components/icons/WorkbenchIcon';

/** Shared page refresh: one compact control and the same pending state everywhere. */
export function RefreshButton({
  loading,
  onRefresh,
  label = '刷新数据',
}: {
  loading: boolean;
  onRefresh: () => void;
  label?: string;
}) {
  return (
    <Tooltip content={loading ? '正在刷新…' : label} hasHoverIndication={false} focusTrigger="always" placement="below">
      <button
        type="button"
        className="v62-icon-button sys-refresh-button"
        aria-label={label}
        aria-busy={loading}
        disabled={loading}
        onClick={onRefresh}
      >
        {loading ? <Swirl size={20} color="var(--primary)" aria-hidden="true" /> : <WorkbenchIcon name="rotate-cw" />}
      </button>
    </Tooltip>
  );
}

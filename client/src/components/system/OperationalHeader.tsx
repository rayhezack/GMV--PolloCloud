import { RefreshButton } from '@/components/system/RefreshButton';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, DataFreshness } from './Headers';
import { Modal } from './Modal';
import DashboardDateRangePicker from '@/components/dashboard/DashboardDateRangePicker';
import PlatformSelect from '@/components/v62/PlatformSelect';
import { WorkbenchIcon } from '@/components/icons/WorkbenchIcon';
import type { useOperationalWindow } from './useOperationalWindow';
export function OperationalHeader({
  title,
  window,
  loading,
}: {
  title: string;
  window: ReturnType<typeof useOperationalWindow>;
  loading: boolean;
}) {
  const [updates, setUpdates] = useState(false);
  return (
    <>
      <PageHeader
        title={title}
        tools={
          <>
            <DataFreshness date={window.latest} onClick={() => setUpdates(true)} />
            {window.latest && (
              <DashboardDateRangePicker
                selectedRange={window.dateRange}
                availableRange={window.coverage}
                onRangeChange={window.onRangeChange}
              />
            )}
            <PlatformSelect deviceEnabled={title !== '付费广告'} value={window.platform} onChange={(platform) => window.update({ platform })} />
            <RefreshButton loading={loading} onRefresh={window.refresh} />
            <Link className="v62-button" to={`/report?platform=${window.platform}`}>
              <WorkbenchIcon name="文件夹" />
              诊断报告
            </Link>
          </>
        }
      />
      <Modal open={updates} onOpenChange={setUpdates} title="数据更新">
        <p>最新可用日期 {window.latest || '尚未读取'}</p>
        <Link className="v62-button" to="/?tab=data">
          查看更新记录
        </Link>
      </Modal>
    </>
  );
}

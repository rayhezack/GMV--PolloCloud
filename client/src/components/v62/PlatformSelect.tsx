import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '@/components/ui/select';
import { Definition } from './primitives';
import { useSearchParams } from 'react-router-dom';
import type { DashboardPlatform } from '@shared/api.interface';

function DeviceIcon({ device }: { device: 'android' | 'ios' }) {
  return (
    <svg
      className="v62-device-icon text-platform-device size-4"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {device === 'android' ? (
        <>
          <path d="m7 5-2-3m12 3 2-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path
            d="M5 10a7 7 0 0 1 14 0H5Zm0 1.5h14V18a1 1 0 0 1-1 1h-1v2a1 1 0 0 1-2 0v-2H9v2a1 1 0 0 1-2 0v-2H6a1 1 0 0 1-1-1v-6.5ZM2.5 11a1 1 0 0 1 1 1v5a1 1 0 0 1-2 0v-5a1 1 0 0 1 1-1Zm19 0a1 1 0 0 1 1 1v5a1 1 0 0 1-2 0v-5a1 1 0 0 1 1-1Z"
            fill="currentColor"
          />
          <path d="M8.5 7.5h.01m6.98 0h.01" stroke="var(--surface)" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : (
        <path
          d="M18.71 12.6c.02 3 2.63 4 2.66 4.01-.02.07-.42 1.43-1.38 2.83-.84 1.21-1.71 2.42-3.08 2.45-1.35.03-1.78-.79-3.32-.79-1.53 0-2.01.76-3.29.82-1.32.05-2.32-1.31-3.17-2.52-1.73-2.49-3.06-7.03-1.28-10.1.88-1.53 2.45-2.49 4.15-2.52 1.3-.02 2.53.88 3.32.88.79 0 2.27-1.09 3.82-.93.65.03 2.49.26 3.67 1.98-.09.06-2.19 1.28-2.16 3.89ZM16.2 5.2c.7-.85 1.17-2.03 1.04-3.2-1.01.04-2.23.67-2.95 1.52-.65.75-1.22 1.95-1.07 3.1 1.12.09 2.27-.57 2.98-1.42Z"
          fill="currentColor"
        />
      )}
    </svg>
  );
}

export default function PlatformSelect({
  value,
  onChange,
  allDisabledReason,
  deviceEnabled = true,
}: {
  value: DashboardPlatform;
  onChange: (value: DashboardPlatform) => void;
  allDisabledReason?: string;
  deviceEnabled?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const device =
    value === 'app' && deviceEnabled && ['ios', 'android'].includes(params.get('deviceType') || '')
      ? params.get('deviceType')
      : null;
  const choose = (selection: string) => {
    const platform = selection.startsWith('app:') ? 'app' : (selection as DashboardPlatform);
    onChange(platform);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.set('platform', platform);
        if (selection.startsWith('app:')) next.set('deviceType', selection.slice(4));
        else next.delete('deviceType');
        return next;
      },
      { replace: true },
    );
  };
  return (
    <>
      <Select value={device ? `app:${device}` : value} onValueChange={choose}>
        <SelectTrigger aria-label="数据端" className="v62-select">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="v62-select-menu">
          <SelectItem disabled={Boolean(allDisabledReason)} value="all">
            全部端
          </SelectItem>
          <SelectItem value="web">Web</SelectItem>
          <SelectItem value="app">App</SelectItem>
          <SelectItem disabled={!deviceEnabled} value="app:android">
            <span className="v62-device-label">
              <DeviceIcon device="android" />
              Android
            </span>
          </SelectItem>
          <SelectItem disabled={!deviceEnabled} value="app:ios">
            <span className="v62-device-label">
              <DeviceIcon device="ios" />
              iOS
            </span>
          </SelectItem>
          {!deviceEnabled && <p className="v62-device-unavailable">当前数据源仅提供 App 汇总，暂不支持设备拆分。</p>}
        </SelectContent>
      </Select>
      {allDisabledReason && <Definition label="全部端不可用说明">{allDisabledReason}</Definition>}
    </>
  );
}

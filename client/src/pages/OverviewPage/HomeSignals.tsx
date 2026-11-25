import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Definition } from '@/components/v62/primitives';
import type { DashboardGmvAnomalyResponse } from '@shared/api.interface';
type Alert = DashboardGmvAnomalyResponse['alerts'][number];
export function HomeSignals({
  latestDate,
  signals,
  loading,
  monitorAvailable,
  onDetails,
  anomalyHref,
  renderProcess,
  primarySignal,
  diagnosis,
}: {
  diagnosis?: ReactNode;
  latestDate: string;
  signals: Alert[];
  loading: boolean;
  monitorAvailable: boolean;
  onDetails: () => void;
  anomalyHref: (alert: Alert) => string;
  primarySignal?: Alert;
  renderProcess?: (state: { alerts: Alert[]; available: boolean; loading: boolean }) => ReactNode;
}) {
  return (
    <>
      <section className="daily-bento daily-bento-anomaly" aria-labelledby="daily-anomaly-title">
        <div className="home-signals-body">
          <div className="daily-rail-heading">
            <h2 id="daily-anomaly-title">异动与线索</h2>
            <span className="v62-day-label">{latestDate}</span>
          </div>
          <div className="v62-daily-columns">
            <div>
              <div className="daily-anomaly-headline">
                <strong style={{ color: signals.length ? undefined : 'var(--v62-ink)' }}>
                  {loading ? '—' : monitorAvailable && signals.length ? signals.length : ''}
                </strong>
                <span>
                  {loading ? '读取中' : monitorAvailable ? (signals.length ? '项异动' : '无异动') : '等待监测数据'}
                </span>
                <Definition label="异动阈值说明">
                  大盘、Web、App 分别按最近 12 个完整业务周计算动态阈值，较前一日与上周同日分别计算。 上涨阈值取
                  max（P95，10%），下降阈值取 min（P5，−10%）；10% 只是最低门槛，任一比较触发即为异动。
                </Definition>
              </div>
              <div className="daily-signal-list">
                {signals.map((alert) => (
                  <Link key={`${alert.platform}:${alert.metric}`} to={anomalyHref(alert)} className="daily-signal-row">
                    <span>
                      {{ all: '全端', web: 'Web', app: 'App' }[alert.platform]} ·{' '}
                      {{ totalGmv: '大盘 GMV', activeGmv: '主动付费', renewalGmv: '自动续订' }[alert.metric]}
                      <small>{alert.window === 'day' ? '较前一日' : '较上周同日'}</small>
                    </span>
                    <b data-direction={alert.direction}>
                      {alert.direction === 'down' ? <ArrowDownRight size={14} /> : <ArrowUpRight size={14} />}
                      {Math.abs(alert.change * 100).toFixed(1)}%
                    </b>
                  </Link>
                ))}
              </div>
              {!loading && !monitorAvailable && <p className="daily-muted">监测数据暂不可用</p>}
              <Button
                className="daily-monitor-link"
                variant="ghost"
                size="sm"
                onClick={onDetails}
                disabled={loading || !monitorAvailable}
              >
                查看监测详情
              </Button>
            </div>
            <div>
              {renderProcess?.({
                alerts: primarySignal ? [primarySignal] : [],
                available: monitorAvailable,
                loading,
              })}{' '}
            </div>
          </div>
        </div>
        {diagnosis}
      </section>
    </>
  );
}

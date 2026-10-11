import type { Platform, ReportGenerationRequest } from '@shared/api.interface';
import {
  getBusinessWeekStart,
  getLatestCompleteFriday,
  parseDateString,
  toDateString,
} from '@shared/business-week';

const DAY_MS = 24 * 60 * 60 * 1000;
const BEIJING_TIME_FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function buildDefaultRequest(
  platform: Platform,
): ReportGenerationRequest {
  const end = getLatestCompleteFriday();
  const latestWeekStart = getBusinessWeekStart(end);
  const start = toDateString(
    new Date(parseDateString(latestWeekStart).getTime() - 7 * DAY_MS),
  );
  return {
    platform,
    granularity: 'week',
    startDate: start,
    endDate: end,
  };
}

export function formatGeneratedAt(value: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = BEIJING_TIME_FORMATTER.formatToParts(date).reduce<
    Partial<Record<Intl.DateTimeFormatPartTypes, string>>
  >((current, part) => {
    current[part.type] = part.value;
    return current;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

export function getReportPeriodKey(
  periodStart: string,
  periodEnd: string,
): string {
  return `${periodStart}__${periodEnd}`;
}

export function parseReportPeriodKey(
  value: string | null,
): { periodStart: string; periodEnd: string } | null {
  if (!value) return null;
  const [periodStart, periodEnd] = value.split('__');
  if (!periodStart || !periodEnd) return null;
  return { periodStart, periodEnd };
}

export function formatAnalysisWeekLabel(
  periodStart: string,
  periodEnd: string,
): string {
  if (!periodEnd) return `${periodStart} ~ ${periodEnd}`;
  const analysisStart = toDateString(
    new Date(parseDateString(periodEnd).getTime() - 6 * DAY_MS),
  );
  return `${analysisStart} ~ ${periodEnd}`;
}

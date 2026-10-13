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
  const latestCompleteEnd = getLatestCompleteFriday();
  const latestAvailableEnd = toDateString(new Date(Date.now() - DAY_MS));
  const latestAvailableWeekStart = getBusinessWeekStart(latestAvailableEnd);
  const latestCompleteWeekStart = getBusinessWeekStart(latestCompleteEnd);
  const isIncomplete = latestAvailableWeekStart > latestCompleteWeekStart;
  const end = isIncomplete ? latestAvailableEnd : latestCompleteEnd;
  const analysisStart = isIncomplete ? latestAvailableWeekStart : latestCompleteWeekStart;
  const start = toDateString(
    new Date(parseDateString(analysisStart).getTime() - 7 * DAY_MS),
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd ?? '')) return null;
  const end = parseDateString(periodEnd);
  if (Number.isNaN(end.getTime())) return null;
  const latestAvailableDate = parseDateString(toDateString(new Date(Date.now() - DAY_MS)));
  if (end > latestAvailableDate) return null;
  const analysisWeekStart = getBusinessWeekStart(periodEnd);
  const expectedStart = toDateString(new Date(parseDateString(analysisWeekStart).getTime() - 7 * DAY_MS));
  if (periodStart !== expectedStart) return null;
  return { periodStart, periodEnd };
}

export function reportWeekOptions(history: Array<{ periodStart: string; periodEnd: string }>) {
  const latestComplete = parseDateString(getLatestCompleteFriday());
  const latestAvailable = parseDateString(toDateString(new Date(Date.now() - DAY_MS)));
  const weeks = new Map(history.map(item => [getReportPeriodKey(item.periodStart, item.periodEnd), item]));
  const latestIncompleteStart = parseDateString(getBusinessWeekStart(toDateString(latestAvailable)));
  if (latestIncompleteStart > latestComplete) {
    const periodStart = toDateString(new Date(latestIncompleteStart.getTime() - 7 * DAY_MS));
    const periodEnd = toDateString(latestAvailable);
    weeks.set(getReportPeriodKey(periodStart, periodEnd), { periodStart, periodEnd });
  }
  for (let end = latestComplete; end.getFullYear() === latestComplete.getFullYear(); end = new Date(end.getTime() - 7 * DAY_MS)) {
    const periodEnd = toDateString(end);
    const periodStart = toDateString(new Date(end.getTime() - 13 * DAY_MS));
    if (periodStart < `${latestComplete.getFullYear()}-01-01`) continue;
    weeks.set(getReportPeriodKey(periodStart, periodEnd), { periodStart, periodEnd });
  }
  return [...weeks.values()].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
}

export function formatAnalysisWeekLabel(
  periodStart: string,
  periodEnd: string,
): string {
  if (!periodEnd) return `${periodStart} ~ ${periodEnd}`;
  const analysisStart = toDateString(
    new Date(parseDateString(periodStart).getTime() + 7 * DAY_MS),
  );
  return `${analysisStart} ~ ${periodEnd}`;
}

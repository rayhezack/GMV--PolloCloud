const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

export function isValidDateString(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}

export function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseDateString(value: string): Date {
  const [year, month, day] = value.split('-').map((part: string) => Number(part));
  return new Date(year, month - 1, day);
}

/**
 * 最近一个完整业务周的结束日：严格早于当前日期的最近一个周五。
 * 若今天是周五，则取上一周的周五；周六至周五构成完整业务周。
 */
export function getLatestCompleteFriday(now: Date = new Date()): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = new Date(today.getTime() - offset * DAY_MS);
    if (candidate.getDay() === 5) return toDateString(candidate);
  }
  return toDateString(today);
}

/**
 * 日期所属业务周（周六至周五）的起始周六。
 */
export function getBusinessWeekStart(dateStr: string): string {
  const date = parseDateString(dateStr);
  const daysSinceSaturday = (date.getDay() + 1) % 7;
  return toDateString(new Date(date.getTime() - daysSinceSaturday * DAY_MS));
}

export function getBusinessWeekEnd(dateStr: string): string {
  const weekStart = parseDateString(getBusinessWeekStart(dateStr));
  return toDateString(new Date(weekStart.getTime() + 6 * DAY_MS));
}

export function listDatesInRange(startDate: string, endDate: string): string[] {
  const start = parseDateString(startDate);
  const end = parseDateString(endDate);
  const dates: string[] = [];
  for (let cursor = new Date(start); cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    dates.push(toDateString(cursor));
  }
  return dates;
}

import type { DashboardPlatform } from '../shared/api.interface';

type DatedAlert = { period?: string; platform?: string };

/** Historical rings come from persisted diagnoses; the latest day comes only from the live detector. */
export function mergeAnomalyDates(
  persisted: string[],
  latestDay: string,
  alerts: DatedAlert[],
  scope: DashboardPlatform,
) {
  const dates = new Set(persisted.filter((date) => date && date !== latestDay));
  if (alerts.some((alert) => alert.period === latestDay && alert.platform === scope)) dates.add(latestDay);
  return [...dates].sort();
}

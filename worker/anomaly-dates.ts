type DatedAlert = { period?: string };

/** Historical rings come from persisted diagnoses; the latest day comes only from the live detector. */
export function mergeAnomalyDates(persisted: string[], latestDay: string, alerts: DatedAlert[]) {
  const dates = new Set(persisted.filter((date) => date && date !== latestDay));
  if (alerts.some((alert) => alert.period === latestDay)) dates.add(latestDay);
  return [...dates].sort();
}

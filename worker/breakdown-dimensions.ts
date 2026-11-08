// All spellings of a missing dimension must share one aggregation key.
export const BREAKDOWN_VALUE_SQL = "CASE WHEN breakdown_value IS NULL OR LOWER(TRIM(breakdown_value)) IN ('', 'unknown', '未知', '未记录', 'null', 'undefined') THEN 'unknown' ELSE TRIM(breakdown_value) END";

"""Read-only audit of creation coverage and all additive drilldown metrics."""
import argparse
import datetime as dt
import importlib.util
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('creation_backfill', ROOT / 'scripts/backfill-creation-chain.py')
backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backfill)
COUNTS = ['creation_task_cnt', 'valid_creation_task_cnt', 'success_task_cnt',
          'success_output_cnt', 'adopted_task_cnt', 'adopted_output_cnt']


def audit(start, end):
    where = f"period BETWEEN '{start}' AND '{end}'"
    def query(sql):
        return backfill.remote(sql)[0]['results']
    coverage = {}
    for kind, table in backfill.TABLES.items():
        coverage[kind] = query(f"SELECT platform_type,COUNT(*) rows,COUNT(DISTINCT period) days,MIN(period) first,MAX(period) last FROM {table} WHERE {where} GROUP BY platform_type")
        keys = ['period', 'platform_type'] + (backfill.SEGMENTS if kind == 'function' else [])
        duplicate = query(f"SELECT COUNT(*) failures FROM (SELECT 1 FROM {table} WHERE {where} GROUP BY {','.join(keys)} HAVING COUNT(*)<>1)")[0]['failures']
        assert duplicate == 0, (kind, 'duplicate grain', duplicate)
        expected = (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days + 1
        by_platform = {row['platform_type']: row for row in coverage[kind]}
        for platform in ['WEB', 'IOS', 'ANDROID', '汇总']:
            row = by_platform[platform]
            assert (row['days'], row['first'], row['last']) == (expected, start, end), (kind, platform, row)
    fields = COUNTS + ['gmv_usd']
    sums = ','.join(f'SUM({f}) AS {f}' for f in fields)
    failures = ','.join(f"SUM(CASE WHEN p.{f}<>COALESCE(c.{f},0) THEN 1 ELSE 0 END) AS {f}" for f in COUNTS)
    conservation = query(f"""WITH p AS (SELECT period,platform_type,{sums} FROM pollo_da_creation_overall_daily WHERE {where} GROUP BY 1,2),
 c AS (SELECT period,platform_type,{sums} FROM pollo_da_creation_function_daily WHERE {where} GROUP BY 1,2)
 SELECT COUNT(*) groups,{failures},SUM(CASE WHEN ROUND(p.gmv_usd*1000000)<>ROUND(COALESCE(c.gmv_usd,0)*1000000) THEN 1 ELSE 0 END) gmv_usd FROM p LEFT JOIN c USING(period,platform_type)""")[0]
    assert all(conservation[field] == 0 for field in fields), conservation
    activity = query(f"SELECT platform,COUNT(DISTINCT period) days,MIN(period) first,MAX(period) last FROM pollo_da_fact_rows WHERE dataset='creative' AND dataset_kind='daily' AND {where} GROUP BY platform")
    for row in activity:
        assert (row['days'], row['first'], row['last']) == (expected, start, end), row
    return {'window': {'start': start, 'end': end, 'days': expected}, 'coverage': coverage,
            'duplicateGrainFailures': 0, 'additiveMetricMismatchGroups': conservation,
            'gmvPrecision': '0.000001 USD', 'activityCoverage': activity,
            'uvRule': 'Overall UV/retained UV use deduplicated summary; function UV cannot be added across functions. Activity rates use the activity-tier population for both numerator and denominator.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', default='2026-01-01')
    parser.add_argument('--end', required=True)
    args = parser.parse_args()
    result = audit(args.start, args.end)
    destination = ROOT / 'archives' / f'creation-history-{args.start}-{args.end}' / 'remote-audit.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))

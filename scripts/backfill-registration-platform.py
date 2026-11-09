"""Stage the full registration-platform aggregate, reconcile payment totals, then activate it.

Warehouse reads are performed by backfill-payment-registration.py --export-only.
Only aggregate dimensions and GMV are uploaded; no users or orders leave the warehouse.
"""
import argparse
import concurrent.futures
import datetime as dt
import hashlib
import importlib.util
import json
import pathlib
from collections import Counter

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('registration_repair', ROOT / 'scripts/repair-payment-registration-remote.py')
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)
remote, literal, COLUMNS = repair.remote, repair.literal, repair.COLUMNS
STAGE = 'pollo_da_payment_tier_stage_20261109'


def validate_stage(start, end, count, allowed_dates=()):
    bounds = f'period BETWEEN {literal(start)} AND {literal(end)}'
    summary = remote(f'SELECT COUNT(*) AS rows,COUNT(DISTINCT period) AS days,MIN(period) AS first,MAX(period) AS last FROM {STAGE} WHERE {bounds}')[0]['results'][0]
    if summary['rows'] != count or summary['days'] != (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days + 1:
        raise ValueError(('stage coverage mismatch', summary, count))
    # Registration rows are stored once by payment platform, while canonical facts carry all/web/app scopes.
    sql = f"""WITH actual AS (
      SELECT period,'all' AS platform,device_type,pay_type,SUM(gmv_usd) AS gmv FROM {STAGE} WHERE {bounds} GROUP BY 1,3,4
      UNION ALL SELECT period,platform,device_type,pay_type,SUM(gmv_usd) AS gmv FROM {STAGE} WHERE {bounds} AND platform IN ('web','app') GROUP BY 1,2,3,4
    ), expected AS (
      SELECT period,platform,device_type,pay_type,SUM(gmv_usd) AS gmv FROM pollo_da_fact_rows_read
      WHERE dataset='pay_type' AND dataset_kind='daily' AND attribution_type='NONE' AND pay_type<>'汇总' AND {bounds}
      GROUP BY 1,2,3,4
    ), differences AS (
      SELECT a.period,a.platform,a.device_type,a.pay_type,a.gmv-COALESCE(e.gmv,0) AS difference
      FROM actual a LEFT JOIN expected e USING(period,platform,device_type,pay_type)
      UNION ALL SELECT e.period,e.platform,e.device_type,e.pay_type,-e.gmv FROM expected e LEFT JOIN actual a USING(period,platform,device_type,pay_type) WHERE a.period IS NULL
    ) SELECT COUNT(*) AS groups_checked,SUM(CASE WHEN ABS(difference)>=0.005 THEN 1 ELSE 0 END) AS mismatches,MAX(ABS(difference)) AS max_difference FROM differences"""
    result = remote(sql)[0]['results'][0]
    if result['mismatches']:
        prefix = sql[:sql.index(' SELECT COUNT(*) AS groups_checked')]
        differences = remote(prefix + ' SELECT * FROM differences WHERE ABS(difference)>=0.005')[0]['results']
        from collections import defaultdict
        net = defaultdict(float)
        for row in differences:
            if row['period'] not in allowed_dates:
                raise ValueError(('unapproved classification mismatch; active table unchanged', differences))
            net[(row['period'],row['platform'],row['device_type'])] += row['difference']
        if any(abs(amount)>=0.005 for amount in net.values()):
            raise ValueError(('total GMV mismatch; active table unchanged', dict(net)))
        result['classificationDifferences'] = differences
        result['note'] = 'Upstream pay-type classification differs; total GMV conserved. Existing API reconciliation must suppress affected pay types.'
    return {**summary, **result}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('aggregate', type=pathlib.Path)
    parser.add_argument('--activate', action='store_true', help='Publish a previously staged and reconciled full aggregate')
    parser.add_argument('--allow-reclassification-date', action='append', default=[], help='Only allow verified upstream reclassifications with zero net daily GMV change')
    args = parser.parse_args()
    rows = json.loads(args.aggregate.read_text())
    start, end = min(row['period'] for row in rows), max(row['period'] for row in rows)
    active = remote('SELECT MIN(period) AS first,MAX(period) AS last FROM pollo_da_payment_registration')[0]['results'][0]
    if start > active['first'] or end < active['last']:
        raise ValueError(('full replacement must cover all active dates', active, start, end))
    identity = [column for column in COLUMNS if column not in ('gmv_usd', 'week_start')]
    if len({tuple(row[c] for c in identity) for row in rows}) != len(rows):
        raise ValueError('duplicate aggregate identity')
    if any(row['reg_platform'] not in ('WEB','IOS','ANDROID','OTHER','UNKNOWN') or row['platform'] not in ('web','app','unknown') for row in rows):
        raise ValueError('unexpected registration or payment platform; check source before importing')
    if any(row['country_tier'] not in ('T1','T2','T3') for row in rows):
        raise ValueError('unexpected country tier')
    if not args.activate:
        schema = (ROOT / 'db/0015_payment_registration.sql').read_text().replace('pollo_da_payment_registration', STAGE).replace('payment_registration_scope', 'payment_registration_platform_stage_scope')
        remote(schema)
        remote(f'DELETE FROM {STAGE}')
        def upload(batch):
            values = ','.join('('+','.join(literal(row[c]) for c in COLUMNS)+')' for row in batch)
            remote(f'INSERT OR REPLACE INTO {STAGE} ({",".join(COLUMNS)}) VALUES {values}')
            return len(batch)
        completed = 0
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(upload, rows[i:i+400]) for i in range(0,len(rows),400)]
            for index, future in enumerate(concurrent.futures.as_completed(futures)):
                completed += future.result()
                if (index+1) % 25 == 0 or completed == len(rows):
                    print(f'staged {completed}/{len(rows)}', flush=True)
    result = validate_stage(start,end,len(rows),args.allow_reclassification_date)
    if args.activate:
        columns = remote('PRAGMA table_info(pollo_da_payment_registration)')[0]['results']
        if 'sku' not in {row['name'] for row in columns}:
            remote('CREATE TABLE IF NOT EXISTS pollo_da_payment_registration_before_platform_20261109 AS SELECT * FROM pollo_da_payment_registration')
            remote((ROOT / 'db/0020_payment_registration_platform.sql').read_text())
        if 'country_tier' not in {row['name'] for row in columns}:
            remote((ROOT / 'db/0021_payment_registration_country_tier.sql').read_text())
        remote(f'DELETE FROM pollo_da_payment_registration WHERE period BETWEEN {literal(start)} AND {literal(end)}; '
               f'INSERT INTO pollo_da_payment_registration ({",".join(COLUMNS)}) SELECT {",".join(COLUMNS)} FROM {STAGE} WHERE period BETWEEN {literal(start)} AND {literal(end)}; '
               "DELETE FROM dashboard_response_cache WHERE cache_key LIKE '%/api/dashboard/payment-analysis?%';")
        actual = remote(f'SELECT COUNT(*) AS rows FROM pollo_da_payment_registration WHERE period BETWEEN {literal(start)} AND {literal(end)}')[0]['results'][0]['rows']
        if actual != len(rows):
            raise ValueError(('active row count mismatch',actual,len(rows)))
        # Compare full identities and amounts, not only their parent totals.
        mismatch = remote(f'''WITH missing AS (SELECT {','.join(COLUMNS)} FROM {STAGE} EXCEPT SELECT {','.join(COLUMNS)} FROM pollo_da_payment_registration),
          extra AS (SELECT {','.join(COLUMNS)} FROM pollo_da_payment_registration EXCEPT SELECT {','.join(COLUMNS)} FROM {STAGE})
          SELECT (SELECT COUNT(*) FROM missing)+(SELECT COUNT(*) FROM extra) AS n''')[0]['results'][0]['n']
        if mismatch:
            raise ValueError(('active registration dimensions differ from source stage',mismatch))
        result['activeRows'] = actual
    result.update({'start':start,'end':end,'activated':args.activate,'regPlatforms':dict(Counter(row['reg_platform'] for row in rows)),
                   'sourceSha256':hashlib.sha256(args.aggregate.read_bytes()).hexdigest()})
    output = args.aggregate.with_suffix('.platform-activation.json' if args.activate else '.platform-stage.json')
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps(result,ensure_ascii=False),flush=True)

if __name__ == '__main__':
    main()

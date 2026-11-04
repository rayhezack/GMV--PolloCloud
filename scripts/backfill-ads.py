"""Backfill aggregated ad cohorts from MaxCompute into Pollo Cloud D1."""
import argparse
import datetime as dt
import decimal
import importlib.util
import json
import pathlib
import subprocess
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'archives/ads-backfill.jsonl'
SQL_BATCH = ROOT / 'archives/ads-backfill-batch.sql'
HELPER = pathlib.Path.home() / '.codex/skills/aliyun-maxcompute-warehouse/scripts/maxcompute_query.py'
spec = importlib.util.spec_from_file_location('warehouse', HELPER)
warehouse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(warehouse)
COLUMNS = ['period', 'week_start', 'week_end', 'channel', 'country', 'platform', 'cost_usd',
           'impressions', 'clicks', 'register_user_cnt', 'gmv_d0', 'gmv_d14', 'gmv_d30',
           'gmv_d60', 'gmv_d90', 'gmv_d180', 'updated_at']
METRICS = COLUMNS[6:-1]


def remote(sql=None, file=None):
    command = ['pollocloud', 'db', 'execute', '--name', 'pollo-ai', '--json']
    command += ['--file', str(file)] if file else ['--command', sql]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(result.stderr + result.stdout)
    payload = json.loads(result.stdout[result.stdout.index('['):])
    if not all(item['success'] for item in payload):
        raise RuntimeError(payload)
    return payload


def literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def business_week(date):
    start = date - dt.timedelta(days=(date.weekday() + 2) % 7)
    return str(start), str(start + dt.timedelta(days=6))


def extract(start, end):
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    week = "CAST(DATEADD(CAST(stat_date AS DATETIME), -CAST(PMOD(WEEKDAY(CAST(stat_date AS DATETIME)) + 2, 7) AS BIGINT), 'dd') AS DATE)"
    sql = f"""SELECT CAST(stat_date AS DATE) AS period, {week} AS week_start,
      DATE_ADD({week}, 6) AS week_end, UPPER(ad_platform) AS channel,
      UPPER(country) AS country, UPPER(source_end) AS platform,
      SUM(COALESCE(cost_usd,0)) AS cost_usd,
      SUM(COALESCE(impressions,0)) AS impressions,
      SUM(COALESCE(clicks,0)) AS clicks,
      SUM(COALESCE(cohort_user_cnt,0)) AS register_user_cnt,
      SUM(COALESCE(gmv_usd_d0,0)) AS gmv_d0,
      SUM(gmv_usd_d14) AS gmv_d14, SUM(gmv_usd_d30) AS gmv_d30,
      SUM(gmv_usd_d60) AS gmv_d60, SUM(gmv_usd_d90) AS gmv_d90,
      SUM(gmv_usd_d180) AS gmv_d180
    FROM mc_prd.ads_pollo_ad_attribution_daily_dip
    WHERE p_date BETWEEN '{start:%Y%m%d}' AND '{end:%Y%m%d}'
      AND stat_date BETWEEN CAST(TO_DATE('{start:%Y%m%d}', 'yyyymmdd') AS DATE)
                        AND CAST(TO_DATE('{end:%Y%m%d}', 'yyyymmdd') AS DATE)
      AND product_type='ALL' AND is_first_purchase='汇总'
    GROUP BY stat_date, UPPER(ad_platform), UPPER(country), UPPER(source_end)"""
    client = warehouse.get_odps(argparse.Namespace(access_id=None, secret=None, project=None, endpoint=None))
    instance = client.execute_sql(sql, hints={'odps.sql.type.system.odps2': 'true'})
    print('MaxCompute instance', instance.id, flush=True)
    count = 0
    with OUTPUT.open('w') as output, instance.open_reader(tunnel=True) as reader:
        names = [column.name.lower() for column in reader.schema.columns]
        for record in reader:
            row = dict(zip(names, record.values))
            for key, value in row.items():
                if isinstance(value, (dt.date, dt.datetime)):
                    row[key] = str(value)[:10]
                elif isinstance(value, decimal.Decimal):
                    row[key] = float(value)
            output.write(json.dumps(row, ensure_ascii=False) + '\n')
            count += 1
    print('extracted', count, 'rows', flush=True)


def validated_rows(start, end):
    dates = set()
    keys = set()
    rows = []
    for line in OUTPUT.open():
        row = json.loads(line)
        date = dt.date.fromisoformat(row['period'])
        assert start <= date <= end, ('date outside range', date)
        assert (row['week_start'], row['week_end']) == business_week(date), ('business week', row)
        key = (row['period'], row['channel'], row['country'], row['platform'])
        assert all(key) and key not in keys, ('duplicate or null grain', key)
        keys.add(key)
        for metric in METRICS[:5]:
            assert row[metric] is not None and row[metric] >= 0, ('required metric', metric, key)
        dates.add(date)
        rows.append(row)
    expected = {start + dt.timedelta(days=offset) for offset in range((end - start).days + 1)}
    assert dates == expected, ('missing dates', sorted(expected - dates))
    return rows


def backfill(start, end):
    if not OUTPUT.exists():
        extract(start, end)
    rows = validated_rows(start, end)
    remote('CREATE TABLE IF NOT EXISTS pollo_da_ads_backfill_stage AS SELECT * FROM pollo_da_ads_daily WHERE 0')
    remote(f"DELETE FROM pollo_da_ads_backfill_stage WHERE period BETWEEN '{start}' AND '{end}'")
    header = 'INSERT INTO pollo_da_ads_backfill_stage (' + ','.join(COLUMNS) + ') VALUES '
    batch = []
    size = 0
    statements = []
    file_size = 0

    def flush_file():
        nonlocal statements, file_size
        if statements:
            SQL_BATCH.write_text('\n'.join(statements))
            remote(file=SQL_BATCH)
            statements, file_size = [], 0

    def flush_statement():
        nonlocal batch, size, file_size
        if not batch:
            return
        statement = header + ','.join(batch) + ';'
        statements.append(statement)
        file_size += len(statement.encode())
        batch, size = [], 0
        if file_size >= 700000:
            flush_file()

    for row in rows:
        values = '(' + ','.join(literal(row.get(column) if column != 'updated_at' else int(time.time() * 1000)) for column in COLUMNS) + ')'
        if size + len(values.encode()) > 30000:
            flush_statement()
        batch.append(values)
        size += len(values.encode())
    flush_statement()
    flush_file()
    staged = remote(f"SELECT COUNT(*) n, COUNT(DISTINCT period) days FROM pollo_da_ads_backfill_stage WHERE period BETWEEN '{start}' AND '{end}'")[0]['results'][0]
    assert staged['n'] == len(rows) and staged['days'] == (end - start).days + 1, staged
    activate = f"""DELETE FROM pollo_da_ads_daily WHERE period BETWEEN '{start}' AND '{end}';
    INSERT INTO pollo_da_ads_daily SELECT * FROM pollo_da_ads_backfill_stage WHERE period BETWEEN '{start}' AND '{end}';
    DELETE FROM pollo_da_ads_backfill_stage WHERE period BETWEEN '{start}' AND '{end}';"""
    remote(activate)
    actual = remote(f"SELECT COUNT(*) n, COUNT(DISTINCT period) days FROM pollo_da_ads_daily WHERE period BETWEEN '{start}' AND '{end}'")[0]['results'][0]
    assert actual['n'] == len(rows) and actual['days'] == (end - start).days + 1, actual
    print('remote backfill verified', actual, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', default='2026-01-01')
    parser.add_argument('--end', default='2026-11-03')
    args = parser.parse_args()
    OUTPUT = ROOT / f'archives/ads-backfill-{args.start}-{args.end}.jsonl'
    backfill(dt.date.fromisoformat(args.start), dt.date.fromisoformat(args.end))

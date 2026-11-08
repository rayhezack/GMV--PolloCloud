"""Extract and replace 2026 payment attribution facts at product/SKU grain."""

import argparse
import datetime as dt
import decimal
import hashlib
import http.client
import importlib.util
import json
import pathlib
import subprocess
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / '.local-data' / 'pay-type-products-backfill'
OUT.mkdir(parents=True, exist_ok=True)
HELPER = pathlib.Path.home() / '.codex/skills/aliyun-maxcompute-warehouse/scripts/maxcompute_query.py'
spec = importlib.util.spec_from_file_location('warehouse', HELPER)
warehouse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(warehouse)
STAGE = 'pollo_da_pay_type_product_stage_20261107'
CONFIG = json.loads((pathlib.Path.home() / '.pollocloud' / 'config.json').read_text())
TOKEN = CONFIG['token']
FIRST = dt.date(2026, 1, 1)
MODES = {'NONE', 'CREATION_MODE', 'MODEL', 'ACTUAL_MODEL'}
IDENTITY = ['period', 'week_start', 'week_end', 'platform', 'device_type',
            'pay_type', 'function_name', 'attribution_type', 'attribution_name',
            'actual_supplier', 'actual_provider', 'pay_category',
            'product_type', 'product_type_lv2']
COLUMNS = ['dataset', 'source_record_id', 'period', 'week_start', 'week_end',
           'platform', 'device_type', 'dataset_kind', 'pay_type', 'function_name',
           'pay_user_cnt', 'gmv_usd', 'order_equivalent', 'model_cost_usd',
           'attribution_type', 'attribution_name', 'actual_supplier', 'actual_provider',
           'pay_category', 'product_type', 'product_type_lv2', 'fields_json', 'updated_at']


def months(end):
    start = FIRST
    while start <= end:
        next_month = (start.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        yield start, min(end, next_month - dt.timedelta(days=1))
        start = next_month


def path_for(start):
    return OUT / f'{start:%Y%m}.jsonl'


def extract(start, end, client):
    output = path_for(start)
    validation = OUT / f'{start:%Y%m}-validation.json'
    covered_days = (end - start).days + 1
    if output.exists() and validation.exists() and json.loads(validation.read_text()).get('days') == covered_days:
        validate(start, end)
        return
    sql = subprocess.check_output([
        '/usr/local/bin/node', '--experimental-strip-types', '--input-type=module', '-e',
        "import {buildMiddleTableSql} from './server/modules/maxcompute/middle-table-sql.ts'; console.log(buildMiddleTableSql('pay_type','all',process.argv[1],process.argv[2]));",
        f'{start:%Y%m%d}', f'{end:%Y%m%d}',
    ], cwd=ROOT, text=True)
    sql = sql.replace('SET odps.sql.type.system.odps2=true;', '')
    instance = client.execute_sql(sql, hints={'odps.sql.type.system.odps2': 'true'})
    print('extract', start, end, 'instance', instance.id, flush=True)
    temp = output.with_suffix('.tmp')
    count = expected = None
    with instance.open_reader(tunnel=True) as reader, temp.open('w') as file:
        names = [column.name.lower() for column in reader.schema.columns]
        for record in reader:
            row = dict(zip(names, record.values))
            for key, value in row.items():
                if isinstance(value, (dt.date, dt.datetime)):
                    row[key] = str(value)[:10]
                elif isinstance(value, decimal.Decimal):
                    row[key] = str(value)
            expected = int(row['source_row_count']) if expected is None else expected
            file.write(json.dumps(row, ensure_ascii=False) + '\n')
            count = (count or 0) + 1
    if not count or count != expected:
        raise ValueError((start, 'incomplete Tunnel export', count, expected))
    temp.replace(output)
    print('saved', output, count, flush=True)
    validate(start, end)


def rows_for(start):
    with path_for(start).open() as file:
        for line in file:
            yield json.loads(line)


def validate(start, end):
    identities = set()
    sums = defaultdict(lambda: defaultdict(lambda: [decimal.Decimal(0), decimal.Decimal(0)]))
    dates = set()
    count = expected = 0
    platforms = defaultdict(int)
    totals = defaultdict(lambda: [decimal.Decimal(0), decimal.Decimal(0)])
    for row in rows_for(start):
        count += 1
        expected = int(row['source_row_count'])
        dates.add(row['period'])
        if not str(start) <= row['period'] <= str(end) or row['device_type'] not in ('web', 'ios', 'android', 'unknown'):
            raise ValueError(('invalid date/device', row['period'], row['device_type']))
        key = tuple(row.get(field) for field in IDENTITY if field != 'platform')
        if key in identities:
            raise ValueError(('duplicate grain', key))
        identities.add(key)
        scopes = ['all'] + (['web'] if row['device_type'] == 'web' else ['app'] if row['device_type'] in ('ios', 'android') else [])
        for scope in scopes:
            platforms[scope] += 1
            if row['pay_type'] != '汇总':
                group = (scope, row['period'], row['device_type'], row['pay_category'],
                         row['pay_type'], row['product_type'], row['product_type_lv2'])
                for index, metric in enumerate(('gmv_usd', 'order_equivalent')):
                    value = decimal.Decimal(str(row[metric] or 0))
                    sums[group][row['attribution_type']][index] += value
                    totals[(scope, row['attribution_type'])][index] += value
    expected_dates = {(start + dt.timedelta(days=n)).isoformat() for n in range((end - start).days + 1)}
    if dates != expected_dates or count != expected:
        raise ValueError(('coverage or row count', start, count, expected, len(dates), len(expected_dates)))
    for key, modes in sums.items():
        if set(modes) != MODES:
            raise ValueError(('missing attribution mode', key, set(modes)))
        for mode in MODES - {'NONE'}:
            if any(abs(modes[mode][index] - modes['NONE'][index]) > decimal.Decimal('.000001') for index in (0, 1)):
                raise ValueError(('mode mismatch', key, mode))
    result = {'month': f'{start:%Y%m}', 'rows': count, 'days': len(dates),
              'platforms': platforms, 'modeGroups': len(sums),
              'totals': {f'{scope}|{mode}': [str(value) for value in values]
                         for (scope, mode), values in totals.items()}}
    (OUT / f'{start:%Y%m}-validation.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print('validated', result['month'], result['rows'], result['modeGroups'], flush=True)
    return result


def remote(sql):
    payload = json.dumps({'sql': sql}, ensure_ascii=False).encode()
    if len(payload) > 950000:
        raise ValueError(('oversized SQL request', len(payload)))
    for attempt in range(5):
        request = urllib.request.Request(
            'https://pollocloud.com/api/apps/pollo-ai/db/execute',
            data=payload, method='POST',
            headers={'Authorization': 'Bearer ' + TOKEN,
                     'User-Agent': 'pollocloud-cli/0.19.1',
                     'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=90) as response:
                results = json.load(response)['results']
            if all(item['success'] for item in results):
                return results
            error = str(results)[:800]
        except urllib.error.HTTPError as exc:
            error = f'HTTP {exc.code}: ' + exc.read(800).decode(errors='replace')
            if 400 <= exc.code < 500 and exc.code != 429:
                raise RuntimeError(error) from exc
        except (urllib.error.URLError, TimeoutError, http.client.RemoteDisconnected,
                ConnectionError, OSError) as exc:
            error = str(exc)
        if attempt == 4:
            raise RuntimeError(error)
        time.sleep(min(2 ** attempt, 8))


def literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, (int, float, decimal.Decimal)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def prepare():
    columns = {row['name'] for row in remote('PRAGMA table_info(pollo_da_fact_rows)')[0]['results']}
    for name in ('product_type', 'product_type_lv2'):
        if name not in columns:
            remote(f'ALTER TABLE pollo_da_fact_rows ADD COLUMN {name} TEXT')
    remote('CREATE TABLE IF NOT EXISTS pollo_da_payment_fact_stage AS SELECT * FROM pollo_da_fact_rows WHERE 0')
    stage_columns = {row['name'] for row in remote('PRAGMA table_info(pollo_da_payment_fact_stage)')[0]['results']}
    for name in ('product_type', 'product_type_lv2'):
        if name not in stage_columns:
            remote(f'ALTER TABLE pollo_da_payment_fact_stage ADD COLUMN {name} TEXT')
    remote(f'CREATE TABLE IF NOT EXISTS {STAGE} AS SELECT * FROM pollo_da_fact_rows WHERE 0')
    remote(f'CREATE UNIQUE INDEX IF NOT EXISTS {STAGE}_id ON {STAGE}(dataset,source_record_id)')


def staged_row(row, scope, now):
    data = {**row, 'dataset': 'pay_type', 'platform': scope, 'dataset_kind': 'daily',
            'fields_json': '{}', 'updated_at': now}
    data['source_record_id'] = hashlib.md5(json.dumps([data.get(field) for field in IDENTITY], ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()
    return '(' + ','.join(literal(data.get(column)) for column in COLUMNS) + ')'


def verify_remote(table, start, end, summary):
    result = remote(f"SELECT platform,attribution_type,COUNT(*) AS n,"
                    f"SUM(CASE WHEN pay_type<>'汇总' THEN gmv_usd ELSE 0 END) AS gmv,"
                    f"SUM(CASE WHEN pay_type<>'汇总' THEN order_equivalent ELSE 0 END) AS orders "
                    f"FROM {table} WHERE dataset='pay_type' AND period BETWEEN '{start}' AND '{end}' "
                    f"GROUP BY platform,attribution_type")[0]['results']
    observed = {(row['platform'], row['attribution_type']): row for row in result}
    expected = {(key.split('|')[0], key.split('|')[1]): values for key, values in summary['totals'].items()}
    if observed.keys() != expected.keys():
        raise ValueError(('remote modes', table, start, observed.keys(), expected.keys()))
    for key, values in expected.items():
        for metric, value in zip(('gmv', 'orders'), values):
            if abs(decimal.Decimal(str(observed[key][metric])) - decimal.Decimal(value)) > decimal.Decimal('.01'):
                raise ValueError(('remote amount mismatch', table, start, key, metric, observed[key][metric], value))


def stage(start, end, summary):
    current = remote(f"SELECT COUNT(*) AS n FROM {STAGE}")[0]['results'][0]['n']
    if current:
        remote(f'DELETE FROM {STAGE}')
    header = f"INSERT OR IGNORE INTO {STAGE} ({','.join(COLUMNS)}) VALUES "
    now = int(time.time() * 1000)
    values = []
    size = 0
    statements = []
    request_size = 0
    inserted = 0
    pending = deque()
    executor = ThreadPoolExecutor(max_workers=4)

    def send():
        nonlocal statements, request_size
        if not statements:
            return
        pending.append(executor.submit(remote, '\n'.join(statements)))
        if len(pending) >= 8:
            pending.popleft().result()
        statements, request_size = [], 0

    def flush():
        nonlocal values, size, inserted, request_size
        if not values:
            return
        statement = header + ','.join(values) + ';'
        if request_size + len(statement.encode()) > 750000:
            send()
        statements.append(statement)
        request_size += len(statement.encode()) + 1
        inserted += len(values)
        values, size = [], 0
        if inserted % 20000 < 1500:
            print('staging', f'{start:%Y%m}', inserted, flush=True)

    try:
        for row in rows_for(start):
            scopes = ['all'] + (['web'] if row['device_type'] == 'web' else ['app'] if row['device_type'] in ('ios', 'android') else [])
            for scope in scopes:
                value = staged_row(row, scope, now)
                length = len(value.encode())
                if size + length > 80000:
                    flush()
                values.append(value)
                size += length + 1
        flush()
        send()
        while pending:
            pending.popleft().result()
    finally:
        executor.shutdown(wait=True)
    expected = sum(summary['platforms'].values())
    actual = remote(f"SELECT COUNT(*) AS n FROM {STAGE}")[0]['results'][0]['n']
    if actual != expected:
        raise ValueError(('stage count', start, actual, expected))
    verify_remote(STAGE, start, end, summary)
    print('staged', f'{start:%Y%m}', actual, flush=True)


def activate(start, end, summary):
    for day in (start + dt.timedelta(days=n) for n in range((end - start).days + 1)):
        date = str(day)
        remote(f"DELETE FROM pollo_da_fact_rows WHERE dataset='pay_type' AND period='{date}'; "
               f"INSERT INTO pollo_da_fact_rows ({','.join(COLUMNS)}) SELECT {','.join(COLUMNS)} FROM {STAGE} WHERE period='{date}';")
    results = remote(f"SELECT platform,COUNT(*) AS n,COUNT(DISTINCT period) AS days FROM pollo_da_fact_rows "
                     f"WHERE dataset='pay_type' AND period BETWEEN '{start}' AND '{end}' GROUP BY platform")[0]['results']
    observed = {row['platform']: (row['n'], row['days']) for row in results}
    expected = {scope: (count, summary['days']) for scope, count in summary['platforms'].items()}
    if observed != expected:
        raise ValueError(('activation mismatch', start, observed, expected))
    verify_remote('pollo_da_fact_rows', start, end, summary)
    remote(f'DELETE FROM {STAGE}; DELETE FROM dashboard_response_cache')
    print('activated', f'{start:%Y%m}', observed, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['extract', 'backfill'])
    parser.add_argument('--end', type=dt.date.fromisoformat, default=dt.date(2026, 11, 5))
    parser.add_argument('--start-month', default='202601')
    args = parser.parse_args()
    if args.end < FIRST or args.end > dt.date.today():
        raise ValueError('invalid end date')
    if args.action == 'extract':
        client = warehouse.get_odps(argparse.Namespace(access_id=None, secret=None, project=None, endpoint=None))
    else:
        prepare()
    for start, end in months(args.end):
        if f'{start:%Y%m}' < args.start_month:
            continue
        if args.action == 'extract':
            extract(start, end, client)
        else:
            summary = validate(start, end)
            stage(start, end, summary)
            activate(start, end, summary)


if __name__ == '__main__':
    main()

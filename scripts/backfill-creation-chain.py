"""Backfill the two aggregate creation-chain tables; never export user-level rows."""
import argparse
import datetime as dt
import decimal
import importlib.util
import json
import pathlib
import sqlite3
import subprocess
import time
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'archives/creation-chain-backfill'
HELPER = pathlib.Path.home() / '.codex/skills/aliyun-maxcompute-warehouse/scripts/maxcompute_query.py'
spec = importlib.util.spec_from_file_location('warehouse', HELPER)
warehouse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(warehouse)

BASE = ['period', 'week_start', 'week_end', 'platform_type']
SEGMENTS = ['creation_mode', 'user_type', 'pay_gmv_usd_30d']
METRICS = ['creation_task_cnt', 'creation_user_cnt', 'success_task_cnt', 'success_output_cnt',
           'adopted_task_cnt', 'adopted_output_cnt', 'd3_creation_user_cnt',
           'd7_creation_user_cnt', 'd30_creation_user_cnt', 'gmv_usd', 'valid_creation_task_cnt']
TABLES = {'overall': 'pollo_da_creation_overall_daily', 'function': 'pollo_da_creation_function_daily'}


def remote(sql=None, file=None):
    command = ['pollocloud', 'db', 'execute', '--name', 'pollo-ai', '--json']
    command += ['--file', str(file)] if file else ['--command', sql]
    for attempt in range(4):
        result = subprocess.run(command, capture_output=True, text=True)
        try:
            payload = json.loads(result.stdout[result.stdout.index('['):])
            if result.returncode == 0 and all(item['success'] for item in payload):
                return payload
        except (ValueError, KeyError):
            pass
        if attempt == 3:
            raise RuntimeError(result.stderr + result.stdout)
        time.sleep(2 ** attempt)


def literal(value):
    if value is None:
        return 'NULL'
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def months(start, end):
    current = start.replace(day=1)
    while current <= end:
        next_month = (current.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        yield max(start, current), min(end, next_month - dt.timedelta(days=1))
        current = next_month


def extract(start, end):
    OUTPUT.mkdir(parents=True, exist_ok=True)
    client = warehouse.get_odps(argparse.Namespace(access_id=None, secret=None, project=None, endpoint=None))
    for first, last in months(start, end):
        for kind in TABLES:
            output = OUTPUT / f'{kind}-{first:%Y%m}.jsonl'
            if output.exists():
                print('already extracted', output.name, flush=True)
                continue
            template = (ROOT / f'creation-chain-{kind}-sql-review.sql').read_text()
            sql = template.replace("p_date = '${biz_date}'", f"p_date BETWEEN '{first:%Y%m%d}' AND '{last:%Y%m%d}'")
            sql = sql.replace("stat_date = CAST(TO_DATE('${biz_date}', 'yyyymmdd') AS DATE)",
                              "stat_date = CAST(TO_DATE(p_date, 'yyyymmdd') AS DATE)")
            assert '${biz_date}' not in '\n'.join(line for line in sql.splitlines() if not line.lstrip().startswith('--')), 'unsubstituted source partition'
            instance = client.execute_sql(sql, hints={'odps.sql.type.system.odps2': 'true'})
            count = 0
            temp = output.with_suffix('.tmp')
            with temp.open('w') as target, instance.open_reader(tunnel=True) as reader:
                names = [column.name.lower() for column in reader.schema.columns]
                for record in reader:
                    row = dict(zip(names, record.values))
                    for key, value in row.items():
                        if isinstance(value, dt.datetime):
                            row[key] = str(value)
                        elif isinstance(value, dt.date):
                            row[key] = str(value)
                        elif isinstance(value, decimal.Decimal):
                            row[key] = str(value)
                    target.write(json.dumps(row, ensure_ascii=False) + '\n')
                    count += 1
            temp.replace(output)
            print('extracted', output.name, count, 'rows', output.stat().st_size, 'bytes', flush=True)


def source_rows(start, end, kind):
    for first, _ in months(start, end):
        path = OUTPUT / f'{kind}-{first:%Y%m}.jsonl'
        with path.open() as source:
            for line in source:
                yield json.loads(line)


def validate(start, end):
    results = {}
    grouped = defaultdict(lambda: [decimal.Decimal(0) for _ in range(7)])
    for kind in TABLES:
        keys, days, rows = set(), set(), 0
        fields = BASE + (SEGMENTS if kind == 'function' else [])
        for row in source_rows(start, end, kind):
            day = dt.date.fromisoformat(row['period'])
            assert start <= day <= end, ('date', row)
            week = day - dt.timedelta(days=(day.weekday() + 2) % 7)
            assert row['week_start'] == str(week) and row['week_end'] == str(week + dt.timedelta(days=6)), ('week', row)
            key = tuple(row[field] for field in fields)
            assert all(key) and key not in keys, ('grain', key)
            keys.add(key)
            for field in METRICS[:6] + ['gmv_usd']:
                assert row[field] is not None and decimal.Decimal(str(row[field])) >= 0, ('metric', field, key)
            days.add(day)
            rows += 1
            totals = grouped[(kind, row['period'], row['platform_type'])]
            for index, field in enumerate(['creation_task_cnt', 'success_task_cnt', 'success_output_cnt',
                                           'adopted_task_cnt', 'adopted_output_cnt', 'gmv_usd']):
                totals[index] += decimal.Decimal(str(row[field]))
            totals[6] += 1
        expected = {start + dt.timedelta(days=offset) for offset in range((end - start).days + 1)}
        assert days == expected, ('partition coverage', kind, sorted(expected - days))
        results[kind] = {'rows': rows, 'days': len(days), 'first': str(min(days)), 'last': str(max(days))}
    for (kind, day, platform), totals in grouped.items():
        if kind != 'overall':
            continue
        detail = grouped[('function', day, platform)]
        assert totals[:5] == detail[:5] and abs(totals[5] - detail[5]) < decimal.Decimal('0.000001'), ('conservation', day, platform, totals, detail)
    print('validated', results, flush=True)
    return results


def estimate(start, end):
    validate(start, end)
    connection = sqlite3.connect(':memory:')
    connection.executescript((ROOT / 'db/0013_creation_chain.sql').read_text())
    for kind, table in TABLES.items():
        fields = BASE + (SEGMENTS if kind == 'function' else []) + METRICS + ['etl_time', 'updated_at']
        statement = f"INSERT INTO {table} ({','.join(fields)}) VALUES ({','.join('?' for _ in fields)})"
        connection.executemany(statement, (
            tuple(row.get(field) if field != 'updated_at' else 0 for field in fields)
            for row in source_rows(start, end, kind)
        ))
    allocated = connection.execute('PRAGMA page_count').fetchone()[0] * connection.execute('PRAGMA page_size').fetchone()[0]
    payload = sum(path.stat().st_size for path in OUTPUT.glob('*.jsonl'))
    print('local SQLite main tables + indexes', allocated, 'bytes; aggregate JSONL', payload, 'bytes', flush=True)
    connection.close()


def backfill(start, end):
    summary = validate(start, end)
    remote(file=ROOT / 'db/0013_creation_chain.sql')
    now = int(time.time() * 1000)
    for first, last in months(start, end):
        month = f'{first:%Y%m}'
        for kind, table in TABLES.items():
            stage = table.replace('_daily', '_stage')
            rows = [row for row in source_rows(first, last, kind)]
            expected = len(rows)
            existing = remote(f"SELECT COUNT(*) AS n FROM {stage} WHERE period BETWEEN '{first}' AND '{last}'")[0]['results'][0]['n']
            if existing != expected:
                remote(f"DELETE FROM {stage} WHERE period BETWEEN '{first}' AND '{last}'")
                fields = BASE + (SEGMENTS if kind == 'function' else []) + METRICS + ['etl_time', 'updated_at']
                header = f"INSERT INTO {stage} ({','.join(fields)}) VALUES "
                statements, batch, file_bytes, statement_bytes = [], [], 0, 0

                def flush_file():
                    nonlocal statements, file_bytes
                    if statements:
                        path = OUTPUT / 'creation-chain-batch.sql'
                        path.write_text('\n'.join(statements))
                        remote(file=path)
                        statements, file_bytes = [], 0

                def flush_statement():
                    nonlocal batch, statement_bytes, file_bytes
                    if not batch:
                        return
                    statement = header + ','.join(batch) + ';'
                    statements.append(statement)
                    file_bytes += len(statement.encode())
                    batch, statement_bytes = [], 0
                    if file_bytes >= 700_000:
                        flush_file()

                for row in rows:
                    item = '(' + ','.join(literal(row.get(field) if field != 'updated_at' else now) for field in fields) + ')'
                    if statement_bytes + len(item.encode()) > 30_000:
                        flush_statement()
                    batch.append(item)
                    statement_bytes += len(item.encode())
                flush_statement()
                flush_file()
            staged = remote(f"SELECT COUNT(*) AS n FROM {stage} WHERE period BETWEEN '{first}' AND '{last}'")[0]['results'][0]['n']
            assert staged == expected, ('stage', month, kind, staged, expected)
            print('staged', month, kind, staged, flush=True)
        for offset in range((last - first).days + 1):
            date = first + dt.timedelta(days=offset)
            statements = []
            for table in TABLES.values():
                stage = table.replace('_daily', '_stage')
                statements.append(f"DELETE FROM {table} WHERE period = '{date}';")
                statements.append(f"INSERT INTO {table} SELECT * FROM {stage} WHERE period = '{date}';")
            remote('\n'.join(statements))
        for kind, table in TABLES.items():
            actual = remote(f"SELECT COUNT(*) AS n, COUNT(DISTINCT period) AS days, SUM(creation_task_cnt) AS tasks, SUM(success_task_cnt) AS successes, SUM(adopted_task_cnt) AS adopted, SUM(gmv_usd) AS gmv FROM {table} WHERE period BETWEEN '{first}' AND '{last}'")[0]['results'][0]
            month_rows = list(source_rows(first, last, kind))
            assert actual['n'] == len(month_rows) and actual['days'] == (last - first).days + 1, ('remote rows', month, kind, actual)
            for remote_field, local_field in [('tasks', 'creation_task_cnt'), ('successes', 'success_task_cnt'), ('adopted', 'adopted_task_cnt'), ('gmv', 'gmv_usd')]:
                expected = sum(decimal.Decimal(str(row[local_field])) for row in month_rows)
                assert abs(decimal.Decimal(str(actual[remote_field])) - expected) < decimal.Decimal('0.001'), ('remote metrics', month, kind, remote_field, actual[remote_field], expected)
            remote(f"DELETE FROM {table.replace('_daily', '_stage')} WHERE period BETWEEN '{first}' AND '{last}'")
            print('activated', month, kind, actual, flush=True)
    assert sum(item['rows'] for item in summary.values()) == sum(
        remote(f"SELECT COUNT(*) AS n FROM {table} WHERE period BETWEEN '{start}' AND '{end}'")[0]['results'][0]['n']
        for table in TABLES.values())


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['extract', 'validate', 'estimate', 'backfill'])
    parser.add_argument('--start', default='2026-09-27')
    parser.add_argument('--end', default=str(dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date() - dt.timedelta(days=1)))
    args = parser.parse_args()
    start_date, end_date = dt.date.fromisoformat(args.start), dt.date.fromisoformat(args.end)
    assert start_date <= end_date
    if args.action == 'extract':
        extract(start_date, end_date)
    elif args.action == 'validate':
        validate(start_date, end_date)
    elif args.action == 'estimate':
        estimate(start_date, end_date)
    else:
        backfill(start_date, end_date)

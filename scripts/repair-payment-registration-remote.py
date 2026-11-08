"""Reconcile exported registration aggregates against remote payment facts before activation."""

import argparse
import decimal
import importlib.util
import json
import pathlib
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('payment_backfill', ROOT / 'scripts/backfill-pay-type-products.py')
backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backfill)
remote = backfill.remote
literal = backfill.literal
COLUMNS = ['period', 'week_start', 'platform', 'device_type', 'pay_type', 'user_lifecycle', 'reg_country', 'gmv_usd']


def reconcile(rows, start, end, table, omitted_types=()):
    source = defaultdict(decimal.Decimal)
    for row in rows:
        for platform in ['all', row['platform']] if row['platform'] in ('web', 'app') else ['all']:
            source[(row['period'], platform, row['device_type'], row['pay_type'])] += decimal.Decimal(str(row['gmv_usd']))
    facts = remote(f"SELECT period,platform,device_type,pay_type,SUM(gmv_usd) AS gmv "
                   f"FROM pollo_da_fact_rows WHERE dataset='pay_type' AND attribution_type='NONE' "
                   f"AND pay_type<>'汇总' AND period BETWEEN {literal(start)} AND {literal(end)} "
                   "GROUP BY period,platform,device_type,pay_type")[0]['results']
    expected = {(row['period'], row['platform'], row['device_type'], row['pay_type']): decimal.Decimal(str(row['gmv'])) for row in facts if row['pay_type'] not in omitted_types}
    if table != 'source':
        staged = remote(f"SELECT period,platform,device_type,pay_type,SUM(gmv_usd) AS gmv FROM {table} "
                        f"WHERE period BETWEEN {literal(start)} AND {literal(end)} GROUP BY period,platform,device_type,pay_type")[0]['results']
        source = defaultdict(decimal.Decimal)
        for row in staged:
            for platform in ['all', row['platform']] if row['platform'] in ('web', 'app') else ['all']:
                source[(row['period'], platform, row['device_type'], row['pay_type'])] += decimal.Decimal(str(row['gmv']))
    differences = [(key, str(source.get(key, 0) - expected.get(key, 0))) for key in source.keys() | expected.keys()
                   if abs(source.get(key, 0) - expected.get(key, 0)) >= decimal.Decimal('0.005')]
    if differences:
        raise ValueError(f'{table}: {len(differences)} mismatches, examples={differences[:5]}')
    return len(expected)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('aggregate', type=pathlib.Path)
    parser.add_argument('--start')
    parser.add_argument('--end')
    parser.add_argument('--omit-pay-type', action='append', default=[])
    args = parser.parse_args()
    source_rows = json.loads(args.aggregate.read_text())
    start = args.start or min(row['period'] for row in source_rows)
    end = args.end or max(row['period'] for row in source_rows)
    rows = [row for row in source_rows if start <= row['period'] <= end and row['pay_type'] not in args.omit_pay_type]
    if not rows or any(not start <= row['period'] <= end or row['platform'] not in ('web', 'app', 'unknown') for row in rows):
        raise ValueError('Invalid registration aggregate')
    groups = reconcile(rows, start, end, 'source', args.omit_pay_type)
    stage = 'pollo_da_payment_registration_stage'
    remote(f'DELETE FROM {stage} WHERE period BETWEEN {literal(start)} AND {literal(end)}')
    for index in range(0, len(rows), 80):
        batch = rows[index:index + 80]
        values = ','.join('(' + ','.join(literal(row[column]) for column in COLUMNS) + ')' for row in batch)
        remote(f"INSERT INTO {stage} ({','.join(COLUMNS)}) VALUES {values}")
    staged_count = remote(f'SELECT COUNT(*) AS n FROM {stage} WHERE period BETWEEN {literal(start)} AND {literal(end)}')[0]['results'][0]['n']
    if staged_count != len(rows):
        raise ValueError(f'Stage count mismatch: {staged_count} != {len(rows)}')
    reconcile(rows, start, end, stage, args.omit_pay_type)
    remote(f'DELETE FROM pollo_da_payment_registration WHERE period BETWEEN {literal(start)} AND {literal(end)}; '
           f'INSERT INTO pollo_da_payment_registration ({",".join(COLUMNS)}) '
           f'SELECT {",".join(COLUMNS)} FROM {stage} WHERE period BETWEEN {literal(start)} AND {literal(end)};')
    reconcile(rows, start, end, 'pollo_da_payment_registration', args.omit_pay_type)
    remote(f'DELETE FROM {stage} WHERE period BETWEEN {literal(start)} AND {literal(end)}; DELETE FROM dashboard_response_cache;')
    print(json.dumps({'start': start, 'end': end, 'rows': len(rows), 'parentGroups': groups, 'omittedPayTypes': args.omit_pay_type, 'mismatches': 0}, ensure_ascii=False))


if __name__ == '__main__':
    main()

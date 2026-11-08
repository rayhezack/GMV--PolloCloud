"""Restore aggregate creation history with per-grain reconciliation before activation."""
import argparse
import collections
import datetime as dt
import decimal
import importlib.util
import json
import pathlib
import shutil

spec = importlib.util.spec_from_file_location('creation_backfill', pathlib.Path(__file__).with_name('backfill-creation-chain.py'))
backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backfill)


def reconcile(directory, month):
    fields = ['creation_task_cnt', 'valid_creation_task_cnt', 'success_task_cnt', 'success_output_cnt', 'adopted_task_cnt', 'adopted_output_cnt', 'gmv_usd']
    details = collections.defaultdict(lambda: {field: decimal.Decimal(0) for field in fields})
    for line in (directory / f'function-{month}.jsonl').open():
        row = json.loads(line)
        for field in fields:
            details[(row['period'], row['platform_type'])][field] += decimal.Decimal(str(row[field]))
    path = directory / f'overall-{month}.jsonl'
    original = path.with_suffix('.raw.jsonl')
    if not original.exists():
        shutil.copyfile(path, original)
    groups = collections.defaultdict(list)
    for line in original.open():
        row = json.loads(line)
        groups[(row['period'], row['platform_type'])].append(row)
    clean, audit = [], []
    for key, rows in groups.items():
        row = rows[0].copy()
        without_gmv = lambda r: {k: v for k, v in r.items() if k != 'gmv_usd'}
        assert all(without_gmv(r) == without_gmv(row) for r in rows), ('conflicting counts or UV', key)
        # UV is kept from the deduplicated summary, never summed over functions.
        for field in fields[:-1]:
            assert decimal.Decimal(str(row[field])) == details[key][field], ('non-conserving detail', key, field)
        amount = details[key]['gmv_usd']
        if len(rows) > 1 or abs(decimal.Decimal(str(row['gmv_usd'])) - amount) > decimal.Decimal('.000001'):
            audit.append({'period': key[0], 'platform': key[1], 'source_rows': rows, 'function_gmv': str(amount), 'rule': 'Retain identical summary counts and UV once; GMV equals complete function detail after validating additive counts.'})
            row['gmv_usd'] = str(amount)
        clean.append(row)
    path.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in clean))
    (directory / f'reconciliation-{month}.json').write_text(json.dumps(audit, ensure_ascii=False, indent=2))
    print('reconciled', month, len(clean), 'summary rows;', len(audit), 'source anomalies', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', default='2026-01-01')
    parser.add_argument('--end', required=True)
    args = parser.parse_args()
    first, last = dt.date.fromisoformat(args.start), dt.date.fromisoformat(args.end)
    backfill.OUTPUT = backfill.ROOT / 'archives' / f'creation-history-{args.start}-{args.end}'
    for start, end in backfill.months(first, last):
        backfill.extract(start, end)
        reconcile(backfill.OUTPUT, f'{start:%Y%m}')
        backfill.backfill(start, end)

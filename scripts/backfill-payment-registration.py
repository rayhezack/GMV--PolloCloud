"""Read bounded payment aggregates from MaxCompute; reconcile before replacing the local slice.

No user IDs or orders are exported. Remote tables are never changed by this command.
"""
import argparse
import datetime as dt
import decimal
import importlib.util
import json
import pathlib
import sqlite3
import subprocess
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', required=True, type=dt.date.fromisoformat)
    parser.add_argument('--end', required=True, type=dt.date.fromisoformat)
    parser.add_argument('--apply-local', action='store_true')
    parser.add_argument('--database', type=pathlib.Path, default=ROOT/'.local-data/dashboard.sqlite')
    parser.add_argument('--from-file', type=pathlib.Path, help='Reconcile a previously exported aggregate without querying the warehouse again')
    parser.add_argument('--export-only', action='store_true', help='Export source aggregates for remote reconciliation')
    args = parser.parse_args()
    if args.start > args.end:
        raise ValueError('start must precede end')
    if args.from_file:
        rows = json.loads(args.from_file.read_text(encoding='utf8'))
    else:
        sql = subprocess.check_output([
            '/usr/local/bin/node', '--experimental-strip-types', '--input-type=module', '-e',
            "import {buildPaymentRegistrationSql} from './server/modules/maxcompute/payment-registration-sql.ts'; console.log(buildPaymentRegistrationSql(process.argv[1],process.argv[2]));",
            str(args.start), str(args.end),
        ], cwd=ROOT, text=True)
        helper = pathlib.Path.home() / '.codex/skills/aliyun-maxcompute-warehouse/scripts/maxcompute_query.py'
        spec = importlib.util.spec_from_file_location('warehouse', helper)
        warehouse = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(warehouse)
        client = warehouse.get_odps(argparse.Namespace(access_id=None, secret=None, project=None, endpoint=None))
        instance = client.execute_sql(sql, hints={'odps.sql.type.system.odps2': 'true'})
        rows = []
        with instance.open_reader(tunnel=True) as reader:
            names = [c.name.lower() for c in reader.schema.columns]
            for record in reader:
                row = dict(zip(names, record.values))
                for key, value in row.items():
                    if isinstance(value, (dt.date, dt.datetime)): row[key] = str(value)[:10]
                    elif isinstance(value, decimal.Decimal): row[key] = float(value)
                rows.append(row)
    if any(not str(args.start) <= row['period'] <= str(args.end) for row in rows):
        raise ValueError('Aggregate contains dates outside the replacement slice')
    if not rows or rows[0]['source_row_count'] != len(rows):
        raise ValueError('Empty or truncated warehouse result')
    directory = ROOT / '.local-data'
    output = directory / f'payment-registration-{args.start}-{args.end}.json'
    output.write_text(json.dumps(rows, ensure_ascii=False), encoding='utf8')
    if args.export_only:
        print(json.dumps({'rows': len(rows), 'aggregateFile': str(output)}, ensure_ascii=False))
        return
    db = sqlite3.connect(args.database)
    expected = dict(((p, platform, device or '', kind), amount) for p, platform, device, kind, amount in db.execute("""
        SELECT period,platform,COALESCE(device_type,''),pay_type,SUM(gmv_usd)
        FROM pollo_da_fact_rows WHERE dataset='pay_type' AND dataset_kind='daily'
          AND attribution_type='NONE' AND pay_type<>'汇总'
          AND pay_category IN ('ACTIVE_PAYMENT','AUTO_RENEWAL','API') AND period BETWEEN ? AND ?
        GROUP BY period,platform,COALESCE(device_type,''),pay_type
    """, (str(args.start), str(args.end))))
    actual = defaultdict(float)
    for row in rows:
        scopes = ['all'] + ([row['platform']] if row['platform'] in ('web','app') else [])
        for platform, device in [(scope, row['device_type']) for scope in scopes]:
            actual[(row['period'], platform, device, row['pay_type'])] += row['gmv_usd']
    differences = [(key, expected.get(key, 0), actual.get(key, 0)) for key in expected.keys() | actual.keys() if abs(expected.get(key, 0)-actual.get(key, 0)) > .005]
    if differences:
        print(json.dumps({'mismatches': len(differences), 'examples': differences[:10]}, ensure_ascii=False))
        raise ValueError('Payment results do not reconcile; local data was not changed')
    if args.apply_local:
        db.executescript((ROOT/'db/0015_payment_registration.sql').read_text())
        if 'reg_platform' not in [row[1] for row in db.execute('PRAGMA table_info(pollo_da_payment_registration)')]:
            db.executescript((ROOT/'db/0020_payment_registration_platform.sql').read_text())
        if 'country_tier' not in [row[1] for row in db.execute('PRAGMA table_info(pollo_da_payment_registration)')]:
            db.executescript((ROOT/'db/0021_payment_registration_country_tier.sql').read_text())
        if 'reg_country' in [row[1] for row in db.execute('PRAGMA table_info(pollo_da_payment_registration)')]:
            db.execute('ALTER TABLE pollo_da_payment_registration DROP COLUMN reg_country')
        columns = ['period','week_start','platform','device_type','pay_type','user_lifecycle','country_tier','reg_platform','sku','plan_tier','plan_cycle','credit_amount','previous_sku','previous_plan_tier','previous_plan_cycle','previous_credit_amount','gmv_usd']
        with db:
            db.execute('DELETE FROM pollo_da_payment_registration WHERE period BETWEEN ? AND ?', (str(args.start), str(args.end)))
            db.executemany(f"INSERT INTO pollo_da_payment_registration ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})", [[row[c] for c in columns] for row in rows])
    print(json.dumps({'rows': len(rows), 'reconciledParentGroups': len(expected), 'mismatches': 0, 'appliedLocal': args.apply_local, 'aggregateFile': str(output)}, ensure_ascii=False))
    db.close()

if __name__ == '__main__':
    main()

"""Refresh a bounded local payment slice from canonical SKU aggregates.

Warehouse reads export aggregates only. Replacement is transactional and a
SQLite backup is kept; this command never writes to the warehouse or remote D1.
"""
import argparse
import datetime as dt
import decimal
import importlib.util
import json
import math
import pathlib
import sqlite3
import subprocess
import time
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
IDENTITY = ['period','week_start','week_end','platform','device_type','dataset_kind',
            'analysis_level','pay_type','function_name','user_tag','creation_cnt_30d_level_id',
            'creation_cnt_30d','platform_type','plan_tier','plan_cycle','subscription_tier',
            'attribution_type','attribution_name','actual_supplier','actual_provider','pay_category',
            'product_type','product_type_lv2']

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--start', required=True, type=dt.date.fromisoformat)
    parser.add_argument('--end', required=True, type=dt.date.fromisoformat)
    parser.add_argument('--from-file', type=pathlib.Path)
    parser.add_argument('--apply-local', action='store_true')
    parser.add_argument('--database', type=pathlib.Path, default=ROOT/'.local-data/dashboard.sqlite')
    args = parser.parse_args()
    if args.start > args.end: raise ValueError('Invalid date range')
    directory = ROOT / '.local-data'
    if args.from_file:
        rows = json.loads(args.from_file.read_text())
    else:
        sql = subprocess.check_output(['/usr/local/bin/node','--experimental-strip-types','--input-type=module','-e',
            "import {buildMiddleTableSql} from './server/modules/maxcompute/middle-table-sql.ts'; console.log(buildMiddleTableSql('pay_type','all',process.argv[1],process.argv[2]));",
            args.start.strftime('%Y%m%d'),args.end.strftime('%Y%m%d')], cwd=ROOT, text=True)
        helper = pathlib.Path.home()/'.codex/skills/aliyun-maxcompute-warehouse/scripts/maxcompute_query.py'
        spec = importlib.util.spec_from_file_location('warehouse',helper)
        warehouse = importlib.util.module_from_spec(spec); spec.loader.exec_module(warehouse)
        client = warehouse.get_odps(argparse.Namespace(access_id=None,secret=None,project=None,endpoint=None))
        instance = client.execute_sql(sql.replace('SET odps.sql.type.system.odps2=true;', ''),hints={'odps.sql.type.system.odps2':'true'})
        rows = []
        with instance.open_reader(tunnel=True) as reader:
            names = [c.name.lower() for c in reader.schema.columns]
            for record in reader:
                row = dict(zip(names,record.values))
                for key,value in list(row.items()):
                    if isinstance(value,(dt.date,dt.datetime)): row[key] = str(value)[:10]
                    elif isinstance(value,decimal.Decimal): row[key] = float(value)
                rows.append(row)
        (directory/f'payment-results-{args.start}-{args.end}.json').write_text(json.dumps(rows,ensure_ascii=False))
    if not rows or int(rows[0]['source_row_count']) != len(rows): raise ValueError('Empty or truncated export')
    totals = defaultdict(lambda: defaultdict(float))
    records = []
    now = int(time.time()*1000)
    for row in rows:
        if not str(args.start) <= row['period'] <= str(args.end): raise ValueError('Out-of-range row')
        if row['device_type'] not in ('web','ios','android','unknown'): raise ValueError('Invalid device')
        for field in ('gmv_usd','order_equivalent','model_cost_usd'):
            if row[field] is not None and not math.isfinite(float(row[field])): raise ValueError('Invalid amount')
        if row['pay_type'] != '汇总':
            totals[(row['period'],row['device_type'])][row['attribution_type']] += float(row['gmv_usd'] or 0)
        scopes = ['all']
        for scope in scopes:
            item = {**row,'dataset':'pay_type','platform':scope,'dataset_kind':'daily','fields_json':'{}','updated_at':now}
            item['source_record_id'] = '|'.join(str(item.get(key) or '') for key in IDENTITY)
            records.append(item)
    for key,modes in totals.items():
        if set(modes) != {'NONE','CREATION_MODE','MODEL','ACTUAL_MODEL'} or max(modes.values())-min(modes.values()) > .01:
            raise ValueError(f'Attribution modes do not conserve payment results: {key}')
    identities = [row['source_record_id'] for row in records]
    if len(identities) != len(set(identities)): raise ValueError('Duplicate dashboard identities')
    db = sqlite3.connect(args.database)
    db.executescript((ROOT/'db/0022_single_payment_facts.sql').read_text())
    if args.apply_local:
        backup_path = directory/f'dashboard-before-source-migration-{now}.sqlite'
        backup = sqlite3.connect(backup_path); db.backup(backup); backup.close()
        columns = [row[1] for row in db.execute('PRAGMA table_info(pollo_da_fact_rows)')]
        with db:
            db.execute("DELETE FROM pollo_da_fact_rows WHERE dataset='pay_type' AND period BETWEEN ? AND ?",(str(args.start),str(args.end)))
            db.executemany(f"INSERT INTO pollo_da_fact_rows ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
                           [[row.get(column) for column in columns] for row in records])
            db.execute('DELETE FROM dashboard_response_cache')
        print(json.dumps({'backup':str(backup_path)}))
    print(json.dumps({'sourceRows':len(rows),'localRows':len(records),'conservedDateDeviceGroups':len(totals),'appliedLocal':args.apply_local}))
    db.close()

if __name__ == '__main__': main()

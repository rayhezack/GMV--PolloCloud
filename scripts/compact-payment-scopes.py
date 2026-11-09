"""Remove proven payment-scope mirrors after deploying single-copy readers.

Default is read-only. --apply validates each month's projected counts/amounts,
installs write guards, removes only Web/App payment copies, then reconciles.
Canonical all-scope payment devices, registration details and UV datasets stay.
"""
import argparse
import datetime as dt
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('payment_remote', ROOT/'scripts/repair-payment-registration-remote.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
remote = helper.remote

def query(sql):
    return remote(sql)[0]['results']

def snapshot(table, start, end):
    return query(f"SELECT period,platform,device_type,attribution_type,pay_category,pay_type,COUNT(*) n,SUM(gmv_usd) gmv,SUM(model_cost_usd) cost,SUM(order_equivalent) orders FROM {table} WHERE dataset='pay_type' AND period>='{start}' AND period<'{end}' GROUP BY period,platform,device_type,attribution_type,pay_category,pay_type ORDER BY period,platform,device_type,attribution_type,pay_category,pay_type")

def reconcile(expected, actual):
    if len(expected) != len(actual):
        raise ValueError('Logical payment group count changed')
    for before, after in zip(expected, actual):
        for field in before:
            same = math.isclose(float(before[field] or 0),float(after[field] or 0),rel_tol=1e-12,abs_tol=1e-7) if field in ('gmv','cost','orders') else before[field] == after[field]
            if not same:
                raise ValueError(f'Payment conservation failed: {field}, {before}, {after}')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--output',type=Path,default=ROOT/'.local-data'/f'single-payment-cleanup-{dt.datetime.now():%Y%m%d-%H%M%S}')
    args=parser.parse_args()
    active=query("SELECT run_id,status FROM sync_jobs WHERE status IN ('running','queued')")
    if active:
        raise ValueError(f'Wait for active data sync jobs: {active}')
    args.output.mkdir(parents=True,exist_ok=True)
    counts=remote("SELECT dataset,platform,COUNT(*) n FROM pollo_da_fact_rows GROUP BY dataset,platform")
    (args.output/'before-counts.json').write_text(json.dumps(counts,ensure_ascii=False,indent=2))
    months=query("SELECT DISTINCT SUBSTR(period,1,7) month FROM pollo_da_fact_rows WHERE dataset='pay_type' AND platform IN ('web','app') ORDER BY month")
    if args.apply:
        remote((ROOT/'db/0023_payment_single_scope_guard.sql').read_text())
    results=[]
    for row in months:
        month=row['month'];start=month+'-01';date=dt.date.fromisoformat(start);end=(date.replace(day=28)+dt.timedelta(days=4)).replace(day=1).isoformat()
        before=snapshot('pollo_da_fact_rows',start,end)
        reconcile(before,snapshot('pollo_da_fact_rows_read',start,end))
        (args.output/f'{month}-before.json').write_text(json.dumps(before,ensure_ascii=False))
        duplicates=sum(item['n'] for item in before if item['platform'] in ('web','app'))
        if args.apply:
            # Check again before every batch; do not race an existing sync.
            if query("SELECT run_id FROM sync_jobs WHERE status IN ('running','queued')"):
                raise ValueError('A sync started; cleanup stopped between month batches')
            remote(f"DELETE FROM pollo_da_fact_rows WHERE dataset='pay_type' AND platform IN ('web','app') AND period>='{start}' AND period<'{end}'")
            reconcile(before,snapshot('pollo_da_fact_rows_read',start,end))
        result={'month':month,'logicalGroups':len(before),'duplicateRows':duplicates,'applied':args.apply,'mismatches':0}
        results.append(result);print(json.dumps(result),flush=True)
        (args.output/'progress.json').write_text(json.dumps(results,indent=2))
    if args.apply:
        remote('DELETE FROM dashboard_response_cache')
    after=remote("SELECT dataset,platform,COUNT(*) n FROM pollo_da_fact_rows GROUP BY dataset,platform")
    (args.output/'after-counts.json').write_text(json.dumps(after,ensure_ascii=False,indent=2))
    print(json.dumps({'removedRows':sum(row['duplicateRows'] for row in results) if args.apply else 0,'verifiedGroups':sum(row['logicalGroups'] for row in results),'beforeMeta':counts[0].get('meta'),'afterMeta':after[0].get('meta'),'output':str(args.output)},ensure_ascii=False),flush=True)

if __name__=='__main__':
    main()

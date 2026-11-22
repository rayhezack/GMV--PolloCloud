"""Read-only, bounded live capture for the pre-ship accuracy audit (no sync jobs)."""
import argparse
import concurrent.futures
import hashlib
import json
import os
import pathlib
import sqlite3
import subprocess
from datetime import date, timedelta

def remote(sql):
    if not sql.lstrip().upper().startswith('SELECT '):
        raise ValueError('Only SELECT capture queries are allowed')
    for attempt in range(3):
        try:
            result = subprocess.run(
                ['pollocloud', 'db', 'execute', '--name', 'pollo-ai', '--command', sql, '--json'],
                capture_output=True, text=True, timeout=75,
                env={**os.environ, 'POLLOCLOUD_NO_UPDATE_CHECK': '1'},
            )
        except subprocess.TimeoutExpired:
            if attempt == 2:
                raise
            continue
        if result.returncode == 0:
            payload = json.loads(result.stdout[result.stdout.index('['):])
            if all(part.get('success') for part in payload):
                if any(part.get('meta', {}).get('rows_written', 0) for part in payload):
                    raise AssertionError('Read-only capture unexpectedly wrote rows')
                return [row for part in payload for row in part.get('results', [])]
        if attempt == 2:
            raise RuntimeError(result.stderr.strip() or 'Live SELECT failed')


def main():
    p = argparse.ArgumentParser(__doc__)
    p.add_argument('--start', required=True)
    p.add_argument('--end', required=True)
    p.add_argument('--output', required=True)
    args = p.parse_args()
    start, end = date.fromisoformat(args.start), date.fromisoformat(args.end)
    if not 0 <= (end - start).days <= 20:
        raise ValueError('Capture must cover 1–21 days')
    output = pathlib.Path(args.output)
    if output.exists():
        raise ValueError('Refusing to overwrite an existing evidence snapshot')
    output.parent.mkdir(parents=True, exist_ok=True)
    parts = output.with_suffix('.parts')
    parts.mkdir(exist_ok=True)
    def capture(sql):
        cache = parts / (hashlib.sha256(sql.encode()).hexdigest()+'.json')
        if cache.exists():
            payload = json.loads(cache.read_text())
            if isinstance(payload, dict) and len(payload['rows']) == payload['expectedRows']:
                return payload['rows']
            # Older captures did not have a row-count contract. Verify them
            # explicitly before reusing their successful query parts.
            rows = payload
            expected = remote(f'SELECT COUNT(*) n FROM ({sql})')[0]['n']
        else:
            rows = remote(f'SELECT captured.*,COUNT(*) OVER() __audit_count FROM ({sql}) captured')
            expected = rows[0]['__audit_count'] if rows else 0
            for row in rows:
                if row.pop('__audit_count') != expected:
                    raise AssertionError('Inconsistent capture row count')
        if len(rows) != expected:
            raise AssertionError('Capture truncated; refusing incomplete evidence')
        cache.write_text(json.dumps({'rows': rows, 'expectedRows': expected}, ensure_ascii=False))
        return rows
    # Aggregate payment model allocations at the exact grain needed for amount
    # reconciliation. UV is deliberately excluded: it is not additive here.
    dims = 'period,week_start,week_end,platform,device_type,pay_category,pay_type,attribution_type,product_type,product_type_lv2'
    tables = ['pollo_da_chain_funnel', 'pollo_da_chain_breakdown', 'pollo_da_payment_registration',
              'pollo_da_ads_daily', 'pollo_da_creation_overall_daily', 'pollo_da_creation_function_daily']
    tasks = []
    for offset in range((end-start).days+1):
        day = (start+timedelta(days=offset)).isoformat()
        tasks.append(('pollo_da_fact_rows_read', f"SELECT 'pay_type' dataset,'daily' dataset_kind,{dims},CASE WHEN COUNT(gmv_usd)=COUNT(*) THEN SUM(gmv_usd) END gmv_usd,SUM(order_equivalent) order_equivalent FROM pollo_da_fact_rows_read WHERE dataset='pay_type' AND dataset_kind='daily' AND period='{day}' GROUP BY {dims}"))
    tasks.append(('pollo_da_fact_rows_read', f"SELECT * FROM pollo_da_fact_rows_read WHERE dataset='renewal' AND dataset_kind='daily' AND period BETWEEN '{start}' AND '{end}'"))
    for table in tables:
        for offset in range(0, (end-start).days+1, 7):
            left = start+timedelta(days=offset)
            right = min(left+timedelta(days=6), end)
            tasks.append((table, f"SELECT * FROM {table} WHERE period BETWEEN '{left}' AND '{right}'"))
    captured = {table: [] for table in ['pollo_da_fact_rows_read', *tables]}
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        jobs = {pool.submit(capture, sql): (table, sql) for table, sql in tasks}
        for job in concurrent.futures.as_completed(jobs):
            table, sql = jobs[job]
            rows = job.result()
            captured[table].extend(rows)
            print(f'{table}: +{len(rows)} rows', flush=True)
    db = sqlite3.connect(output)
    manifest = {'start': str(start), 'end': str(end), 'source': 'live D1 SELECT',
                'paymentGrain': dims, 'paymentUV': 'excluded; non-additive',
                'rowCountContract': 'per-query COUNT verified', 'tables': {}}
    for table, rows in captured.items():
        if not rows:
            raise AssertionError(f'{table}: empty data is not a pass')
        columns = sorted({key for row in rows for key in row})
        db.execute(f'CREATE TABLE {table} ({",".join(chr(34)+key+chr(34) for key in columns)})')
        db.executemany(f'INSERT INTO {table} VALUES ({",".join("?" for _ in columns)})',
                       [[row.get(key) for key in columns] for row in rows])
        days = sorted({row['period'] for row in rows})
        manifest['tables'][table] = {'rows': len(rows), 'days': days}
    db.commit()
    db.close()
    manifest['sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix('.manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

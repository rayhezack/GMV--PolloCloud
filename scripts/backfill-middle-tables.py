"""Local ADS extraction and validated, transactional Pollo Cloud backfill.
Only aggregated facts are saved. Credentials are read by the warehouse helper.
"""
import argparse, datetime as dt, decimal, hashlib, importlib.util, json, pathlib, subprocess, time
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'archives/middle-table-20261104'
HELPER = pathlib.Path.home() / '.codex/skills/aliyun-maxcompute-warehouse/scripts/maxcompute_query.py'
spec = importlib.util.spec_from_file_location('warehouse', HELPER)
warehouse = importlib.util.module_from_spec(spec)
spec.loader.exec_module(warehouse)


def remote(sql=None, file=None):
    cmd = ['pollocloud', 'db', 'execute', '--name', 'pollo-ai', '--json']
    cmd += ['--file', str(file)] if file else ['--command', sql]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode: raise RuntimeError(result.stderr + result.stdout)
    data = json.loads(result.stdout[result.stdout.index('['):])
    assert all(item['success'] for item in data), data
    return data


def literal(v):
    if v is None: return 'NULL'
    if isinstance(v, (float, int)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def extract():
    client = warehouse.get_odps(argparse.Namespace(access_id=None, secret=None, project=None, endpoint=None))
    end = dt.date(2026, 11, 3)
    for dataset, begin in [('chain', dt.date(2026,1,1)), ('pay_type', dt.date(2026,1,1)), ('chain_all', dt.date(2026,1,1))]:
        if ONLY and dataset != ONLY: continue
        current = begin
        while current <= end:
            next_month = (current.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
            last = min(end, next_month - dt.timedelta(days=1))
            output = OUT / f'{dataset}-{current:%Y%m}.jsonl'
            if output.exists():
                current = next_month
                continue
            template = ROOT / 'scripts/pay-type-history.template.sql' if dataset == 'pay_type' else OUT / (dataset.replace('_all', '') + '.template.sql')
            sql = template.read_text().replace('STARTKEY',f'{current:%Y%m%d}').replace('ENDKEY',f'{last:%Y%m%d}')
            if dataset == 'chain_all': sql = sql.replace('LOWER(platform_type)', "'all'")
            sql = '\n'.join(line for line in sql.splitlines() if not line.strip().upper().startswith('SET '))
            warehouse.normalize_sql(sql, None)
            instance = client.execute_sql(sql, hints={'odps.sql.type.system.odps2':'true'})
            print(dataset, current, last, 'instance', instance.id, flush=True)
            rows = []
            # Tunnel reads the complete aggregate, without CLI display-row limits.
            with instance.open_reader(tunnel=True) as reader:
                for record in reader:
                    row = dict(zip([c.name for c in reader.schema.columns], record.values))
                    for k,v in row.items():
                        if isinstance(v, (dt.datetime,dt.date)): row[k] = str(v)[:10]
                        elif isinstance(v, decimal.Decimal): row[k] = float(v)
                    device = row['device_type']
                    if device not in ('all','web','ios','android'): continue
                    row.update(platform=('all' if device=='all' else 'web' if device=='web' else 'app'), dataset_kind='daily')
                    rows.append(row)
            temp = output.with_suffix('.tmp')
            temp.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
            temp.replace(output)
            print('saved',output.name,len(rows),flush=True)
            current = next_month
    if not ONLY: validate()


def read_rows():
    for source in ('chain','chain_all','pay_type'):
        dataset=source.replace('_all','')
        for file in sorted(OUT.glob(f'{source}-*.jsonl')):
            for line in file.open():
                row=json.loads(line)
                yield dataset, row
                if dataset=='pay_type': yield dataset, {**row, 'platform':'all'}


def validate():
    counts=defaultdict(int); days=defaultdict(set); totals=defaultdict(lambda:[0.,0.]); keys=set()
    for dataset,row in read_rows():
        key=(dataset,identity(row))
        assert key not in keys, ('duplicate grain',key)
        keys.add(key); counts[dataset]+=1; days[(dataset,row['platform'])].add(row['period'])
        if dataset=='pay_type' and row['platform']!='all' and row['pay_category']!='汇总' and row['pay_type']!='汇总':
            k=(row['period'],row['device_type'],row['pay_category'],row['pay_type'],row['attribution_type'])
            totals[k][0]+=row['gmv_usd'] or 0
            totals[k][1]+=row['order_equivalent'] or 0
    for (dataset,platform),dates in days.items():
        assert len(dates)==307, ('coverage',dataset,platform,len(dates))
    failures=[]
    bases={k[:4] for k in totals}
    for base in bases:
        ref=totals[base+('NONE',)]
        for mode in ('CREATION_MODE','MODEL','ACTUAL_MODEL'):
            actual=totals[base+(mode,)]
            if abs(actual[0]-ref[0])>0.00001 or abs(actual[1]-ref[1])>0.00001:
                failures.append([*base,mode,ref,actual])
    summary={'counts':dict(counts),'coverage':{str(k):[min(v),max(v),len(v)] for k,v in days.items()},'attribution_checks':len(bases)*3,'failures':failures}
    (OUT/'validation.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2))
    print(json.dumps(summary,ensure_ascii=False),flush=True)
    assert not failures, 'Attribution conservation failed: inspect validation.json'


IDENTITY=['period','week_start','week_end','platform','device_type','dataset_kind','analysis_level','pay_type','function_name','user_tag','creation_cnt_30d_level_id','creation_cnt_30d','platform_type','plan_tier','plan_cycle','subscription_tier','attribution_type','attribution_name','actual_supplier','actual_provider','pay_category']
def identity(row): return '|'.join('' if row.get(k) is None else str(row[k]) for k in IDENTITY)


def stage():
    validate()
    columns=[r['name'] for r in remote('PRAGMA table_info(pollo_da_fact_rows)')[0]['results']]
    remote('CREATE TABLE IF NOT EXISTS pollo_da_ads_stage_20261104 AS SELECT * FROM pollo_da_fact_rows WHERE 0; DELETE FROM pollo_da_ads_stage_20261104 WHERE dataset IN (\'chain\',\'pay_type\');')
    batch=[]; size=0; count=0
    def write_batch(values):
        header='INSERT INTO pollo_da_ads_stage_20261104 ('+','.join(columns)+') VALUES '
        statements=[]; part=[]; length=0
        for value in values:
            part.append(value);length+=len(value.encode())
            if length>40000:
                statements.append(header+','.join(part)+';');part=[];length=0
        if part: statements.append(header+','.join(part)+';')
        path=OUT/'stage-batch.sql';path.write_text('\n'.join(statements));remote(file=path)
    for dataset,row in read_rows():
        data={**row,'dataset':dataset,'source_record_id':identity(row),'fields_json':'{}','updated_at':int(time.time()*1000)}
        values=','.join(literal(data.get(k)) for k in columns)
        stmt='('+values+')'
        batch.append(stmt); size+=len(stmt.encode()); count+=1
        if size>750000:
            write_batch(batch)
            print('staged',count,flush=True);batch=[];size=0
    if batch:
        write_batch(batch)
    print(remote('SELECT dataset,COUNT(*) n,MIN(period) first_date,MAX(period) last_date FROM pollo_da_ads_stage_20261104 GROUP BY dataset'),flush=True)


HISTORY_START = dt.date(2026, 1, 1)
HISTORY_END = dt.date(2026, 9, 30)
HISTORY_STAGE = 'pollo_da_pay_type_history_stage_20261104'


def history_files():
    return [OUT / f'pay_type-2026{month:02d}.jsonl' for month in range(1, 10)]


def validate_history():
    summary = {'months': {}, 'rows': 0, 'checks': 0}
    for file in history_files():
        assert file.exists(), ('missing extraction', file)
        month = dt.datetime.strptime(file.stem.replace('pay_type-', '') + '01', '%Y%m%d').date()
        next_month = (month.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        expected_days = (next_month - month).days
        keys = set(); days = defaultdict(set); totals = defaultdict(lambda: [0., 0.]); none_gmv = defaultdict(float); count = 0
        for line in file.open():
            row = json.loads(line)
            assert row['metric_version'] == 'ads_v1' and row['device_type'] in ('web', 'ios', 'android')
            date = dt.date.fromisoformat(row['period'])
            assert month <= date < next_month, ('period', row['period'], file)
            week = date - dt.timedelta(days=(date.weekday() + 2) % 7)
            assert row['week_start'] == str(week) and row['week_end'] == str(week + dt.timedelta(days=6))
            key = identity(row)
            assert key not in keys, ('duplicate grain', file, key)
            keys.add(key); days[row['platform']].add(date); count += 1
            if row['pay_category'] != '汇总' and row['pay_type'] != '汇总':
                group = (row['period'], row['device_type'], row['pay_category'], row['pay_type'], row['attribution_type'])
                totals[group][0] += row['gmv_usd'] or 0
                totals[group][1] += row['order_equivalent'] or 0
                if row['attribution_type'] == 'NONE' and row['pay_category'] in ('ACTIVE_PAYMENT', 'AUTO_RENEWAL'):
                    none_gmv[row['platform']] += row['gmv_usd'] or 0
        assert count and days['web'] == days['app'] == {month + dt.timedelta(days=n) for n in range(expected_days)}, ('coverage', file)
        for group in {key[:4] for key in totals}:
            reference = totals[group + ('NONE',)]
            for mode in ('CREATION_MODE', 'MODEL', 'ACTUAL_MODEL'):
                actual = totals[group + (mode,)]
                assert all(abs(a - b) <= 0.00001 for a, b in zip(actual, reference)), ('conservation', file, group, mode, reference, actual)
                summary['checks'] += 1
        summary['months'][file.stem] = {'source_rows': count, 'days': expected_days, 'none_gmv_usd': dict(none_gmv)}
        summary['rows'] += count * 2
        print('validated', file.name, count, 'source rows', flush=True)
    (OUT / 'pay-type-history-validation.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print('history validation', summary['rows'], 'target rows', summary['checks'], 'conservation checks', flush=True)
    return summary


def stage_history():
    summary = validate_history()
    columns = [item['name'] for item in remote('PRAGMA table_info(pollo_da_fact_rows)')[0]['results']]
    remote(f'CREATE TABLE IF NOT EXISTS {HISTORY_STAGE} AS SELECT * FROM pollo_da_fact_rows WHERE 0')
    header = f'INSERT INTO {HISTORY_STAGE} (' + ','.join(columns) + ') VALUES '
    statements = []; statement_rows = []; statement_bytes = 0; file_bytes = 0; staged = 0

    def flush_file():
        nonlocal statements, file_bytes
        if statements:
            path = OUT / 'pay-type-history-batch.sql'
            path.write_text('\n'.join(statements))
            remote(file=path)
            statements, file_bytes = [], 0

    def flush_statement():
        nonlocal statement_rows, statement_bytes, file_bytes
        if not statement_rows:
            return
        statement = header + ','.join(statement_rows) + ';'
        statements.append(statement); file_bytes += len(statement.encode())
        statement_rows, statement_bytes = [], 0
        if file_bytes > 700000:
            flush_file()

    for file in history_files():
        month = file.stem.replace('pay_type-', '')
        expected = summary['months'][file.stem]['source_rows'] * 2
        existing = remote(f"SELECT COUNT(*) rows FROM {HISTORY_STAGE} WHERE dataset='pay_type' AND SUBSTR(period,1,7)='{month[:4]}-{month[4:]}'")[0]['results'][0]['rows']
        if existing == expected:
            staged += existing
            print('staging already complete', file.name, existing, flush=True)
            continue
        if existing:
            remote(f"DELETE FROM {HISTORY_STAGE} WHERE dataset='pay_type' AND SUBSTR(period,1,7)='{month[:4]}-{month[4:]}'")
        for line in file.open():
            row = json.loads(line)
            for platform in (row['platform'], 'all'):
                data = {**row, 'platform': platform, 'dataset': 'pay_type', 'source_record_id': identity({**row, 'platform': platform}), 'fields_json': '{}', 'updated_at': int(time.time() * 1000)}
                values = '(' + ','.join(literal(data.get(column)) for column in columns) + ')'
                if statement_bytes + len(values.encode()) > 30000:
                    flush_statement()
                statement_rows.append(values); statement_bytes += len(values.encode()); staged += 1
        flush_statement(); flush_file()
        month_rows = remote(f"SELECT COUNT(*) rows FROM {HISTORY_STAGE} WHERE dataset='pay_type' AND SUBSTR(period,1,7)='{month[:4]}-{month[4:]}'")[0]['results'][0]['rows']
        assert month_rows == expected, ('staging month', file.name, month_rows, expected)
        print('staged through', file.name, staged, flush=True)
    assert staged == summary['rows']
    result = remote(f"SELECT COUNT(*) rows,COUNT(DISTINCT source_record_id) ids,COUNT(DISTINCT period) days FROM {HISTORY_STAGE} WHERE dataset='pay_type'")[0]['results'][0]
    assert result == {'rows': staged, 'ids': staged, 'days': 273}, result
    print('remote staging verified', result, flush=True)


def activate_history():
    summary = validate_history()
    staged = remote(f"SELECT COUNT(*) rows,COUNT(DISTINCT source_record_id) ids,COUNT(DISTINCT period) days FROM {HISTORY_STAGE} WHERE dataset='pay_type'")[0]['results'][0]
    assert staged == {'rows': summary['rows'], 'ids': summary['rows'], 'days': 273}, staged
    for offset in range(273):
        date = HISTORY_START + dt.timedelta(days=offset)
        sql = f"DELETE FROM pollo_da_fact_rows WHERE dataset='pay_type' AND period='{date}'; INSERT INTO pollo_da_fact_rows SELECT * FROM {HISTORY_STAGE} WHERE dataset='pay_type' AND period='{date}';"
        remote(sql)
        if date.day == (date.replace(day=28) + dt.timedelta(days=4) - dt.timedelta(days=1)).day:
            print('activated through', date, flush=True)
    result = remote("SELECT metric_version,COUNT(*) rows,COUNT(DISTINCT period) days FROM pollo_da_fact_rows WHERE dataset='pay_type' AND period BETWEEN '2026-01-01' AND '2026-09-30' GROUP BY metric_version")[0]['results']
    assert result == [{'metric_version': 'ads_v1', 'rows': summary['rows'], 'days': 273}], result
    remote(f'DELETE FROM {HISTORY_STAGE} WHERE dataset=\'pay_type\'; DELETE FROM dashboard_response_cache;')
    print('history activation verified', result, flush=True)


def compact_pay_type_row(row):
    detail = row['pay_category'] in ('ACTIVE_PAYMENT', 'AUTO_RENEWAL', 'API') and row['pay_type'] != '汇总'
    cost = (row['attribution_type'] in ('MODEL', 'ACTUAL_MODEL')
            and row['pay_category'] == row['pay_type'] == '汇总'
            and row.get('model_cost_usd'))
    return detail or cost


def backfill_compact_history():
    validate_history()
    columns = [item['name'] for item in remote('PRAGMA table_info(pollo_da_fact_rows)')[0]['results']]
    remote(f'CREATE TABLE IF NOT EXISTS {HISTORY_STAGE} AS SELECT * FROM pollo_da_fact_rows WHERE 0')
    header = f'INSERT INTO {HISTORY_STAGE} (' + ','.join(columns) + ') VALUES '
    for file in history_files():
        month = file.stem[-6:]
        rows = [json.loads(line) for line in file.open()]
        selected = [row for row in rows if compact_pay_type_row(row)]
        expected = len(selected) * 2
        stage_info = remote(f'SELECT COUNT(*) n,MIN(period) first_period,MAX(period) last_period FROM {HISTORY_STAGE}')[0]
        existing = stage_info['results'][0]['n']
        assert stage_info['meta']['size_after'] < 2_500_000_000, 'Remote database is approaching its 3 GB quota'
        if existing:
            assert stage_info['results'][0]['first_period'][:7] == f'{month[:4]}-{month[4:]}'
            assert stage_info['results'][0]['last_period'][:7] == f'{month[:4]}-{month[4:]}'
        if existing != expected:
            if existing:
                remote(f'DELETE FROM {HISTORY_STAGE}')
            statements = []; statement_rows = []; statement_bytes = 0; file_bytes = 0

            def flush_statement():
                nonlocal statements, statement_rows, statement_bytes, file_bytes
                if not statement_rows:
                    return
                statement = header + ','.join(statement_rows) + ';'
                statements.append(statement)
                file_bytes += len(statement.encode())
                statement_rows, statement_bytes = [], 0
                if file_bytes > 700000:
                    batch = OUT / 'pay-type-compact-batch.sql'
                    batch.write_text('\n'.join(statements))
                    remote(file=batch)
                    statements, file_bytes = [], 0

            now = int(time.time() * 1000)
            for row in selected:
                for platform in (row['platform'], 'all'):
                    data = {**row, 'platform': platform, 'dataset': 'pay_type',
                            'source_record_id': hashlib.md5(identity({**row, 'platform': platform}).encode()).hexdigest(),
                            'fields_json': '{}', 'updated_at': now}
                    value = '(' + ','.join(literal(data.get(column)) for column in columns) + ')'
                    if statement_bytes + len(value.encode()) > 30000:
                        flush_statement()
                    statement_rows.append(value)
                    statement_bytes += len(value.encode())
            flush_statement()
            if statements:
                batch = OUT / 'pay-type-compact-batch.sql'
                batch.write_text('\n'.join(statements))
                remote(file=batch)
            staged = remote(f'SELECT COUNT(*) n,COUNT(DISTINCT source_record_id) ids FROM {HISTORY_STAGE}')[0]['results'][0]
            assert staged == {'n': expected, 'ids': expected}, (file, staged, expected)
            print('staged', month, expected, flush=True)
        for date in sorted({row['period'] for row in selected}):
            remote(f"DELETE FROM pollo_da_fact_rows WHERE dataset='pay_type' AND period='{date}'; INSERT INTO pollo_da_fact_rows SELECT * FROM {HISTORY_STAGE} WHERE period='{date}';")
        result = remote(f"SELECT platform,COUNT(*) n,COUNT(DISTINCT period) days FROM pollo_da_fact_rows WHERE dataset='pay_type' AND period BETWEEN '{month[:4]}-{month[4:]}-01' AND '{month[:4]}-{month[4:]}-31' GROUP BY platform")[0]['results']
        expected_days = len({row['period'] for row in selected})
        platform_counts = {platform: sum(row['platform'] == platform for row in selected) for platform in ('web', 'app')}
        platform_counts['all'] = len(selected)
        assert len(result) == 3 and all(item['n'] == platform_counts[item['platform']] and item['days'] == expected_days for item in result), (month, result)
        remote(f'DELETE FROM {HISTORY_STAGE}; DELETE FROM dashboard_response_cache;')
        print('activated', month, result, flush=True)


if __name__=='__main__':
    args=argparse.ArgumentParser();args.add_argument('action',choices=['extract','validate','stage','validate_history','stage_history','activate_history','backfill_compact_history']);args.add_argument('--only',choices=['chain','pay_type','chain_all']);a=args.parse_args();ONLY=a.only
    globals()[a.action]()

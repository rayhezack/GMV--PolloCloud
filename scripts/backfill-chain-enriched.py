"""Backfill the enriched payment-chain facts for a bounded date range."""
import argparse, datetime as dt, decimal, importlib.util, json, pathlib, subprocess, time
from collections import defaultdict

ROOT = pathlib.Path(__file__).resolve().parents[1]
HELPER = pathlib.Path.home() / '.codex/skills/aliyun-maxcompute-warehouse/scripts/maxcompute_query.py'
spec = importlib.util.spec_from_file_location('warehouse', HELPER)
warehouse = importlib.util.module_from_spec(spec); spec.loader.exec_module(warehouse)

def remote(sql):
    last = None
    for attempt in range(5):
        result = subprocess.run(['pollocloud','db','execute','--name','pollo-ai','--json','--command',sql], capture_output=True, text=True)
        if result.returncode == 0:
            data = json.loads(result.stdout[result.stdout.index('['):])
            if all(item['success'] for item in data): return data
            last = result.stdout
        else:
            last = result.stderr + result.stdout
        time.sleep(2 ** attempt)
    raise RuntimeError(last or 'remote execution failed')

def lit(value):
    if value is None: return 'NULL'
    if isinstance(value, (int,float)): return str(value)
    return "'" + str(value).replace("'", "''") + "'"

def query_aggregate(start, end, breakdown=False):
    base = f"""
WITH user_day AS (
  SELECT stat_date,week_start,week_end,LOWER(platform_group) AS platform,LOWER(platform_type) AS device_type,
    country_tier,creation_cnt_30d_label,register_date,user_id,
    MAX(is_paywall_expose) AS is_paywall_expose,MAX(is_paywall_submit) AS is_paywall_submit,MAX(is_pay) AS is_pay,
    CASE WHEN COUNT(DISTINCT CASE WHEN is_paywall_expose=1 THEN paywall_expose_type END)>1 THEN '__MULTI__' ELSE MAX(CASE WHEN is_paywall_expose=1 THEN paywall_expose_type END) END AS paywall_expose_type,
    CASE WHEN COUNT(DISTINCT CASE WHEN is_paywall_expose=1 THEN paywall_expose_reason END)>1 THEN '__MULTI__' ELSE MAX(CASE WHEN is_paywall_expose=1 THEN paywall_expose_reason END) END AS paywall_expose_reason,
    CASE WHEN COUNT(DISTINCT CASE WHEN is_paywall_submit=1 THEN submit_channel END)>1 THEN '__MULTI__' ELSE MAX(CASE WHEN is_paywall_submit=1 THEN submit_channel END) END AS submit_channel,
    CASE WHEN COUNT(DISTINCT CASE WHEN is_pay=1 THEN payment_channel END)>1 THEN '__MULTI__' ELSE MAX(CASE WHEN is_pay=1 THEN payment_channel END) END AS payment_channel,
    SUM(CASE WHEN is_pay=1 THEN gmv_usd ELSE 0 END) AS gmv_usd,
    SUM(pay_fail_order_cnt) AS pay_fail_order_cnt,SUM(pay_fail_amount_usd) AS pay_fail_amount_usd
  FROM mc_prd.ads_pollo_transaction_paywall_user_daily_dip
  WHERE p_date BETWEEN '{start:%Y%m%d}' AND '{end:%Y%m%d}'
    AND stat_date BETWEEN CAST(TO_DATE('{start:%Y%m%d}','yyyymmdd') AS DATE) AND CAST(TO_DATE('{end:%Y%m%d}','yyyymmdd') AS DATE)
    AND is_active=1 AND platform_group IN ('WEB','APP')
  GROUP BY stat_date,week_start,week_end,platform_group,platform_type,country_tier,creation_cnt_30d_label,register_date,user_id
), enriched AS (
  SELECT *,CASE WHEN register_date BETWEEN week_start AND week_end THEN 'NEW' WHEN register_date<week_start THEN 'OLD' ELSE NULL END AS user_lifecycle
  FROM user_day
)
"""
    if not breakdown:
        sql = base + """
SELECT stat_date AS period,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,
  COUNT(*) AS active_uv,SUM(is_paywall_expose) AS paywall_expose_uv,SUM(is_paywall_submit) AS paywall_submit_uv,SUM(is_pay) AS pay_uv,
  SUM(gmv_usd) AS gmv_usd,SUM(pay_fail_order_cnt) AS pay_fail_order_cnt,SUM(pay_fail_amount_usd) AS pay_fail_amount_usd
FROM enriched
GROUP BY stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label
"""
    else:
        sql = base + """
SELECT stat_date AS period,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,
  'EXPOSE_TYPE' AS breakdown_type,paywall_expose_type AS breakdown_value,
  SUM(is_paywall_expose) AS expose_uv,SUM(is_paywall_submit) AS submit_uv,SUM(is_pay) AS pay_uv,SUM(gmv_usd) AS gmv_usd
FROM enriched WHERE is_paywall_expose=1 OR is_pay=1
GROUP BY stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,paywall_expose_type
UNION ALL
SELECT stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,
  'EXPOSE_REASON',paywall_expose_reason,SUM(is_paywall_expose),SUM(is_paywall_submit),SUM(is_pay),SUM(gmv_usd)
FROM enriched WHERE is_paywall_expose=1 OR is_pay=1
GROUP BY stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,paywall_expose_reason
UNION ALL
SELECT stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,
  'SUBMIT_CHANNEL',submit_channel,SUM(is_paywall_expose),SUM(is_paywall_submit),SUM(is_pay),SUM(gmv_usd)
FROM enriched WHERE is_paywall_submit=1 OR is_pay=1
GROUP BY stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,submit_channel
UNION ALL
SELECT stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,
  'PAYMENT_CHANNEL',payment_channel,SUM(is_paywall_expose),SUM(is_paywall_submit),SUM(is_pay),SUM(gmv_usd)
FROM enriched WHERE is_pay=1
GROUP BY stat_date,week_start,week_end,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,payment_channel
"""
    client = warehouse.get_odps(argparse.Namespace(access_id=None, secret=None, project=None, endpoint=None))
    instance = client.execute_sql(sql, hints={'odps.sql.type.system.odps2':'true'})
    rows=[]
    with instance.open_reader(tunnel=True) as reader:
        names=[c.name.lower() for c in reader.schema.columns]
        for record in reader:
            row=dict(zip(names,record.values))
            for key,value in list(row.items()):
                if isinstance(value,(dt.date,dt.datetime)): row[key]=str(value)[:10]
                elif isinstance(value,decimal.Decimal): row[key]=float(value)
            rows.append(row)
    return rows

def canonical(rows):
    grouped={}
    for row in rows:
        key=(row['period'],row['platform'],row['user_id'])
        item=grouped.setdefault(key, {**row,'is_paywall_expose':0,'is_paywall_submit':0,'is_pay':0,'gmv_usd':0.,'pay_fail_order_cnt':0,'pay_fail_amount_usd':0.,'_types':set(),'_reasons':set(),'_submits':set(),'_payments':set()})
        item['is_paywall_expose']=max(item['is_paywall_expose'],int(row['is_paywall_expose'] or 0)); item['is_paywall_submit']=max(item['is_paywall_submit'],int(row['is_paywall_submit'] or 0)); item['is_pay']=max(item['is_pay'],int(row['is_pay'] or 0))
        item['gmv_usd'] += float(row['gmv_usd'] or 0) if row['is_pay'] else 0; item['pay_fail_order_cnt'] += int(row['pay_fail_order_cnt'] or 0); item['pay_fail_amount_usd'] += float(row['pay_fail_amount_usd'] or 0)
        if row['is_paywall_expose'] and row['paywall_expose_type'] is not None: item['_types'].add(row['paywall_expose_type'])
        if row['is_paywall_expose'] and row['paywall_expose_reason'] is not None: item['_reasons'].add(row['paywall_expose_reason'])
        if row['is_paywall_submit'] and row['submit_channel'] is not None: item['_submits'].add(row['submit_channel'])
        if row['is_pay'] and row['payment_channel'] is not None: item['_payments'].add(row['payment_channel'])
    out=[]
    for item in grouped.values():
        for field in ('_types','_reasons','_submits','_payments'):
            values=item[field]; item[field[1:]]=('__MULTI__' if len(values)>1 else next(iter(values),None))
        item['user_lifecycle']='NEW' if item['register_date'] and item['week_start']<=item['register_date']<=item['week_end'] else ('OLD' if item['register_date'] and item['register_date']<item['week_start'] else None)
        out.append(item)
    return out

def rows_for_main(users):
    groups=defaultdict(list)
    for row in users: groups[tuple(row[k] for k in ('period','week_start','week_end','platform','device_type','country_tier','user_lifecycle','creation_cnt_30d_label'))].append(row)
    result=[]
    for key,rows in groups.items():
        result.append(dict(zip(('period','week_start','week_end','platform','device_type','country_tier','user_lifecycle','creation_cnt_30d_label'),key), **{
            'active_uv':len(rows),'paywall_expose_uv':sum(r['is_paywall_expose'] for r in rows),'paywall_submit_uv':sum(r['is_paywall_submit'] for r in rows),'pay_uv':sum(r['is_pay'] for r in rows),'gmv_usd':sum(r['gmv_usd'] for r in rows),'pay_fail_order_cnt':sum(r['pay_fail_order_cnt'] for r in rows),'pay_fail_amount_usd':sum(r['pay_fail_amount_usd'] for r in rows)}))
    return result

def rows_for_breakdown(users):
    result=[]
    for kind,field,flag in [('EXPOSE_TYPE','types','is_paywall_expose'),('EXPOSE_REASON','reasons','is_paywall_expose'),('SUBMIT_CHANNEL','submits',None),('PAYMENT_CHANNEL','payments','is_pay')]:
        selected=[r for r in users if ((r['is_paywall_expose'] or r['is_pay']) if kind.startswith('EXPOSE') else (r['is_paywall_submit'] or r['is_pay']) if kind=='SUBMIT_CHANNEL' else r['is_pay'])]
        groups=defaultdict(list)
        for r in selected: groups[tuple(r[k] for k in ('period','week_start','week_end','platform','device_type','country_tier','user_lifecycle','creation_cnt_30d_label'))+(r[field],)].append(r)
        for key,rows in groups.items():
            dims=key[:-1]; value=key[-1]
            result.append(dict(zip(('period','week_start','week_end','platform','device_type','country_tier','user_lifecycle','creation_cnt_30d_label'),dims), breakdown_type=kind, breakdown_value=value, expose_uv=sum(r['is_paywall_expose'] for r in rows), submit_uv=sum(r['is_paywall_submit'] for r in rows), pay_uv=sum(r['is_pay'] for r in rows), gmv_usd=sum(r['gmv_usd'] for r in rows)))
    return result

def insert(table, rows, columns):
    if not rows: return
    for offset in range(0,len(rows),200):
        values=[]
        for row in rows[offset:offset+200]: values.append('('+','.join(lit(row.get(c)) for c in columns)+')')
        remote(f"INSERT INTO {table} ({','.join(columns)}) VALUES {','.join(values)}")

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--start',default='2026-01-01'); parser.add_argument('--end',default='2026-11-03'); parser.add_argument('--keep',action='store_true'); args=parser.parse_args(); start=dt.date.fromisoformat(args.start); end=dt.date.fromisoformat(args.end)
    main_rows=query_aggregate(start,end,False); drill_rows=query_aggregate(start,end,True)
    main_cols=['period','week_start','week_end','platform','device_type','country_tier','user_lifecycle','creation_cnt_30d_label','active_uv','paywall_expose_uv','paywall_submit_uv','pay_uv','gmv_usd','pay_fail_order_cnt','pay_fail_amount_usd']
    drill_cols=['period','week_start','week_end','platform','device_type','country_tier','user_lifecycle','creation_cnt_30d_label','breakdown_type','breakdown_value','expose_uv','submit_uv','pay_uv','gmv_usd']
    create_sql="CREATE TABLE IF NOT EXISTS pollo_da_chain_funnel (period TEXT,week_start TEXT,week_end TEXT,platform TEXT,device_type TEXT,country_tier TEXT,user_lifecycle TEXT,creation_cnt_30d_label TEXT,active_uv REAL,paywall_expose_uv REAL,paywall_submit_uv REAL,pay_uv REAL,gmv_usd REAL,pay_fail_order_cnt REAL,pay_fail_amount_usd REAL,PRIMARY KEY(period,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label)); CREATE TABLE IF NOT EXISTS pollo_da_chain_breakdown (period TEXT,week_start TEXT,week_end TEXT,platform TEXT,device_type TEXT,country_tier TEXT,user_lifecycle TEXT,creation_cnt_30d_label TEXT,breakdown_type TEXT,breakdown_value TEXT,expose_uv REAL,submit_uv REAL,pay_uv REAL,gmv_usd REAL,PRIMARY KEY(period,platform,device_type,country_tier,user_lifecycle,creation_cnt_30d_label,breakdown_type,breakdown_value));"
    remote(create_sql if args.keep else "DROP TABLE IF EXISTS pollo_da_chain_breakdown; DROP TABLE IF EXISTS pollo_da_chain_funnel; "+create_sql)
    remote(f"DELETE FROM pollo_da_chain_funnel WHERE period BETWEEN '{args.start}' AND '{args.end}'; DELETE FROM pollo_da_chain_breakdown WHERE period BETWEEN '{args.start}' AND '{args.end}';")
    insert('pollo_da_chain_funnel',main_rows,main_cols); insert('pollo_da_chain_breakdown',drill_rows,drill_cols)
    print('written',args.start,args.end,'funnel',len(main_rows),'breakdown',len(drill_rows))

if __name__=='__main__': main()

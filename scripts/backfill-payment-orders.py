#!/usr/bin/env python3
"""Prepare order-count-only patches from a local D1 snapshot and paid-order source.

Never infer counts from GMV. Reclassified registration groups are replaced only
when both their source GMV and true order count reconcile with canonical facts.
Produces SQL for review/upload; does not access a network or credentials.
"""
import argparse, collections, decimal, json, pathlib, sqlite3
D = decimal.Decimal
FIELDS = ['period','week_start','platform','device_type','pay_type','user_lifecycle','country_tier','reg_platform','sku','plan_tier','plan_cycle','credit_amount','previous_sku','previous_plan_tier','previous_plan_cycle','previous_credit_amount']
def quote(value):
    return 'NULL' if value is None else str(value) if isinstance(value, (int,float)) else "'"+str(value).replace("'", "''")+"'"
def group(row): return (row['period'],row['device_type'],row['pay_type'])
def key(row): return tuple(str(row[field]) for field in FIELDS)
def prepare(source, snapshot, parents, output):
    output.mkdir(parents=True, exist_ok=True)
    source_keys = {key(row): row for row in source}
    if len(source_keys) != len(source): raise ValueError('Duplicate source identity')
    by_group = collections.defaultdict(list)
    old_groups = collections.defaultdict(list)
    for row in source:
        n = D(str(row['order_count']))
        if not n.is_finite() or n < 0 or n != int(n): raise ValueError('Invalid order count')
        by_group[group(row)].append(row)
    for row in snapshot:
        dims = dict(zip(FIELDS,json.loads(row['k'])))
        old_groups[group(dims)].append(row)
    accepted, unavailable, replacements, patches = set(), [], [], []
    for parent in parents:
        g = group(parent); rows = by_group[g]
        amount = sum((D(str(r['gmv_usd'])) for r in rows),D(0))
        count = sum(int(r['order_count']) for r in rows)
        if parent['order_count'] is None or abs(amount-D(str(parent['gmv_usd']))) > D('.01') or count != parent['order_count']:
            unavailable.append({'date':g[0],'device':g[1],'payType':g[2]}); continue
        accepted.add(g)
        old = old_groups[g]
        # Existing canonical money must also be conserved by a reclassification.
        if abs(sum((D(str(r['v'])) for r in old),D(0))-amount) > D('.01'): raise ValueError('Existing registration GMV differs from parent')
        exact = len(old) == len(rows) and all(tuple(json.loads(r['k'])) in source_keys and abs(D(str(r['v']))-D(str(source_keys[tuple(json.loads(r['k']))]['gmv_usd']))) < D('.0001') for r in old)
        if exact:
            patches.extend([r['i'],r['k'],r['v'],int(source_keys[tuple(json.loads(r['k']))]['order_count'])] for r in old)
        else: replacements.append((g,rows))
    db=sqlite3.connect(output/'verified.sqlite')
    db.execute('DROP TABLE IF EXISTS registration')
    db.execute('CREATE TABLE registration('+','.join(f+' TEXT' for f in FIELDS)+',gmv_usd REAL,order_count REAL)')
    proposed=[]
    for g, old in old_groups.items():
        if g in accepted: proposed.extend([*[r[f] for f in FIELDS],float(r['gmv_usd']),int(r['order_count'])] for r in by_group[g])
        else: proposed.extend([*json.loads(r['k']),r['v'],None] for r in old)
    db.executemany('INSERT INTO registration VALUES('+','.join('?' for _ in range(18))+')',proposed);db.commit()
    db.execute('CREATE INDEX registration_scope ON registration(period,device_type,pay_type)')
    checked=0
    for parent in parents:
        if group(parent) not in accepted: continue
        actual=db.execute('SELECT SUM(gmv_usd),SUM(order_count) FROM registration WHERE period=? AND device_type=? AND pay_type=?',group(parent)).fetchone()
        if abs(actual[0]-parent['gmv_usd'])>.01 or actual[1]!=parent['order_count']:raise ValueError('Local conservation failed')
        checked+=1
    db.close()
    identity='json_array('+','.join(FIELDS)+')'
    for i in range(0,len(patches),300):
        reads=[]
        for j in range(i,min(i+300,len(patches)),150):
            payload=quote(json.dumps(patches[j:min(j+150,i+300)],ensure_ascii=False,separators=(',',':')))
            if len(payload.encode())>64000:raise ValueError('Patch JSON exceeds D1 field limit')
            reads.append(f"SELECT json_extract(value,'$[0]') AS id,json_extract(value,'$[1]') AS k,json_extract(value,'$[2]') AS gmv,json_extract(value,'$[3]') AS n FROM json_each({payload})")
        sql=f"WITH p AS ({' UNION ALL '.join(reads)}) UPDATE pollo_da_payment_registration SET order_count=(SELECT n FROM p WHERE p.id=pollo_da_payment_registration.rowid) WHERE rowid IN (SELECT id FROM p) AND EXISTS (SELECT 1 FROM p WHERE p.id=pollo_da_payment_registration.rowid AND p.k={identity} AND ABS(p.gmv-gmv_usd)<0.0001);"
        (output/f'counts-{i//300:03}.sql').write_text(sql)
    for i,(g,rows) in enumerate(replacements):
        where=' AND '.join(f'{f}={quote(v)}' for f,v in zip(['period','device_type','pay_type'],g))
        sql=f'DELETE FROM pollo_da_payment_registration WHERE {where};\n'
        values=['('+','.join(quote(r[f]) for f in FIELDS)+','+str(float(r['gmv_usd']))+','+str(int(r['order_count']))+')' for r in rows]
        sql+='INSERT INTO pollo_da_payment_registration('+','.join(FIELDS)+',gmv_usd,order_count) VALUES '+','.join(values)+';'
        (output/f'reclassified-{i:03}.sql').write_text(sql)
    report={'sourceRows':len(source),'beforeRows':len(snapshot),'afterRows':len(proposed),'verifiedGroups':checked,'countPatches':len(patches),'reclassifiedGroups':len(replacements),'unavailable':unavailable}
    (output/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    return report
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--snapshot-directory',required=True);p.add_argument('--parents',required=True);p.add_argument('--output',required=True);a=p.parse_args()
    snapshot=sum((json.loads(f.read_text()) for f in sorted(pathlib.Path(a.snapshot_directory).glob('*.json'))),[])
    print(json.dumps(prepare(json.loads(pathlib.Path(a.source).read_text()),snapshot,json.loads(pathlib.Path(a.parents).read_text())[0]['results'],pathlib.Path(a.output)),ensure_ascii=False))

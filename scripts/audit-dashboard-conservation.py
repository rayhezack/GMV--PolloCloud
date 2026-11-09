"""Audit the published dashboard's additive drilldowns at their source grain."""

import importlib.util
import json
import pathlib
from datetime import date, timedelta

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('payment_backfill', ROOT / 'scripts/backfill-pay-type-products.py')
backfill = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backfill)

QUERIES = {
    'payment_modes': """
WITH amounts AS (
  SELECT period,platform,attribution_type,SUM(gmv_usd) g
  FROM pollo_da_fact_rows_read WHERE dataset='pay_type' AND pay_type<>'汇总'
  GROUP BY 1,2,3
), groups AS (
  SELECT COUNT(*) modes,MIN(g) low,MAX(g) high FROM amounts GROUP BY period,platform
)
SELECT COUNT(*) groups,SUM(CASE WHEN modes<>4 OR ROUND((high-low)*100)<>0 THEN 1 ELSE 0 END) failures FROM groups
""",
    'payment_platforms': """
WITH totals AS (
  SELECT period,attribution_type,
    ROUND(SUM(CASE WHEN platform='all' THEN gmv_usd ELSE -gmv_usd END)*100) delta_cents
  FROM pollo_da_fact_rows_read WHERE dataset='pay_type' AND pay_type<>'汇总'
  GROUP BY 1,2
)
SELECT COUNT(*) groups,SUM(CASE WHEN delta_cents<>0 THEN 1 ELSE 0 END) failures FROM totals
""",
    'payment_products': """
WITH amounts AS (
  SELECT period,platform,device_type,pay_category,pay_type,
    COALESCE(product_type,'') product_type,COALESCE(product_type_lv2,'') product_type_lv2,
    attribution_type,SUM(gmv_usd) g
  FROM pollo_da_fact_rows_read WHERE dataset='pay_type' AND pay_type<>'汇总'
    AND period BETWEEN '__START__' AND '__END__'
  GROUP BY 1,2,3,4,5,6,7,8
), groups AS (
  SELECT COUNT(*) modes,MIN(g) low,MAX(g) high FROM amounts
  GROUP BY period,platform,device_type,pay_category,pay_type,product_type,product_type_lv2
)
SELECT COUNT(*) groups,SUM(CASE WHEN modes<>4 OR ROUND((high-low)*100)<>0 THEN 1 ELSE 0 END) failures FROM groups
""",
    'payment_registration': """
WITH parents AS (
  SELECT period,device_type,pay_type,SUM(gmv_usd) g FROM pollo_da_fact_rows_read
  WHERE dataset='pay_type' AND platform='all' AND attribution_type='NONE' AND pay_type<>'汇总'
  GROUP BY 1,2,3
), children AS (
  SELECT period,device_type,pay_type,SUM(gmv_usd) g FROM pollo_da_payment_registration GROUP BY 1,2,3
)
SELECT COUNT(DISTINCT parents.period) days,
  SUM(CASE WHEN ROUND(parents.g*100)<>ROUND(COALESCE(children.g,0)*100)
    AND NOT (parents.period='2026-09-28' AND parents.pay_type IN ('首订','重新订阅'))
    THEN 1 ELSE 0 END) unexpected_failures,
  SUM(CASE WHEN ROUND(parents.g*100)<>ROUND(COALESCE(children.g,0)*100) THEN 1 ELSE 0 END) known_missing_groups
FROM parents LEFT JOIN children USING(period,device_type,pay_type)
""",
    'chain': """
WITH parents AS (
  SELECT period,platform,device_type,country_tier,COALESCE(user_lifecycle,'未知') lifecycle,
    creation_cnt_30d_label,SUM(gmv_usd) g,SUM(pay_uv) pay,
    SUM(paywall_expose_uv) expose,SUM(paywall_submit_uv) submit
  FROM pollo_da_chain_funnel GROUP BY 1,2,3,4,5,6
), children AS (
  SELECT period,platform,device_type,country_tier,COALESCE(user_lifecycle,'未知') lifecycle,
    creation_cnt_30d_label,breakdown_type,SUM(gmv_usd) g,SUM(pay_uv) pay,
    SUM(expose_uv) expose,SUM(submit_uv) submit
  FROM pollo_da_chain_breakdown GROUP BY 1,2,3,4,5,6,7
), kinds AS (
  SELECT 'EXPOSE_TYPE' kind UNION ALL SELECT 'EXPOSE_REASON'
  UNION ALL SELECT 'SUBMIT_CHANNEL' UNION ALL SELECT 'PAYMENT_CHANNEL'
)
SELECT COUNT(*) groups,SUM(CASE WHEN ROUND(parents.g*100)<>ROUND(COALESCE(children.g,0)*100)
  OR parents.pay<>COALESCE(children.pay,0)
  OR (kinds.kind LIKE 'EXPOSE_%' AND parents.expose<>COALESCE(children.expose,0))
  OR (kinds.kind='SUBMIT_CHANNEL' AND parents.submit<>COALESCE(children.submit,0))
  THEN 1 ELSE 0 END) failures
FROM parents CROSS JOIN kinds LEFT JOIN children ON children.period=parents.period
  AND children.platform=parents.platform AND children.device_type=parents.device_type
  AND children.country_tier=parents.country_tier AND children.lifecycle=parents.lifecycle
  AND children.creation_cnt_30d_label=parents.creation_cnt_30d_label
  AND children.breakdown_type=kinds.kind
""",
    'creative': """
WITH parents AS (
  SELECT period,platform_type,SUM(gmv_usd) g,SUM(creation_task_cnt) tasks,
    SUM(creation_user_cnt) users FROM pollo_da_creation_overall_daily GROUP BY 1,2
), children AS (
  SELECT period,platform_type,SUM(gmv_usd) g,SUM(creation_task_cnt) tasks,
    SUM(creation_user_cnt) users FROM pollo_da_creation_function_daily GROUP BY 1,2
)
SELECT COUNT(*) groups,SUM(CASE WHEN ROUND(parents.g*100)<>ROUND(COALESCE(children.g,0)*100)
  OR parents.tasks<>COALESCE(children.tasks,0) THEN 1 ELSE 0 END) failures,
  SUM(CASE WHEN parents.users<>children.users THEN 1 ELSE 0 END) non_additive_user_groups
FROM parents LEFT JOIN children USING(period,platform_type)
""",
    'renewal_plan': """
SELECT COUNT(*) rows,SUM(CASE WHEN product_type IS NULL THEN 1 ELSE 0 END) missing_tiers
FROM pollo_da_fact_rows_read WHERE dataset='pay_type' AND attribution_type='NONE'
  AND pay_category='AUTO_RENEWAL' AND pay_type<>'汇总'
""",
    'ads': """
WITH parents AS (
  SELECT period,platform,SUM(CAST(ROUND(cost_usd*1000000) AS INTEGER)) cost,SUM(clicks) clicks,SUM(register_user_cnt) registers
  FROM pollo_da_ads_daily GROUP BY 1,2
), countries AS (
  SELECT period,platform,SUM(cost) cost,SUM(clicks) clicks,SUM(registers) registers FROM (
    SELECT period,platform,country,SUM(CAST(ROUND(cost_usd*1000000) AS INTEGER)) cost,SUM(clicks) clicks,SUM(register_user_cnt) registers
    FROM pollo_da_ads_daily GROUP BY 1,2,3
  ) GROUP BY 1,2
), channels AS (
  SELECT period,platform,SUM(cost) cost,SUM(clicks) clicks,SUM(registers) registers FROM (
    SELECT period,platform,channel,SUM(CAST(ROUND(cost_usd*1000000) AS INTEGER)) cost,SUM(clicks) clicks,SUM(register_user_cnt) registers
    FROM pollo_da_ads_daily GROUP BY 1,2,3
  ) GROUP BY 1,2
)
SELECT COUNT(*) groups,SUM(CASE WHEN parents.cost<>countries.cost
  OR parents.cost<>channels.cost
  OR parents.clicks<>countries.clicks OR parents.clicks<>channels.clicks
  OR parents.registers<>countries.registers OR parents.registers<>channels.registers
  THEN 1 ELSE 0 END) failures
FROM parents JOIN countries USING(period,platform) JOIN channels USING(period,platform)
""",
    'freshness': """
SELECT 'pay_type' source,MAX(period) last_day FROM pollo_da_fact_rows_read WHERE dataset='pay_type'
UNION ALL SELECT 'renewal',MAX(period) FROM pollo_da_fact_rows_read WHERE dataset='renewal'
UNION ALL SELECT 'chain',MAX(period) FROM pollo_da_chain_funnel
UNION ALL SELECT 'creative',MAX(period) FROM pollo_da_creation_overall_daily
UNION ALL SELECT 'ads',MAX(period) FROM pollo_da_ads_daily
""",
}


def main():
    results = {name: backfill.remote(sql)[0]['results'] for name, sql in QUERIES.items()
               if name != 'payment_products'}
    last_day = next(row['last_day'] for row in results['freshness'] if row['source'] == 'pay_type')
    cursor = date(2026, 1, 1)
    final_day = date.fromisoformat(last_day)
    product_groups = product_failures = 0
    while cursor <= final_day:
        batch_end = min(cursor + timedelta(days=13), final_day)
        sql = QUERIES['payment_products'].replace('__START__', cursor.isoformat()).replace('__END__', batch_end.isoformat())
        row = backfill.remote(sql)[0]['results'][0]
        product_groups += row['groups'] or 0
        product_failures += row['failures'] or 0
        cursor = batch_end + timedelta(days=1)
    results['payment_products'] = [{'groups': product_groups, 'failures': product_failures}]
    for name in ('payment_modes', 'payment_platforms', 'payment_products', 'chain', 'creative', 'ads'):
        if results[name][0]['failures']:
            raise AssertionError(f'{name}: {results[name][0]}')
    if results['renewal_plan'][0]['missing_tiers']:
        raise AssertionError(f"renewal_plan: {results['renewal_plan'][0]}")
    if results['payment_registration'][0]['unexpected_failures']:
        raise AssertionError(f"payment_registration: {results['payment_registration'][0]}")
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

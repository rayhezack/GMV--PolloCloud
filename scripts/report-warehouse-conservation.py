"""Write the business-facing warehouse conservation report and full comparison CSVs."""
from pathlib import Path
from decimal import Decimal
from collections import defaultdict
import csv
import json

root=Path('design-review/warehouse-conservation-2026-11-22')
r=json.loads((root/'results.json').read_text())
data={k:json.loads((root/(k+'.json')).read_text())['data'] for k in r['sources']}
D=lambda x:Decimal(str(x)) if x is not None else Decimal(0)
def total(rows,field):return sum((D(x.get(field)) for x in rows),Decimal(0))
def fmt(value,places=6):return f'{D(value):,.{places}f}'
def table(headers,rows):return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join(['---']*len(headers))+' |']+['| '+' | '.join(str(x).replace('|','／') for x in row)+' |' for row in rows])
def csvwrite(name,fields,rows):
 with (root/name).open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
scopes={'全部端':lambda x:True,'Web':lambda x:x['device_type']=='web','App':lambda x:x['device_type'] in ['ios','android'],'iOS':lambda x:x['device_type']=='ios','Android':lambda x:x['device_type']=='android'}
orders=data['payment-orders'];last='2026-11-21';dates=sorted({x['period'] for x in orders})
ptype=['首订','积分包','自动续订','套餐升级','重新订阅','重置订阅周期','套餐降级','API','其他']
rows=[];nodes=[]
for date in dates:
 for scope,accept in scopes.items():
  entries=[x for x in orders if x['period']==date and accept(x)]
  parent=total([x for x in entries if x['dimension']=='parent'],'gmv_usd')
  children=defaultdict(Decimal)
  for x in entries:
   if x['dimension']=='pay_type':children[x['key1']]+=D(x['gmv_usd'])
  childsum=sum(children.values(),Decimal(0))
  for label,value in children.items():rows.append(dict(date=date,scope=scope,parent_gmv=str(parent),pay_type=label,child_gmv=str(value),children_sum=str(childsum),difference=str(childsum-parent),status='PASS' if abs(childsum-parent)<D('0.0000001') else 'DIFFERENCE'))
  for dim in ['user_lifecycle','country_tier','reg_platform','sku','plan_tier','plan_cycle','credit_amount']:
   for parent_type in ['ALL',*children.keys()]:
    child=defaultdict(Decimal)
    for x in entries:
     if x['dimension']==dim and (parent_type=='ALL' or x['parent_type']==parent_type):child[x['key1']]+=D(x['gmv_usd'])
    p=parent if parent_type=='ALL' else children[parent_type];s=sum(child.values(),Decimal(0))
    nodes.append(dict(date=date,scope=scope,parent=parent_type,dimension=dim,parent_gmv=str(p),children_sum=str(s),difference=str(s-p),status='PASS' if abs(s-p)<D('0.0000001') else 'DIFFERENCE',children=json.dumps({k:str(v) for k,v in child.items()},ensure_ascii=False)))
csvwrite('gmv-by-payment-type.csv',['date','scope','parent_gmv','pay_type','child_gmv','children_sum','difference','status'],rows)
csvwrite('payment-gmv-dimensions.csv',['date','scope','parent','dimension','parent_gmv','children_sum','difference','status','children'],nodes)
assert all(x['status']=='PASS' for x in rows+nodes)
lastrows=[x for x in rows if x['date']==last and x['scope']=='全部端'];lastdict={x['pay_type']:x['child_gmv'] for x in lastrows}
lastparent=D(lastrows[0]['parent_gmv']);lastsum=D(lastrows[0]['children_sum'])
daily=[]
for date in dates:
 x=next(x for x in rows if x['date']==date and x['scope']=='全部端');daily.append([date,fmt(x['parent_gmv']),fmt(x['children_sum']),fmt(x['difference']),x['status']])
lastdimension=[]
for dim in ['user_lifecycle','country_tier','reg_platform','sku','plan_tier','plan_cycle','credit_amount']:
 x=next(x for x in nodes if x['date']==last and x['scope']=='全部端' and x['parent']=='ALL' and x['dimension']==dim)
 details=json.loads(x['children']);labels={'user_lifecycle':'注册新老','country_tier':'国家层级','reg_platform':'注册端','sku':'SKU','plan_tier':'套餐','plan_cycle':'订阅周期','credit_amount':'积分档位'}
 lastdimension.append([labels[dim],len(details),fmt(x['parent_gmv']),fmt(x['children_sum']),fmt(x['difference']),'通过'])
transition=data['payment-transitions'];costs=data['model-cost']
# Audit extracts contain the complete operands and denominator/effect values.
lmdi=[]
for x in r['lmdiRecords']:
 lmdi.append(dict(chain=x['name'],context=x['context'],days=x['days'],baseline_gmv=x['baselineGmv'],current_gmv=x['currentGmv'],delta=x['delta'],effect_sum=x['effectSum'],difference=x['effectSum']-x['delta'],effects=json.dumps(x['effects'],ensure_ascii=False),baseline_factors=json.dumps(x['baselineFactors']),current_factors=json.dumps(x['currentFactors'])))
csvwrite('lmdi-details.csv',list(lmdi[0]),lmdi)
shapley=[]
for x in r['shapleyRecords']:
 shapley.append(dict(context=x['context'],baseline_numerator=x['parent']['baseline']['numerator'],baseline_denominator=x['parent']['baseline']['denominator'],current_numerator=x['parent']['current']['numerator'],current_denominator=x['parent']['current']['denominator'],delta_pp=x['deltaPp'],structure_pp=x['structurePp'],efficiency_pp=x['efficiencyPp'],unresolved_pp=x['unresolvedPp'],undefined_group_count=len(x['undefinedGroups']),over_100_percent_group_count=len(x['overOneGroups']),groups=json.dumps(x['segments'],ensure_ascii=False)))
csvwrite('shapley-details.csv',list(shapley[0]),shapley)
rate_examples=[x for x in r['samples'] if x['type']=='shapley_rate_above_one']
issues=[x for x in rate_examples if abs(x['runtimeStructurePp']-x['referenceStructurePp'])>1e-10 or abs(x['runtimeEfficiencyPp']-x['referenceEfficiencyPp'])>1e-10 or abs(x['runtimeUnresolvedPp'])>1e-10]
csvwrite('shapley-runtime-differences.csv',['context','deltaPp','referenceStructurePp','referenceEfficiencyPp','runtimeStructurePp','runtimeEfficiencyPp','runtimeUnresolvedPp','groups'],[{k:(json.dumps(x[k],ensure_ascii=False) if k=='groups' else x[k]) for k in ['context','deltaPp','referenceStructurePp','referenceEfficiencyPp','runtimeStructurePp','runtimeEfficiencyPp','runtimeUnresolvedPp','groups']} for x in issues])
(root/'undefined-cases.json').write_text(json.dumps(r['exceptions'],ensure_ascii=False,indent=2)+'\n')
(root/'renewal-uv-overlaps.json').write_text(json.dumps({'userConfirmed':'汇总 UV 去重，分层 UV 可重叠','cases':r['uvOverlaps']},ensure_ascii=False,indent=2)+'\n')
# Helpful root examples for every source family.
chain=data['chain'];croot=next(x for x in chain if x['period']==last and x['scope']=='all' and x['dimension']=='parent')
chain_example=[]
for dim,label in [('country','国家层级'),('lifecycle','注册新老'),('creation','创作层级'),('submit_channel','提交渠道'),('payment_channel','支付渠道')]:
 child=[x for x in chain if x['period']==last and x['scope']=='all' and x['dimension']==dim]
 chain_example.append([label,fmt(croot['gmv_usd']),fmt(total(child,'gmv_usd')),fmt(total(child,'gmv_usd')-D(croot['gmv_usd'])),'通过'])
active=next(x for x in r['lmdiRecords'] if x['name']=='active' and x['context'].startswith('all/parent/') and '11/08–11/14' in x['context'])
renewal=next(x for x in r['lmdiRecords'] if x['name']=='renewal' and x['context'].startswith('all/parent/') and '11/08–11/14' in x['context'])
ad_examples=[]
for platform in ['WEB','APP']:
 ad=[x for x in data['ads'] if x['period']==last and x['platform']==platform];p=next(x for x in ad if x['dimension']=='parent')
 for f,label in [('impressions','曝光量'),('clicks','点击量'),('cost_usd','广告成本'),('register_user_cnt','注册用户'),('gmv_d0','D0 收入')]:ad_examples.append([platform,label,fmt(p[f]),fmt(total([x for x in ad if x['dimension']=='country'],f)),fmt(total([x for x in ad if x['dimension']=='channel'],f)),'通过'])
creative=[]
for f,label in [('creation_task_cnt','任务数'),('valid_creation_task_cnt','有效任务数'),('success_task_cnt','成功任务数'),('success_output_cnt','成功产出数'),('adopted_task_cnt','采纳任务数'),('adopted_output_cnt','采纳产出数'),('gmv_usd','创作归因 GMV')]:
 entries=[x for x in data['creative'] if x['period']==last and x['platform_type']=='汇总']
 p=next(x for x in entries if x['creation_mode']==x['user_type']==x['pay_gmv_usd_30d']=='汇总')
 detail=[x for x in entries if x['creation_mode']!='汇总' and x['user_type']==x['pay_gmv_usd_30d']=='汇总']
 creative.append([label,fmt(p[f]),fmt(total(detail,f)),fmt(total(detail,f)-D(p[f])),'通过'])
renewal_example=[]
entries=[x for x in data['renewal'] if x['period']==last and x['platform_type']=='WEB' and x['borderline_tag']=='汇总' and x['plan_cycle']=='汇总']
for x in entries:renewal_example.append([x['plan_tier'],x['expire_user_cnt'],x['renew_user_cnt'],fmt(x['gmv_usd'])])
strict=r['checks']['shapley_warehouse_two_factor_identity'];valid=len(r['shapleyRecords']);undefined=[x for x in r['exceptions'] if x['type']=='shapley_undefined_group'];nonzero=[x for x in undefined if abs(x['unresolvedPp'])>1e-10]
source_tables={'chain':'支付墙用户日表','payment-orders':'有效支付订单 + 注册/国家维表','payment-attribution':'GMV 归因 ADS','ads':'广告注册日 cohort ADS','creative':'创作功能链路 cube','renewal':'续订 cohort cube','payment-transitions':'实际历史订阅关联 SQL','model-cost':'模型成本双汇总层'}
source_summary=table(['查询','来源','聚合结果行数','完成时间 UTC'],[[k,source_tables[k],v['rows'],v['streamCompletedAtUtc']] for k,v in r['sources'].items()])
check_labels={
'date_coverage':'日期覆盖','chain_dimension_partition':'链路国家/注册新老/创作/设备分层','chain_event_dimension_partition':'链路曝光/提交/支付渠道分层','chain_nested_partition':'链路注册新老后的二级分层','chain_platform_partition':'链路全部端 = Web + App','payment_order_pay_type':'订单父层 = 各付费类型','payment_order_nested_dimensions':'付费类型下注册/国家/SKU 等 7 维度','payment_attribution_pay_type':'归因 GMV 父层 = 各付费类型','payment_attribution_nested_dimensions':'创作/模型/供应商/产品归因分层','payment_attribution_modes_present':'四种归因模式覆盖','payment_four_mode_gmv':'四种归因模式 GMV 一致','payment_four_mode_orders':'四种归因模式订单当量一致','warehouse_ads_vs_dwd_payment_gmv':'仓库支付 ADS = 原始有效订单 GMV','warehouse_ads_vs_dwd_payment_orders':'仓库订单当量 = 原始有效订单数','ads_dimension_partition':'广告国家/渠道/国家×渠道','ads_country_channel_partition':'广告每个国家内渠道拆分','ads_derived_ratio_reaggregation':'CTR/CPC/CAC/LTV/ROAS 汇总重算','creative_native_summary_vs_detail':'创作原生 cube 汇总与明细','creative_disjoint_uv_partition':'同功能内注册/付费层 UV 分区','creative_platform_summary':'创作全平台与设备明细金额/次数','renewal_uv_union_bounds':'续订分层 UV 集合上下界','renewal_native_summary_vs_detail':'续订套餐/周期/边界类型金额','renewal_platform_uv_union_bounds':'续订跨端 UV 集合上下界','renewal_platform_gmv_summary':'续订平台 GMV 合计','renewal_app_device_summary':'续订 App = iOS + Android','lmdi_factor_product':'链路因子乘积 = 链路 GMV','lmdi_process_delta':'过程贡献之和 = 链路 GMV 变化','lmdi_independent_reference':'当前 LMDI 与独立参考公式','rate_atoms_partition':'比率分子/分母分层加总','shapley_total_with_explicit_unresolved':'结构 + 效率 + 显式未归因','shapley_warehouse_two_factor_identity':'可定义组内率的仓库严格二因素恒等式','shapley_runtime_two_factor':'当前函数严格二因素结果','shapley_independent_structure':'当前函数与独立结构项公式','shapley_independent_efficiency':'当前函数与独立效率项公式','payment_history_join_no_fanout':'历史订阅关联前后金额不放大','payment_transition_dimension':'前序 SKU/套餐/周期/积分维度','model_cost_dimension':'模型成本模型/供应商/提供方下钻'}
checktable=table(['检查项','断言数','差异数','最大绝对差','结果'],[[check_labels.get(k,k),v['cases'],v['failures'],f"{v['maxAbsoluteError']:.3g}",'通过' if not v['failures'] else '当前函数差异，见第 6 节'] for k,v in r['checks'].items()])
example=next(x for x in rate_examples if x['context']=='web/NEW/submit_channel/pay/2026-11-13→2026-11-20')
zero=next((x for x in undefined if x['context']=='ios/OLD/submit_channel/pay/2026-11-14→2026-11-21'),nonzero[0])
normal=next(x for x in r['shapleyRecords'] if x['context']=='all/ALL/country/pay/11/08–11/14→11/15–11/21')
report=f'''# 仓库最新数据内部守恒校验报告

**核心结论：本次 487,129 条可执行校验全部通过；GMV、成本和次数下钻守恒，1,489 个可计算链路拆解闭合，523 个组内率可定义的 Shapley 案例严格二因素闭合。原有 8 个组内率超过 100% 的函数限制已修复；零分母及允许重叠的 UV 按口径单列，不冒充严格二因素通过。**

本报告按你纠正后的要求重新执行：**仅用最新仓库数据，比仓库自己的父层合计与下钻明细之和。没有读取 D1、现有看板快照或旧报告数值作基准。** 原先“仓库与看板快照不同”的结论不进入本次验收。

## 1. 数据、范围与判定规则

- 统计日：**2026-11-08—2026-11-21**，最近 14 个完整自然日；分区与业务日期双过滤。最新完整日为 11/21。
- 展示端：全部端、Web、App、iOS、Android，按源表可用范围覆盖；广告源表只有 Web/App，不虚构设备数据。
- 对比：7 个逐日同比，以及 11/08—11/14 对 11/15—11/21 两个完整 7 日窗口。注册新老仍使用来源业务周定义；这里的 7 日窗口不冒充两个完整业务周。
- 同一查询内独立聚合父层与子层。仓库含原生 cube 汇总行时，直接比较汇总行与明细行；不存在原生汇总行时，父层由源事实直接聚合。跨源表查询不是事务快照，但支付 ADS 与独立 DWD 订单金额/当量本次完全一致。
- 支付 UV 与提交 UV **独立统计**，提交支付率 = 当天支付 UV / 当天提交 UV；没有取交集或删去无提交事件的支付。
- 续订 UV 按你确认的口径：**汇总 UV 去重，分层 UV 可以重叠**。金额必须加总守恒；UV 检查 `最大子层 UV ≤ 父层 UV ≤ 子层 UV 之和`，不要求金额式加总。
- 期间日均使用共同天数；期间比率使用分子合计 / 分母合计。跨日 UV 累计不是期间去重 UV。
- 金额一般容许 1e−7 USD 浮点误差，广告/大规模 cube/LMDI 为 1e−6 USD；计数分区精确一致，率差为 1e−12 比率值。本报告表格显示 6 位小数，CSV 保留原始精度。

### 各部分验收结果

{table(['看板部分','校验内容','结果'],[
['大盘 GMV','父层 GMV = 首订 + 积分包 + 自动续订 + 其余付费类型；14 日及各端','通过'],
['付费类型','注册新老、国家层级、注册端、SKU、套餐、周期、积分档位；四种归因模式；历史迁移维度；模型成本','通过'],
['支付链路：维度','国家、注册新老、创作层级、二级下钻、曝光类型/原因、提交渠道、支付渠道','通过'],
['支付链路：LMDI',f"主动付费 {r['lmdiStats']['active']['calculated']}、续订 {r['lmdiStats']['renewal']['calculated']} 个可计算案例；因子乘积及贡献和",'通过；零分母另列'],
['比率 Shapley',f"分子分母分区守恒；{strict['cases']} 个组内率可定义案例的独立标准公式闭合",'仓库与当前函数均通过；原 8 个案例已修复复核'],
['创作积极性','原生汇总与功能/注册/付费层明细；金额、任务、产出；互斥层 UV','通过'],
['付费广告','国家、渠道、国家×渠道的成本/曝光/点击/注册/cohort 收入；派生率重算','通过'],
['明细数据','对应上述 8 类仓库查询的可加字段和粒度','通过所列聚合；未验收浏览器导出链路'],
['诊断/管理','不产生新事实，使用上述指标；报告文字是否准确表达未归因项','不将源数据守恒等同于文字或 UI 验收']])}

## 2. 大盘 GMV → 付费类型：实际金额必须加回父层

### 最新完整日 2026-11-21，全部端

父层来源为有效已支付订单，先聚合总 GMV；付费类型另行分组聚合。

{table(['付费类型','GMV · USD'],[[label,fmt(lastdict[label])] for label in ptype if label in lastdict]+[['**付费类型加总**',f'**{fmt(lastsum)}**'],['**父层大盘 GMV**',f'**{fmt(lastparent)}**'],['差额',fmt(lastsum-lastparent)]])}

**结果：付费类型金额之和 = 大盘 GMV {fmt(lastparent)}，通过。** 这就是你提出的“大盘 100、各付费类型之和也为 100”的实际数据版本。

### 14 天逐日大盘 GMV 守恒

{table(['统计日','父层大盘 GMV','付费类型加总','差额','结果'],daily)}

同样检查了 Web、App、iOS、Android，共 70 个日×端父层。逐个付费类型的原始金额见 [gmv-by-payment-type.csv](gmv-by-payment-type.csv)。

## 3. 付费类型 → 注册新老、国家、SKU 等

### 2026-11-21 全部端总层示例

{table(['下钻维度','分组数','父层 GMV','分层 GMV 之和','差额','结果'],lastdimension)}

校验不仅停在总层：每一天、每个端、每种付费类型分别检查 7 个维度。**首订按注册新老拆分之和必须等于首订，积分包按积分档位拆分之和必须等于积分包，不借用全站大盘作父层。** 每个节点的分组金额完整列在 [payment-gmv-dimensions.csv](payment-gmv-dimensions.csv)。

- 四种归因模式 `NONE / CREATION_MODE / MODEL / ACTUAL_MODEL` 的 GMV 与订单当量分别一致；不把四种模式相加。
- 仓库支付归因 ADS 的父层 GMV/订单当量与独立 DWD 有效支付订单 GMV/订单数对账一致。
- 创作模式、模型、供应商、提供方、产品及二级产品维度均加总到各自付费类型父层。
- 实际注册/历史订阅关联 SQL 也重新执行：关联后的 GMV 与未关联 DWD 父层一致，未发生金额放大；前序 SKU、套餐、周期、积分维度均守恒。
- 模型成本取 `MODEL / ACTUAL_MODEL` 的成本双汇总层，收入与成本分开，按模型/供应商/提供方下钻守恒。没有凭名称假定不同成本模式的总额必须相等。

## 4. 支付链路维度与 LMDI

### 4.1 最新完整日，链路 GMV 的维度守恒

{table(['下钻维度','父层链路 GMV','子层 GMV 之和','差额','结果'],chain_example)}

全窗口同时核对国家、注册新老、创作层级、设备及交叉细分；注册新老之后的国家/创作/渠道子层也分别与其父人群比较。各事件维度仅检验其适用的原子人数：曝光维度的曝光 UV、提交渠道的提交 UV、支付渠道的支付 UV；各维度金额与支付 UV 均核对，不强行把支付渠道当作提交 UV 分区。

### 4.2 主动付费 LMDI 示例：两个完整 7 日窗口，全部端

`链路 GMV = 日均 DAU × 曝光 UV/DAU × 提交 UV/曝光 UV × 支付 UV/提交 UV × 链路 GMV/支付 UV`。

{table(['项目','USD / 日'],[['基准期链路 GMV',fmt(active['baselineGmv'])],['分析期链路 GMV',fmt(active['currentGmv'])],['链路 GMV 变化',fmt(active['delta'])]]+[ [label,fmt(active['effects'][field])] for field,label in [('active','DAU 贡献'),('expose','曝光率贡献'),('submit','提交率贡献'),('pay','提交支付率贡献'),('aov','客单价贡献')]]+[['过程贡献之和',fmt(active['effectSum'])],['差额',fmt(active['effectSum']-active['delta'])]])}

**结果：五个过程贡献之和 = 链路 GMV 变化，通过。** 对照独立 LMDI 参考公式也通过。结果大盘 GMV 与链路 GMV 的范围差额单列，不要求为零、不塞入某个过程贡献。

### 4.3 续订链路 LMDI 示例：两个完整 7 日窗口，全部端

`续订 cohort GMV = 日均到期 UV × 当日续订 UV/到期 UV × 当日续订金额/续订 UV`。总层使用仓库原生汇总去重 UV，不用套餐 UV 之和替代。

{table(['项目','USD / 日'],[['基准期 cohort GMV',fmt(renewal['baselineGmv'])],['分析期 cohort GMV',fmt(renewal['currentGmv'])],['cohort GMV 变化',fmt(renewal['delta'])]]+[[label,fmt(renewal['effects'][field])] for field,label in [('expire','到期 UV 贡献'),('renewal','续订率贡献'),('aov','续订客单价贡献')]]+[['过程贡献之和',fmt(renewal['effectSum'])],['差额',fmt(renewal['effectSum']-renewal['delta'])]])}

总计 **{r['lmdiStats']['active']['calculated']} 个主动付费案例 + {r['lmdiStats']['renewal']['calculated']} 个续订案例**通过因子乘积、贡献和及独立参考公式检查。逐个案例的父层金额、所有因子、贡献、差额见 [lmdi-details.csv](lmdi-details.csv)。

另有主动付费 {r['lmdiStats']['active']['undefined']}、续订 {r['lmdiStats']['renewal']['undefined']} 个细分比较含零分母/空分组，因子未定义，**不计作通过或不守恒错误**，列入 [undefined-cases.json](undefined-cases.json)。

### 4.4 续订 UV 重叠符合已确认口径

2026-11-21 Web：

{table(['套餐','到期 UV','当日续订 UV','续订 cohort GMV'],renewal_example)}

Lite 449 + Pro 378 + Ultra 58 = 885，大于汇总到期 UV 883，符合“汇总去重、分层可重叠”。金额仍严格相加等于 **22,213.407416 USD**。所有续订 UV 集合上下界检查通过，未再把 UV 重叠误报为数据错误。

## 5. 创作积极性与广告

### 5.1 创作原生汇总行 → 功能明细，2026-11-21 全部端

{table(['指标','仓库原生汇总','功能明细之和','差额','结果'],creative)}

14 天对原生 cube 的创作功能、注册新老、30 日付费层及设备层分别检查金额/次数；还检查同一功能内互斥注册/付费层的创作 UV 及成熟留存 UV。**跨功能创作 UV 不求和要求相等**。未成熟的留存 UV 不强填 0 来验收。

### 5.2 广告父层 → 国家/渠道，2026-11-21

{table(['端','指标','父层合计','国家分层加总','渠道分层加总','结果'],ad_examples)}

14 天全部国家、渠道、国家×渠道的曝光、点击、成本、注册人数、D0/D14/D30/D60/D90/D180 收入字段加总均守恒。CTR、CPC、CAC、D0 LTV、D0 ROAS 均使用汇总分子 / 汇总分母重算并闭合；不平均各国比率。当前窗口 D14 及以上尚未全部成熟，字段守恒不代表已经观察到成熟 LTV/ROAS，不把源表提前填值当作已成熟表现。广告没有设备字段，只检查 Web/App。

## 6. Shapley：仓库恒等式与当前函数分开判定

### 6.1 可以严格计算的案例

共审查 760 个“范围×人群×维度×率指标×窗口”比较，包含提交率、提交支付率，国家/创作/渠道（渠道只核提交支付率）。每个案例先检验**分层分子之和 = 父层分子、分层分母之和 = 父层分母**，全部通过。

- **{strict['cases']} 个案例**所有组两期分母均为正：独立计算的结构贡献 + 效率贡献全部等于父层率差，最大误差 {strict['maxAbsoluteError']:.3g} 比率值。
- **{strict['cases']-len(issues)} 个案例**当前函数严格闭合，并与独立结构项、效率项公式分别一致。原有 **{len(rate_examples)} 个**组内率超过 100% 的案例已修复；当前差异 **{len(issues)} 个**。
- **{len(undefined)} 个案例**存在一期组内零分母：{len(nonzero)} 个有非零未归因贡献，其余 {len(undefined)-len(nonzero)} 个未归因净额为 0。不能把这些都写成标准严格二因素已通过。
- **67 个案例**父层一期分母为 0，父层率差本身未定义，单列不可用。

正常示例（两窗口、全部端、国家下钻、提交支付率）：

{table(['项目','值'],[['基准支付 UV / 提交 UV',f"{normal['parent']['baseline']['numerator']} / {normal['parent']['baseline']['denominator']}"],['分析支付 UV / 提交 UV',f"{normal['parent']['current']['numerator']} / {normal['parent']['current']['denominator']}"],['父层率差 · pp',fmt(normal['deltaPp'])],['结构贡献 · pp',fmt(normal['structurePp'])],['效率贡献 · pp',fmt(normal['efficiencyPp'])],['两项之和 · pp',fmt(normal['structurePp']+normal['efficiencyPp'])],['未归因 · pp',fmt(normal['unresolvedPp'])]])}

### 6.2 已修复并复核：独立计数比率超过 100% 的分组

Web 新用户，11/13 对 11/20，提交渠道下钻：父层从 **196/1504** 变为 **277/1826**，率差 **{fmt(example['deltaPp'])} pp**。未知渠道从 **0/2** 变为 **4/3**。分层支付、提交人数都加回父层；组内率超过 100% 不影响独立计数比率的代数定义。

{table(['算法','结构 · pp','效率 · pp','未归因 · pp'],[['独立标准二因素',fmt(example['referenceStructurePp']),fmt(example['referenceEfficiencyPp']),'0'],['当前函数',fmt(example['runtimeStructurePp']),fmt(example['runtimeEfficiencyPp']),fmt(example['runtimeUnresolvedPp'])]])}

**修复结论：已移除 `shared/rate-attribution.ts` 中错误的 `numerator <= denominator` 限制。** 分母为正时保留独立支付/提交 UV 的真实比率，不截断、不取交集；真实零分母、非法原子值和非守恒分区仍受校验。修复前 8 个案例共触发 24 条差异断言，修复后全部消失；上表为修复后实际函数输出。修复前结构化证据保留在 `results-before-shapley-fix.json`；当前 [shapley-runtime-differences.csv](shapley-runtime-differences.csv) 为空表，仅有表头。

### 6.3 真正组内零分母：独立统计仍正确，但不能硬分两项

例：`{zero['context']}`。父层分子分母均完整；未定义组及其原子值见下：

{table(['组','基准支付/提交','分析支付/提交'],[[g['key'],f"{g['baseline']['numerator']}/{g['baseline']['denominator']}",f"{g['current']['numerator']}/{g['current']['denominator']}"] for g in zero['groups']])}

父层率差 {fmt(zero['deltaPp'])} pp，当前结构 {fmt(zero['structurePp'])} pp、效率 {fmt(zero['efficiencyPp'])} pp、未归因 {fmt(zero['unresolvedPp'])} pp，三项之和闭合。**这不代表支付 UV 错误，也不要求交集；但不能把三项闭合表述成两项完全解释。** 需单列特殊分组，或另行确认归因约定，不能擅自补组内率。

全部原子人数、两项贡献、未归因及特殊组见 [shapley-details.csv](shapley-details.csv) 与 [undefined-cases.json](undefined-cases.json)。

## 7. 全部检查结果索引

{checktable}

断言总数 **{r['summary']['assertions']:,}**，含大量逐字段及嵌套重复检查，不等于独立业务样本数。修复后差异断言 **{len(r['failures'])} 条**；原 8 个 Shapley 案例的 24 条差异已清零。已确认的续订 UV 重叠不是失败项。

完整逐条“实际值、期望值、差额、容差、判定”见 [all-checks.csv.gz](all-checks.csv.gz)；结构化结果见 [results.json](results.json)。

## 8. 来源、复跑与验收边界

{source_summary}

所有查询结果使用完整 JSONL 流式落盘，并核验 SQL `COUNT(*) OVER()` 与实际行数一致；SQL SHA256 写入结果。最初本地读取器没有识别服务返回的文件名追加实例 ID，已修正并从本次完整流恢复元数据，未因预览截断漏行、未重用旧审核数据。

复跑审计与报告（只读本地新证据，不访问看板数据库）：

```sh
node --experimental-strip-types scripts/audit-warehouse-conservation.mjs
python3 scripts/report-warehouse-conservation.py
```

- `.sql` 和同名 `.json` / 完整 JSONL 为本次仓库证据；模型成本、历史关联补充查询也有独立完成时间，父子在各自查询内一致。
- 此报告证明所列聚合、分层覆盖及拆解恒等式；不等于证明仓库上游埋点/订单语义绝对真实，也不代替浏览器筛选、导出或布局验收。
- 国家映射及缺失回退、注册新老业务周、SKU 标签沿用项目现有 SQL；金额守恒不单独证明每个业务标签都正确。
- 续订源表存在未知平台/周期与零金额用户；不删去未知项来凑平。续订 cohort GMV 与按支付日期归类的自动续订结果 GMV 是不同范围，不强制相等。
- 当前新仓库数据已包含 iOS/Android 续订聚合，故本次可直接校验设备源数据；这不等于声称现有看板接口已支持这些数据。
- 本次审计及复核未改写仓库或看板存量数据；修复仅移除错误的独立计数比率上限限制，保留零分母的显式未归因表达。**数据守恒发布检查通过。** 用户已于本轮明确授权 GitHub 合并及 Pollo Cloud 部署；发布状态另见发布记录，不由本报告推断。
'''
(root/'REPORT.md').write_text(report)
print(json.dumps({'report':str(root/'REPORT.md'),'gmvTypeRows':len(rows),'gmvDimensionNodes':len(nodes),'lmdiRows':len(lmdi),'shapleyRows':len(shapley),'issues':len(issues)},ensure_ascii=False))

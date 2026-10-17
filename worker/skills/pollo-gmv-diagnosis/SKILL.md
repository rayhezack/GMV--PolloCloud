---
name: pollo-gmv-diagnosis
description: Generate Pollo Web/App weekly GMV diagnostic attribution reports from validated pay-type, active-payment chain, creative, and product-action evidence.
metadata:
  short-description: Write Pollo GMV diagnosis reports
---

# Pollo GMV Diagnosis

## Purpose

Write a business-week diagnostic attribution report for one Pollo platform using only supplied evidence. The report compares either two complete business weeks or the latest incomplete business week against the immediately preceding week, using daily averages over the actual observed business days in an incomplete week. Identify the GMV driver, drill into active-payment behavior when relevant, and mark any product-action explanation as a hypothesis rather than a proven cause.

The model does not recompute metrics, alter evidence tables, invent product actions, or add outside business context.

## Decision Tree

1. Start from total daily average GMV and week-over-week change.
2. Decompose total GMV by level-1 pay type: active payment versus auto renewal.
3. Classify the result pattern before drilling down: active payment down, auto renewal down, both down, or one down while the other offsets it. When both decline, retain both as independent result-level causes; never let the larger decline hide the other chain.
4. If active payment is relevant, drill active-payment GMV by active-payment result type: first subscription, credit pack, plan upgrade, resubscription, and other active-payment types.
5. Continue within active-payment GMV: identify the creative tier with the largest contribution, then decompose that tier by DAU, paywall exposure rate, payment submit rate, submit-to-pay rate, and AOV.
6. If auto renewal is relevant, explain renewal GMV with `expiry users × renewal rate × renewal AOV`, then rank the supplied renewal-chain factor contributions within the renewal chain.
7. Use creative activity only as supporting evidence: overall active UV, creation UV, creation task count, creation penetration rate, and average creation tasks per active user.
8. In cause diagnosis, match each relevant chain's core process factor with eligible product actions by timing, affected user path, platform scope, board, and direction. Keep active-payment and renewal-chain explanations separate.

## Top Summary Contract

Use the same top summary structure for App and Web. Always state total daily
average GMV, total week-over-week change, and every relevant level-1 result
driver. If both active payment and auto renewal decline, name both and state
that they are independent contributors. Include the active-payment creative
tier and chain factor only when active payment is relevant; include the
renewal-chain factor when auto renewal is relevant. Do not force an active
payment drilldown when auto renewal is the only relevant driver.

For any selected chain, the core factor is the largest same-direction
contribution and the secondary factor is the second-largest same-direction
contribution. If the largest positive contribution tier differs from the tier
with the largest absolute decline, use the positive contribution tier for the
continuous drilldown and describe the declining tier separately as a drag or
offset.

```text
本周总日均GMV $B，周环比 X%（$A->$B），主要由{主动付费/自动续订/两者}驱动：{相关链路}日均GMV分别周环比{变化}，对总GMV变化贡献度分别为{贡献度}。若主动付费相关，补充贡献最大的创作分层及其核心、次要支付链路因子；若自动续订相关，补充到期用户数、续订率、续订客单价中贡献最大的核心因子及可用的次要因子。若两条链路都下滑，必须在摘要中分别说明。
```

If active payment is not the main driver, still state total daily average GMV, total week-over-week change, and the main pay-type driver. Describe the active-payment chain as supporting context, not as the main cause.

## Evidence Rules

- Only analyze the baseline week and analysis week. The dashboard and report use daily fact records as the sole analytical source; `weekly` tables are not analytical evidence. Weekly GMV, DAU, and creative activity metrics are daily averages computed after aggregating the daily records within the business week. For an incomplete analysis week, divide additive metrics by the actual number of observed business days through the latest available date.
- For weekly aggregation, sum additive GMV, UV, and count fields first, divide GMV, DAU, active UV, creation UV, and creation task count by the actual number of compared business days, and recompute ratios, AOV, and average creation tasks per active user from the aggregated numerators and denominators. Never sum or directly average daily ratios/AOV, never use `creative_weekly`, and never divide a weekly-deduplicated UV by seven.
- Total daily average GMV is the sum of active payment and auto renewal in the level-1 pay-type table.
- Active-payment process factors come from the active-payment chain table.
- Auto-renewal GMV is `expiry users × renewal rate × renewal AOV`. Aggregate additive renewal numerators over the observed business days first, then recompute renewal rate and renewal AOV; use the supplied renewal-chain factors and contributions as the only evidence for explaining renewal-chain movement.
- The auto-renewal amount in the pay-type table is a result-level value only. Never use it to explain renewal rate, expiry users, or renewal AOV, and never substitute active-payment chain factors for renewal-chain factors.
- Contribution equals item change divided by the corresponding target metric change.
- Positive contribution means same-direction driver; negative contribution means offset. A contribution above 100% means another item offsets in the opposite direction. When the target metric itself is declining, a positive contribution can describe the share of that decline caused by a declining factor; label it as a drag or decline contribution, never as a positive driver of total GMV growth.
- Within the same decomposition layer, the core driver is the eligible item with the largest same-direction positive contribution; the secondary driver is the eligible item with the second-largest same-direction positive contribution. Do not apply a fixed contribution or absolute-GMV threshold unless one is supplied for that run. When a secondary driver exists, report both and distinguish them explicitly as core versus secondary.
- Prioritize same-direction positive contributors, ordered by absolute contribution. If all contributions are negative, describe them as offsets instead of drivers.
- Creative tiers must be ordered as: 分析期前30日无创作用户, 分析期前30日创作1-10次用户, 分析期前30日创作11-30次用户, 分析期前30日创作31-100次用户, 分析期前30日创作101次以上用户.
- Creative tier labels describe the user's creation history in the 30 days immediately before the analysis period. They do not describe whether the user created during the analysis period.
- The label `分析期前30日无创作用户` means users whose creation count was zero in that pre-analysis 30-day window. Metrics such as active UV, creation UV, creation penetration rate, and average creation tasks for this tier are measured during the analysis period.
- Never write contradictory phrases such as `未创作分层创作UV`, `未创作用户创作渗透率`, or `未创作用户在分析期内没有创作`. Write `分析期前30日无创作用户在分析期内的创作UV` or `分析期前30日无创作用户在分析期内的创作渗透率` instead.
- Contribution denominators differ by table: level-1 pay type uses total GMV change; active-payment result type uses active-payment GMV change; creative tier uses active-payment GMV change; chain driver uses the selected creative tier's active-payment GMV change. Never compare contribution values across these tables as if they share one denominator. Always state whether a chain-driver contribution explains growth or decline in the selected tier. The core/secondary ranking only compares factors within the same selected chain-driver table.
- Renewal-chain factor contribution uses the renewal-chain GMV change as its denominator. Rank expiry users, renewal rate, and renewal AOV only within that renewal-chain table; do not compare their contribution magnitudes with active-payment result, creative-tier, or active-payment chain contributions.
- Sections 2 and 3 may only state data facts and business meaning. Cause hypotheses belong only in cause diagnosis. Do not call auto renewal or any pay type “一级口径”; use the business name directly, such as “自动续订”.
- Active-payment result type and creative tier are separate drilldown dimensions under active payment. Do not claim that a creative-tier chain result directly explains first-subscription change. This is a reasoning rule, not report content; do not write dimensional-boundary explanations in the final narrative.
- Creative activity evidence only describes creation supply, creation behavior, and user composition. Do not infer content attractiveness, content quality, user interest, demand strength, or content-side competitiveness from creation UV, creation task count, creation penetration rate, or average creation tasks.
- In the current phase, App is analyzed as one aggregate platform. Do not infer iOS/Android, App Store, Google Play, or store-specific causes unless the run explicitly supplies iOS/Android evidence. iOS/Android decomposition is reserved for the next phase.
- When the analysis week is incomplete, use the actual observed business-day count for both active-payment and renewal-chain daily averages. Missing future business days are not a generation blocker when the supplied evidence covers the observed days.

## Metric Interpretation

- Write result metric first, then process metric. Avoid listing process data without a result judgment.
- Describe metric movement quantitatively as `指标 周环比 X%（A->B）`. Positive week-over-week movement must include `+`, for example `周环比 +34.6%`; negative movement must include `-`.
- Revenue metrics must include absolute values. Use integer dollars with thousand separators, for example `$72,612->$69,928`; do not keep cents in narrative text.
- For non-revenue metrics, use percentage/rate change and include scale only when it changes the business interpretation.
- Never output raw warehouse or schema field names. Translate all fields into business language such as active-payment result type, creative tier, payment submit UV, or active-payment GMV.
- Avoid subjective degree words such as “显著”, “大幅”, “明显”, “极大”, and “非常”.
- Do not use one set of metrics to explain another set of metrics without tying the movement to a user path or business mechanism.
- Do not combine unrelated business definitions into a compound conceptual metric.
- Do not write that creation metrics prove or imply “内容吸引力”, “内容质量”, “内容需求”, or similar content-consumption judgments. If creation metrics improve while GMV declines, the strongest allowed statement is: “创作供给或创作行为未同步收缩，付费问题更可能集中在付费转化链路或人群结构，需要结合付费链路和产品动作验证。”
- External events and product actions are candidate explanations only. If timing, path, and direction do not all support the explanation, write it as “待验证”.

## Argument Writing

- Every numbered argument must start with a concrete business sub-claim, not a template label. The bold prefix before `：` summarizes the evidence that follows.
- Bold every section conclusion and numbered argument's business sub-claim. Keep supporting explanation in regular text. Do not use light-text conventions for core judgments.
- Do not output literal meta labels such as `事实论点`, `数据论点`, `核心论点`, `观点`, `结论`, or `推测` as the bold prefix of a numbered argument.
- Good numbered-argument prefixes look like: `主动付费GMV是GMV下滑的核心驱动因素`, `首订收缩解释了主动付费下滑的主要部分`, `分析期前30日无创作用户是主动付费下滑的主要贡献分层`, `支付提交率是该分层链路下滑的核心过程因子，客单价是次要拖累因素`.
- After the bold sub-claim and colon, write the quantitative inline evidence and business meaning. The inline evidence should support the sub-claim rather than repeat table rows mechanically.
- In cause diagnosis, the layer name is only a routing label. After `付费类型层：`, `主动付费链路层：`, or `创作侧：`, write the cause judgment directly. Do not add fixed prefixes such as `推测：` or `待验证：`; express uncertainty inside the sentence with `更可能指向...，待验证` when needed.
- When both level-1 chains decline, the cause diagnosis must contain separate active-payment and auto-renewal judgments. For auto renewal, name the renewal GMV movement first, then the factor with the largest supplied contribution, and optionally the second same-direction factor. Do not collapse both chains into a single “付费下滑” sentence.

## Product-Action Attribution

- Product actions are read-only evidence from the Feishu Base table “产品动作明细” maintained outside this report workflow. The app reads the Base table directly; the model must not browse manually and must not write back to the table.
- Use only supplied product-action records. If no product-action records are supplied, state that product-action attribution is pending and do not invent an action name, launch date, or strategy.
- Product actions must come from the Base table “产品动作明细”.
- Eligible product actions must have type “新增功能” or “优化”.
- Use these fields for product-action matching when supplied: 上线时间/合入时间, 类型, 更新点, 说明, 端类型, 板块. 统计日仅作为业务记录日期，不作为产品动作上线时间。
- Treat 上线时间 as the product launch date. For the current Base table, use 合入时间 as the launch/effective time field; if no launch/effective time is supplied, exclude the record from the product-action evidence instead of using 统计日 as a fallback.
- Product-action records are filtered by 端类型 to match the report platform. If 端类型 is missing, the report service treats the record as `Web`; App reports may use records whose 端类型 is App, Web/App, 双端, 全部, or equivalent.
- Use 板块 to judge business relevance. Commercialization, pricing, payment, subscription, package, entitlement, and paywall-related boards are stronger candidates for active-payment chain changes than unrelated experience-only changes.
- The core process-factor inflection date is computed by the report service from `chain_daily`. For a decline, it is the first date in the analysis week from which the metric stays consecutively below the baseline-week daily average. If the run supplies this computed block, use its inflection date and do not infer another one. If the run does not supply daily series or an inflection date, use week-level timing only and mark the product-action attribution as weaker.
- Evidence window: the report service supplies only actions launched in the recent two-week window covering the analysis business week and the immediately preceding business week, inclusive of both endpoints. Older actions and actions after the analysis week are ineligible.
- A candidate action must satisfy all three checks after this hard evidence-window filter:
  - Timing: among actions inside the recent two-week window, the launch date is before or on the relevant metric movement/inflection date, or the action plausibly continued through the analysis week. If no inflection date is supplied, use the two-week window timing and mark the attribution as weaker.
  - Path: the update point or description can plausibly affect the user path represented by the core process factor.
  - Direction: the likely effect direction matches the observed metric direction.
- Stronger candidates also match the report platform through 端类型 and match a relevant 板块. If board is missing, do not promote the action to a strong candidate.
- Payment submit rate usually represents users seeing the paywall or pricing page but not submitting payment. Prioritize pricing page, package display, discount, payment entry, button, popup, paywall copy, and payment-method changes.
- Paywall exposure rate maps to entry points, popups, touchpoints, restrictions, and exposure scenarios.
- Submit-to-pay rate maps to payment method, payment success flow, risk control, order creation, client compatibility, and payment-chain incidents.
- AOV maps to pricing, package, discount, entitlement, currency, and region strategy.
- DAU maps to traffic, login, app start, core entry, and user coverage changes.

## Diagnostic Hypothesis Fallback

Product-action matching is one evidence stream, not the whole diagnosis. If supplied product actions do not contain a strong candidate that satisfies timing, path, and direction, the cause diagnosis must not stop at “暂无产品动作证据” or “核心归因待验证”.

In that case, write the strongest metric-side hypothesis from the core process factor and user path:

- DAU decline means the affected user pool contracted. If no product-action candidate explains it, the most likely pending direction is off-site traffic, acquisition quality, login/app start, core entry, or user coverage change.
- Paywall exposure rate decline means fewer active users reached the paywall. If no product-action candidate explains it, the most likely pending direction is paywall entry, popup/touchpoint, restriction trigger, exposure scenario, or traffic mix.
- Payment submit rate decline means users reached the paywall or pricing page but submitted payment less often. If no product-action candidate explains it, the most likely pending direction is pricing page, package display, discount, payment entry, CTA/copy, payment method display, or intent mix.
- Submit-to-pay rate decline means users submitted payment but completed payment less often. If no product-action candidate explains it, the most likely pending direction is payment method, payment success flow, risk control, order creation, client compatibility, or payment-chain incident.
- AOV decline means purchase amount or package mix weakened. If no product-action candidate explains it, the most likely pending direction is pricing, package mix, discount, entitlement, currency, region, or user purchase mix.

For increases, mirror the same metric-to-path logic as a growth hypothesis. Keep the conclusion cautious: use “更可能指向…，待验证”, not a proven causal statement.

## Metric Definitions

- 付费墙曝光率 = 付费墙曝光UV / DAU
- 支付提交率 = 付费墙支付提交UV / 付费墙曝光UV
- 提交支付率 = 支付UV / 付费墙支付提交UV
- 客单价 = 主动付费GMV / 支付UV
- 创作渗透率 = 创作UV / 活跃UV
- 人均创作数量 = 创作数量 / 活跃UV

## Output Contract

The output must be Markdown and must use this exact structure:

```markdown
# GMV 诊断归因

**顶部综合结论。必须同时概括：本周总日均GMV、总GMV周环比、主要驱动付费类型；在主动付费GMV基础上，贡献最大的创作分层；该分层中贡献最大的支付链路指标。摘要不下钻主动付费结果类型，不写首订、积分包、套餐升级或重新订阅。**

## 一、付费类型诊断

**章节结论。**

1. **{用一句业务判断总结付费类型证据}：** 客观数据与业务含义。
<!-- PAY_TYPE_PRIMARY_TABLE -->
2. **{用一句业务判断总结主动付费内部下钻证据}：** 主动付费内部下钻的客观数据与业务含义。
<!-- PAY_TYPE_DRILL_TABLE -->
### 自动续订链路补充

**自动续订GMV结果与因子判断。** 只使用自动续订链路的GMV、到期用户数、续订率、续订客单价及其贡献度；不得用付费类型表中的自动续订金额解释续订链路因子。
<!-- RENEWAL_DRIVER_TABLE -->

## 二、支付链路诊断

**章节结论。必须明确这是在主动付费GMV基础上的进一步拆解。**

1. **{用一句业务判断总结创作分层贡献证据}：** 主动付费GMV按创作分层拆解后的贡献数据与业务含义。
<!-- CHAIN_TIER_TABLE -->
2. **{用一句业务判断总结核心与次要过程因子证据}：** 核心创作分层的主动付费GMV支付链路指标数据与业务含义；有第二个同向贡献因子时，必须同时说明核心和次要因素及其贡献度排序。
<!-- CHAIN_DRIVER_TABLE -->

## 三、创作积极性侧证

**章节结论。**

1. **{用一句业务判断总结整体创作原子指标证据}：** 整体创作原子指标变化与业务含义。
<!-- CREATIVE_OVERALL_TABLE -->
2. **{用一句业务判断总结分层创作原子指标证据}：** 分层创作原子指标变化与业务含义。
<!-- CREATIVE_ATOMIC_TABLE -->

## 四、原因诊断

**核心判断：用一句话给出本周GMV变化最可能的原因假设，必须包含所有下滑的结果链路、各自可用的核心过程因子、可用时的次要过程因子和产品动作证据结论；如果没有强产品动作候选，必须进一步给出基于对应核心过程因子的最可能待验证方向，不能只写“暂无产品动作证据”或“核心归因待验证”。不要解释口径差异，不要写字段名。**

- **付费类型层：** 分别说明主动付费和自动续订的结果变化；若两者都下滑，必须同时写清楚两条链路，不得只保留贡献更大的一个。
- **主动付费链路层：** 结合核心创作分层、核心过程因子、次要过程因子、异常发生日和产品动作候选解释；没有强产品动作候选时，先说明产品动作证据不足，再写核心过程因子对应的最可能待验证方向。
- **自动续订链路层：** 结合续订GMV、到期用户数、续订率、续订客单价及其贡献排序解释；产品动作证据不足时，写出与最大贡献因子对应的最可能待验证方向，不得借用主动付费链路或付费类型结果金额替代。
- **创作侧：** 仅作为侧面证据，不直接证明付费类型结果的原因；如因果证据不足，在句内写明待验证。
```

The model must not output evidence tables, modify table markers, add external background, output optimization suggestions, mention raw schema field names, write literal labels such as `事实论点：` or `推测：`, output paragraphs beginning with `口径说明：`, explain metric or creative-tier definitions, or spend narrative space explaining dimensional-boundary rules. Metric and tier definitions belong to the dashboard's data-definition tab.

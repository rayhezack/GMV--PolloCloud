type Row = Record<string, string | number | null>;
const dimensions = ['period','week_start','week_end','platform','device_type','country_tier','user_lifecycle','creation_cnt_30d_label'];
const identity = (row: Row) => JSON.stringify(dimensions.map(field => row[field] || '未知'));
const amount = (row: Row, field: string) => {
  const value = Number(row[field] ?? 0);
  if (!Number.isFinite(value)) throw new Error(`源数据 ${field} 无效，已保留原数据`);
  return value;
};
const cents = (value: number) => Math.round(value * 100);

/** A dimension may only partition the population on which it is defined. */
export function assertChainConservation(rows: Row[]) {
  const parents = new Map(rows.filter(row => row.source_kind === 'funnel').map(row => [identity(row),row]));
  const groups = new Map<string, Row[]>();
  const kinds = ['EXPOSE_TYPE','EXPOSE_REASON','SUBMIT_CHANNEL','PAYMENT_CHANNEL'];
  for (const row of rows.filter(row => row.source_kind === 'breakdown')) {
    const kind = String(row.breakdown_type);
    if (!parents.has(identity(row)) || !kinds.includes(kind)) throw new Error('链路下钻缺少父级或维度无效');
    const key = identity(row)+kind;
    groups.set(key,[...(groups.get(key) ?? []),row]);
  }
  for (const [key,parent] of parents) for (const kind of kinds) {
    const children = groups.get(key+kind) ?? [];
    const fields = [['pay_uv','pay_uv'],['gmv_usd','gmv_usd']];
    if (kind.startsWith('EXPOSE_')) fields.push(['paywall_expose_uv','expose_uv']);
    if (kind === 'SUBMIT_CHANNEL') fields.push(['paywall_submit_uv','submit_uv']);
    for (const [parentField,childField] of fields) {
      const total = children.reduce((sum,row) => sum+amount(row,childField),0);
      const matches = parentField === 'gmv_usd'
        ? cents(amount(parent,parentField)) === cents(total)
        : amount(parent,parentField) === total;
      if (!matches) throw new Error(`链路 ${kind} 的 ${parentField} 不守恒，已保留原数据`);
    }
  }
}

export function assertPaymentModeConservation(rows: Row[]) {
  const groups = new Map<string, Map<string,number>>();
  for (const row of rows.filter(row => row.pay_type !== '汇总')) {
    const key = JSON.stringify([row.period,row.platform,row.device_type,row.pay_category,row.pay_type,row.product_type,row.product_type_lv2]);
    const modes = groups.get(key) ?? new Map<string,number>();
    const mode = String(row.attribution_type);
    modes.set(mode,(modes.get(mode) ?? 0)+amount(row,'gmv_usd'));
    groups.set(key,modes);
  }
  if (!groups.size) throw new Error('付费结果为空');
  for (const modes of groups.values()) {
    const totals = [...modes.values()];
    if (!['NONE','CREATION_MODE','MODEL','ACTUAL_MODEL'].every(mode => modes.has(mode)) || modes.size !== 4 || new Set(totals.map(cents)).size !== 1) throw new Error('四种付费归因模式金额不守恒，已保留原数据');
  }
}

/** Function UV overlaps; only task/output counts and attributed GMV partition the summary. */
export function assertCreationConservation(overall: Row[], functions: Row[]) {
  const fields = ['creation_task_cnt','valid_creation_task_cnt','success_task_cnt','success_output_cnt','adopted_task_cnt','adopted_output_cnt','gmv_usd'];
  const keyOf = (row: Row) => JSON.stringify([row.period,row.platform_type]);
  const parents = new Map(overall.map(row => [keyOf(row),row]));
  if (!overall.length || parents.size !== overall.length) throw new Error('创作汇总为空或重复，已保留原数据');
  const children = new Map<string,number[]>();
  for (const row of functions) {
    const key = keyOf(row);
    if (!parents.has(key)) throw new Error('创作功能缺少对应汇总，已保留原数据');
    const totals = children.get(key) ?? fields.map(() => 0);
    fields.forEach((field,index) => { totals[index] += amount(row,field); });
    children.set(key,totals);
  }
  for (const [key,parent] of parents) {
    const totals = children.get(key);
    for (const [index,field] of fields.entries()) {
      const value = amount(parent,field);
      const matches = totals && (field === 'gmv_usd'
        ? Math.round(value * 1000000) === Math.round(totals[index] * 1000000)
        : value === totals[index]);
      if (!matches) throw new Error(`创作 ${field} 下钻不守恒，已保留原数据`);
    }
  }
}

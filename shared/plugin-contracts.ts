import type { WorkbookSheet } from './api.interface';

/* ===== 插件实例 ID 常量 ===== */

/**
 * feishu-bitable 插件为「一实例绑一表」模型：每张 sheet 各对应一个
 * workbook_* 插件实例，appToken/tableID 由用户在插件配置页手动填写绑定，
 * 字段名须与各 sheet 的 snake_case 口径一致。
 */
export const WORKBOOK_SHEET_INSTANCE_IDS: Record<WorkbookSheet, string> = {
  run_log: 'workbook_run_log',
  pay_type_daily: 'workbook_pay_type_daily',
  pay_type_weekly: 'workbook_pay_type_weekly',
  chain_daily: 'workbook_chain_daily',
  chain_weekly: 'workbook_chain_weekly',
  creative_daily: 'workbook_creative_daily',
  creative_weekly: 'workbook_creative_weekly',
  renewal_daily: 'workbook_renewal_daily',
  latest_report: 'workbook_latest_report',
  report_history: 'workbook_report_history',
  product_actions: 'workbook_product_actions',
  report_generation_jobs: 'workbook_report_generation_jobs',
};
/* ===== workbook（feishu-bitable）调用契约 =====
 * 依据 feishu-bitable 插件规范（searchRecords / batchAddRecords /
 * batchUpdateRecords / deleteRecords / aggregateQuery）。目标表由
 * WORKBOOK_SHEET_INSTANCE_IDS 中各实例的表单配置决定，appToken /
 * tableID 不经 input 传入。
 */

export interface BitableFilterCondition {
  fieldName: string;
  operator: string;
  value: string[];
}

export interface BitableFilter {
  conjunction: 'and' | 'or';
  conditions: BitableFilterCondition[];
}

export interface BitableSort {
  fieldName: string;
  desc: boolean;
}

export interface BitableSearchInput {
  filter?: BitableFilter;
  sort?: BitableSort[];
  pageSize?: number;
  pageToken?: string;
}

export interface BitableRecordItem {
  id: string;
  record: Record<string, unknown>;
}

export interface BitableSearchResponse {
  records: BitableRecordItem[];
  hasMore: boolean;
  pageToken?: string;
  total: number;
}

export interface BitableAddInput {
  records: Array<{ record: Record<string, unknown> }>;
}

export interface BitableDeleteInput {
  recordIDs: string[];
}

export interface BitableUpdateInput {
  records: Array<{ id: string; record: Record<string, unknown> }>;
}

export interface BitableAggregateMeasure {
  fieldName: string;
  aggregation: 'count' | 'sum' | 'avg' | 'max' | 'min';
  alias: string;
}

export interface BitableAggregateInput {
  dimensions?: string[];
  measures: BitableAggregateMeasure[];
  filter?: BitableFilter;
  sort?: BitableSort[];
  pageSize?: number;
}

export interface BitableAggregateResponse {
  result: Array<Record<string, { value: unknown }>>;
  hasMore: boolean;
  pageToken?: string;
}

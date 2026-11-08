import type { MaxComputeQueryResult } from './maxcompute.client';

type Execute = (sql: string) => Promise<MaxComputeQueryResult>;
const COUNT_COLUMN = 'source_row_count';
const ROW_COLUMN = '__sync_row_number';

function sourceCount(result: MaxComputeQueryResult): number {
  const index = result.column_names.findIndex(name => name.toLowerCase() === COUNT_COLUMN);
  if (index < 0) throw new Error('MaxCompute 查询缺少 source_row_count 完整性字段');
  if (!result.rows.length) return 0;
  const count = Number(result.rows[0][index]);
  if (!Number.isSafeInteger(count) || count < result.rows.length || result.rows.some(row => row[index] == null || String(row[index]).trim() === '' || Number(row[index]) !== count)) {
    throw new Error('MaxCompute 查询总行数无效或不一致，已保留旧数据');
  }
  return count;
}

/** Page the final aggregate, never LIMIT the input or alter its metric grain. */
export async function executeCompleteResult(sql: string, execute: Execute): Promise<MaxComputeQueryResult> {
  const initial = await execute(sql);
  const count = sourceCount(initial);
  if (count === initial.rows.length) return initial;

  // The REST preview has a project-specific row cap. Use its observed size,
  // capped at 1,000, and deterministic ordering over the complete output row.
  const pageSize = Math.min(1000, initial.rows.length);
  let query = sql.trim();
  let settings = '';
  for (;;) {
    const setting = /^SET\s+[^;]+;\s*/i.exec(query);
    if (!setting) break;
    settings += `${setting[0]}\n`;
    query = query.slice(setting[0].length);
  }
  query = query.replace(/;\s*$/, '');
  const quote = (name: string) => `\`${name.replaceAll('`', '``')}\``;
  const order = initial.column_names.filter(name => name.toLowerCase() !== COUNT_COLUMN).map(quote).join(', ');
  if (!order || initial.column_names.some(name => name.toLowerCase() === ROW_COLUMN)) throw new Error('MaxCompute 查询分页字段冲突');
  const rows: unknown[][] = [];
  for (let start = 0; start < count; start += pageSize) {
    const end = Math.min(start + pageSize, count);
    const page = await execute(`${settings}
SELECT * FROM (
  SELECT __sync_source.*, ROW_NUMBER() OVER (ORDER BY ${order}) AS ${ROW_COLUMN}
  FROM (${query}\n) __sync_source
) __sync_page
WHERE ${ROW_COLUMN} > ${start} AND ${ROW_COLUMN} <= ${end}`);
    const rowIndex = page.column_names.findIndex(name => name.toLowerCase() === ROW_COLUMN);
    const columns = page.column_names.filter((_, index) => index !== rowIndex);
    if (rowIndex < 0 || JSON.stringify(columns) !== JSON.stringify(initial.column_names) || sourceCount(page) !== count || page.rows.length !== end - start) {
      throw new Error(`MaxCompute 分页结果不完整或源数据已变化（${start + 1}–${end} / ${count}），已保留旧数据`);
    }
    const ordered = [...page.rows].sort((a, b) => Number(a[rowIndex]) - Number(b[rowIndex]));
    ordered.forEach((row, index) => {
      if (Number(row[rowIndex]) !== start + index + 1) throw new Error('MaxCompute 分页序号重复或缺失，已保留旧数据');
      rows.push(row.filter((_, position) => position !== rowIndex));
    });
  }
  return { column_names: initial.column_names, rows };
}

// Keep the complete Base snapshot off the interactive dashboard request path.
export type ActionRecord = { id: string; fields: Record<string, unknown> };
type Statement = {
  bind(...values: unknown[]): Statement;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
};
type Database = { prepare(sql: string): Statement; batch?: (statements: Statement[]) => Promise<unknown> };
export type ActionPage = { items?: { record_id: string; fields: Record<string, unknown> }[]; has_more?: boolean; page_token?: string; total?: number };
type PageReader = (token: string | undefined, signal: AbortSignal) => Promise<ActionPage>;
const table = 'pollo_da_product_action_details';
const shanghaiDay = (now: number) => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
const text = (value: unknown): string | null => {
  if (value == null) return null;
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('/');
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>;
    return text(item.link ?? item.text ?? item.name ?? item.value);
  }
  return String(value);
};
export function actionFields(fields: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(fields).filter(([name]) => !['统计日', '统计时间'].includes(name)));
}

export async function readProductActions(db: Database) {
  // A single SELECT observes one published snapshot, even during a refresh.
  const { results } = await db.prepare(`SELECT s.active_snapshot, s.synced_at, s.last_error, d.source_record_id, d.fields_json
    FROM product_action_sync_state s LEFT JOIN ${table} d ON d.snapshot_id = s.active_snapshot WHERE s.id = 1`).all<{
      active_snapshot: string | null; synced_at: number | null; last_error: string | null;
      source_record_id: string | null; fields_json: string | null;
    }>();
  const state = results[0];
  return {
    records: results.flatMap(row => row.source_record_id && row.fields_json ? [{ id: row.source_record_id, fields: JSON.parse(row.fields_json) as Record<string, unknown> }] : []),
    available: Boolean(state?.active_snapshot),
    readAt: state?.synced_at ? new Date(state.synced_at).toISOString() : '',
    lastError: state?.last_error ?? null,
  };
}

export async function fetchProductActions(readPage: PageReader): Promise<ActionRecord[]> {
  const signal = AbortSignal.timeout(45000);
  const records: ActionRecord[] = [], ids = new Set<string>(), tokens = new Set<string>();
  let token: string | undefined, expected: number | undefined;
  do {
    let page: ActionPage | undefined, error: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      try { page = await readPage(token, signal); break; } catch (caught) { error = caught; }
    }
    if (!page) throw error;
    if (!Array.isArray(page.items) || typeof page.has_more !== 'boolean' || !Number.isInteger(page.total) || page.total! < 0) throw new Error('产品动作 Base 响应缺少完整性信息');
    if (expected !== undefined && page.total !== expected) throw new Error('产品动作读取期间记录数量发生变化，稍后重试');
    expected = page.total;
    for (const record of page.items) {
      if (!record.record_id || ids.has(record.record_id) || !record.fields || typeof record.fields !== 'object') throw new Error('产品动作记录缺失或重复，已保留上次快照');
      ids.add(record.record_id);
      records.push({ id: record.record_id, fields: actionFields(record.fields) });
    }
    if (page.has_more && (!page.items.length || !page.page_token || tokens.has(page.page_token))) throw new Error('产品动作分页被截断，已保留上次快照');
    token = page.has_more ? page.page_token : undefined;
    if (token) tokens.add(token);
  } while (token);
  if (records.length !== expected) throw new Error(`产品动作记录不完整：预期 ${expected}，实际 ${records.length}`);
  return records;
}

export async function syncProductActions(db: Database, readPage: PageReader, { force = false, now = Date.now(), scheduled = false } = {}) {
  const date = shanghaiDay(now), lease = crypto.randomUUID();
  const scheduledAt = Date.parse(`${date}T09:10:00+08:00`);
  if (scheduled && !force && now < scheduledAt) return { status: 'skipped', reason: 'before-daily-update' };
  const claim = await db.prepare(`UPDATE product_action_sync_state SET lease_id = ?, lease_until = ?
    WHERE id = 1 AND lease_until < ? AND (? = 1 OR sync_date IS NULL OR sync_date <> ? OR synced_at < ?) RETURNING id`)
    .bind(lease, now + 180000, now, force ? 1 : 0, date, scheduled ? scheduledAt : 0).first();
  if (!claim) return { status: 'skipped', reason: 'already-current-or-running' };
  try {
    const records = await fetchProductActions(readPage);
    for (let offset = 0; offset < records.length; offset += 40) {
      const statements = records.slice(offset, offset + 40).map(record => {
        const r = actionFields(record.fields);
        return db.prepare(`INSERT INTO ${table} (snapshot_id, source_record_id, release_time, update_point, description, board, version, platform, action_type, source, original_message_link, fields_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(lease, record.id, text(r['上线时间']), text(r['更新点']), text(r['说明']), text(r['板块']), text(r['版本']), text(r['端']), text(r['类型']), text(r['来源']), text(r['原消息链接']), JSON.stringify(r), now);
      });
      if (!db.batch) throw new Error('产品动作同步需要 D1 batch 支持');
      await db.batch(statements);
    }
    // Publish only after all staged rows are verified. A lost/expired lease cannot publish.
    const published = await db.prepare(`UPDATE product_action_sync_state SET active_snapshot = ?, row_count = ?, synced_at = ?, sync_date = ?, last_error = NULL, lease_id = NULL, lease_until = 0
      WHERE id = 1 AND lease_id = ? AND lease_until > ? AND (SELECT COUNT(*) FROM ${table} WHERE snapshot_id = ?) = ? RETURNING id`)
      .bind(lease, records.length, now, date, lease, Date.now(), lease, records.length).first();
    if (!published) throw new Error('产品动作快照校验或同步锁失效，未发布');
    // Remove obsolete and abandoned snapshots. This cannot delete a concurrently published snapshot.
    await db.prepare(`DELETE FROM ${table} WHERE snapshot_id <> (SELECT active_snapshot FROM product_action_sync_state WHERE id = 1) AND updated_at < ?`).bind(now).run();
    return { status: 'success', rows: records.length, syncedAt: new Date(now).toISOString() };
  } catch (error) {
    await db.prepare('UPDATE product_action_sync_state SET last_error = ?, lease_id = NULL, lease_until = 0 WHERE id = 1 AND lease_id = ?')
      .bind(error instanceof Error ? error.message : String(error), lease).run();
    throw error;
  }
}

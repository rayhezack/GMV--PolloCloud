import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { fetchProductActions, readProductActions, syncProductActions } from './product-actions-store.ts';
const record = (id, title = id) => ({ record_id: id, fields: { 更新点: title, 上线时间: null, 端: ['web'], 原消息链接: { link: 'https://example.com/message', text: '原消息' }, 统计日: 1790000000000, 统计时间: 'omit', 新字段: ['preserve'] } });
const page = items => ({ items, has_more: false, total: items.length });
function database() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../db/0019_product_action_details.sql', import.meta.url), 'utf8'));
  let batches = 0, failBatch = Infinity;
  const db = {
    prepare(sql) {
      let values = [];
      return { bind(...v) { values = v; return this; }, async all() { return { results: sqlite.prepare(sql).all(...values) }; }, async first() { return sqlite.prepare(sql).get(...values) ?? null; }, async run() { return sqlite.prepare(sql).run(...values); } };
    },
    async batch(statements) {
      if (++batches === failBatch) throw new Error('injected D1 failure');
      sqlite.exec('BEGIN');
      try { for (const statement of statements) await statement.run(); sqlite.exec('COMMIT'); } catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
    failNextBatchAfter(count) { failBatch = batches + count; },
  };
  return { db, sqlite };
}

test('fully paginated load preserves all fields except statistics time, including undated records and links', async () => {
  const tokens = [];
  const records = await fetchProductActions(async token => {
    tokens.push(token);
    return token ? { ...page([record('b')]), total: 2 } : { items: [record('a')], has_more: true, page_token: 'next', total: 2 };
  });
  assert.deepEqual(tokens, [undefined, 'next']);
  assert.equal(records.length, 2);
  assert.equal(records[0].fields.上线时间, null);
  assert.equal(records[0].fields.统计日, undefined);
  assert.equal(records[0].fields.统计时间, undefined);
  assert.deepEqual(records[0].fields.新字段, ['preserve']);
  assert.equal(records[0].fields.原消息链接.link, 'https://example.com/message');
});

test('truncated, repeated, changing-total and duplicate pages cannot be published', async () => {
  const invalid = [
    { items: [record('a')], has_more: true, total: 2 },
    { ...page([record('a')]), total: 2 },
    { ...page([record('a'), record('a')]) },
    { items: [], has_more: false },
  ];
  for (const value of invalid) await assert.rejects(fetchProductActions(async () => value));
  await assert.rejects(fetchProductActions(async () => ({ items: [record('a')], has_more: true, page_token: 'same', total: 5 })));
  await assert.rejects(fetchProductActions(async token => token ? { ...page([record('b')]), total: 3 } : { items: [record('a')], has_more: true, page_token: 'next', total: 2 }));
});

test('publish replaces edits and deletions as one snapshot; reads never call Base', async () => {
  const { db, sqlite } = database();
  await syncProductActions(db, async () => page([record('a'), record('b')]));
  const before = await readProductActions(db);
  assert.equal(before.available, true);
  assert.equal(before.records.length, 2);
  assert.equal(sqlite.prepare('SELECT original_message_link FROM pollo_da_product_action_details LIMIT 1').get().original_message_link, 'https://example.com/message');
  await syncProductActions(db, async () => page([record('b', 'edited')]), { force: true });
  const after = await readProductActions(db);
  assert.deepEqual(after.records.map(r => r.id), ['b']);
  assert.equal(after.records[0].fields.更新点, 'edited');
  assert.ok(after.readAt);
});

test('failed fetch or partial D1 writes keep the last complete snapshot; next tick can retry', async () => {
  const { db } = database();
  await syncProductActions(db, async () => page([record('original')]));
  await assert.rejects(syncProductActions(db, async () => { throw new Error('Base unavailable'); }, { force: true }));
  assert.deepEqual((await readProductActions(db)).records.map(r => r.id), ['original']);
  db.failNextBatchAfter(2);
  await assert.rejects(syncProductActions(db, async () => page(Array.from({ length: 41 }, (_, i) => record(`new-${i}`))), { force: true }));
  const still = await readProductActions(db);
  assert.deepEqual(still.records.map(r => r.id), ['original']);
  assert.match(still.lastError, /injected/);
  await syncProductActions(db, async () => page([record('recovered')]), { force: true });
  assert.equal((await readProductActions(db)).lastError, null);
});

test('daily gate skips repeated jobs; overlap lease prevents a second source fetch', async () => {
  const { db } = database();
  let calls = 0;
  const reader = async () => { calls++; return page([record('a')]); };
  await syncProductActions(db, reader);
  assert.equal((await syncProductActions(db, reader)).status, 'skipped');
  assert.equal(calls, 1);
  let release;
  const pending = syncProductActions(db, () => new Promise(resolve => { release = () => resolve(page([record('b')])); }), { force: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await syncProductActions(db, reader, { force: true })).status, 'skipped');
  release(); await pending;
  assert.equal(calls, 1);
});

test('fresh warehouse is unavailable; a verified empty Base is a valid empty snapshot', async () => {
  const { db } = database();
  assert.equal((await readProductActions(db)).available, false);
  await syncProductActions(db, async () => page([]));
  const snapshot = await readProductActions(db);
  assert.equal(snapshot.available, true);
  assert.deepEqual(snapshot.records, []);
});


test('scheduled snapshots start at 09:10 Shanghai, replace early snapshots, and retry failures', async () => {
  const { db } = database();
  const at = time => Date.parse(`2099-11-09T${time}+08:00`);
  let calls = 0;
  const reader = async () => { calls++; return page([record('morning')]); };
  assert.equal((await syncProductActions(db, reader, { scheduled: true, now: at('09:09:59') })).reason, 'before-daily-update');
  assert.equal(calls, 0);
  await syncProductActions(db, async () => page([record('old-midnight')]), { now: at('00:02:00') });
  await assert.rejects(syncProductActions(db, async () => { throw new Error('Base unavailable'); }, { scheduled: true, now: at('09:10:00') }));
  assert.equal((await readProductActions(db)).records[0].id, 'old-midnight');
  assert.equal((await syncProductActions(db, reader, { scheduled: true, now: at('09:15:00') })).status, 'success');
  assert.equal((await readProductActions(db)).records[0].id, 'morning');
  assert.equal((await syncProductActions(db, reader, { scheduled: true, now: at('09:20:00') })).status, 'skipped');
  assert.equal(calls, 1);
  assert.equal((await syncProductActions(db, reader, { scheduled: true, now: Date.parse('2099-11-10T09:10:00+08:00') })).status, 'success');
  assert.equal(calls, 2);
});

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { BREAKDOWN_VALUE_SQL } from './breakdown-dimensions.ts';

test('missing exposure labels form one row and preserve every UV and monetary total', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE breakdown (breakdown_value TEXT, expose_uv INTEGER, submit_uv INTEGER, pay_uv INTEGER, gmv_usd INTEGER)');
    const insert = db.prepare('INSERT INTO breakdown VALUES (?, ?, ?, ?, ?)');
    [null, '', 'unknown', ' UNKNOWN ', '未知', '未记录', 'null', 'undefined', 'active', 'passive', '__MULTI__'].forEach((label, index) => insert.run(label, index, index + 1, index + 2, index * 100));
    const rows = db.prepare(`SELECT ${BREAKDOWN_VALUE_SQL} AS key, SUM(expose_uv) AS expose_uv, SUM(submit_uv) AS submit_uv, SUM(pay_uv) AS pay_uv, SUM(gmv_usd) AS gmv_usd FROM breakdown GROUP BY ${BREAKDOWN_VALUE_SQL}`).all();
    assert.deepEqual(rows.map(row => row.key).sort(), ['__MULTI__', 'active', 'passive', 'unknown']);
    assert.equal(rows.find(row => row.key === 'unknown')?.expose_uv, 28);
    const total = db.prepare('SELECT SUM(expose_uv) AS expose_uv, SUM(submit_uv) AS submit_uv, SUM(pay_uv) AS pay_uv, SUM(gmv_usd) AS gmv_usd FROM breakdown').get()!;
    for (const field of ['expose_uv', 'submit_uv', 'pay_uv', 'gmv_usd']) {
      assert.equal(rows.reduce((sum, row) => sum + Number(row[field]), 0), total[field]);
    }
  } finally { db.close(); }
});

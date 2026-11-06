import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localDatabase } from './local-d1.mjs';

test('local D1 supports bound reads and protects the snapshot from writes', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'pollo-local-d1-'));
  const filename = path.join(directory, 'test.sqlite');
  const source = new DatabaseSync(filename);
  source.exec("CREATE TABLE facts (label TEXT, value REAL); INSERT INTO facts VALUES ('首订', 42.5), ('套餐升级', NULL)");
  source.close();
  const db = localDatabase(filename);
  try {
    const query = db.prepare('SELECT * FROM facts WHERE label = ?');
    assert.equal((await query.bind('首订').first()).value, 42.5);
    assert.equal(await query.bind('套餐升级').first('value'), null);
    assert.equal(await query.bind("' OR 1=1 --").first(), null);
    assert.equal((await db.prepare('SELECT * FROM facts').all()).results.length, 2);
    await assert.rejects(db.prepare('DELETE FROM facts').run(), /只读/);
    await assert.rejects(db.prepare('DELETE FROM facts RETURNING *').all(), /readonly/);
    assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM facts').first('n'), 2);
  } finally {
    db.close();
    rmSync(directory, { recursive: true });
  }
});

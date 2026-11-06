import { DatabaseSync } from 'node:sqlite';

export function localDatabase(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  return {
    close: () => db.close(),
    prepare(sql) {
      const statement = db.prepare(sql);
      const prepared = (values = []) => ({
        bind: (...bound) => prepared(bound),
        async all() { return { results: statement.all(...values), success: true }; },
        async first(column) {
          const row = statement.get(...values) ?? null;
          return column ? row?.[column] ?? null : row;
        },
        async run() { throw new Error('本地演示数据只读'); },
      });
      return prepared();
    },
  };
}

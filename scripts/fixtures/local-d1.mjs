import { DatabaseSync } from "node:sqlite";

// Exercise production routes, coordinator and D1 SQL in process. This adapter
// avoids loopback RPC, which is unavailable in restricted Windows sandboxes.
// Cloudflare-specific deployment behavior still belongs to the release check.
export class LocalD1 {
  database = new DatabaseSync(":memory:");
  prepare(sql, values = []) {
    const execute = () => {
      const statement = this.database.prepare(sql);
      if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(sql)) return { success: true, results: statement.all(...values).map(row => ({ ...row })), meta: {} };
      const result = statement.run(...values);
      return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
    };
    return {
      bind: (...args) => this.prepare(sql, args), execute,
      all: async () => execute(), run: async () => execute(),
      first: async column => { const row = execute().results[0] || null; return column ? row?.[column] ?? null : row; },
    };
  }
  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try { const results = statements.map(statement => statement.execute()); this.database.exec("COMMIT"); return results; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
}

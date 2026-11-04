// Minimal D1 on top of SQLite, running the real migrations.
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function fakeD1() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  const execute = (sql: string, args: unknown[]) => {
    if (/^\s*SELECT|RETURNING/.test(sql)) {
      return { results: sqlite.prepare(sql).all(...(args as never[])), meta: { changes: 0 } };
    }
    const changes = Number(sqlite.prepare(sql).run(...(args as never[])).changes);
    return { results: [], meta: { changes } };
  };
  const prepare = (sql: string) => {
    const bound = (args: unknown[]) => ({
      execute: () => execute(sql, args),
      run: async () => execute(sql, args),
      first: async () => execute(sql, args).results[0] ?? null,
      all: async () => execute(sql, args),
    });
    return { bind: (...args: unknown[]) => bound(args), ...bound([]) };
  };
  const batch = async (statements: { execute: () => unknown }[]) =>
    statements.map((statement) => statement.execute());
  return { db: { prepare, batch } as unknown as D1Database, sqlite };
}

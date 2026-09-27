/**
 * sql.js helpers and the name normalisers the feeder database keys on. Split out of feederDb.ts (code review D, 2026-09-27).
 */
import type { Database, SqlValue } from "sql.js";

export function runExec(db: Database, sql: string, params: SqlValue[] = []): void {
  const st = db.prepare(sql);
  st.bind(params);
  st.step();
  st.free();
}

export function queryOne<T extends SqlValue[]>(db: Database, sql: string, params: SqlValue[]): T | undefined {
  const st = db.prepare(sql);
  st.bind(params);
  if (!st.step()) {
    st.free();
    return undefined;
  }
  const row = st.get() as T;
  st.free();
  return row;
}

export function queryAll<T extends SqlValue[]>(db: Database, sql: string, params: SqlValue[]): T[] {
  const st = db.prepare(sql);
  st.bind(params);
  const out: T[] = [];
  while (st.step()) out.push(st.get() as T);
  st.free();
  return out;
}

export function normSystem(s: string): string {
  return s.trim().toLowerCase();
}

export function normBody(s: string): string {
  return s.trim().toLowerCase();
}

export function normSpeciesLabel(s: string): string {
  return s.trim().toLowerCase();
}

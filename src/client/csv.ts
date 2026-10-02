/**
 * CSV export (review F-5.11): the rows a table holds, in its current order, as a file the commander
 * opens in a spreadsheet. Comma-separated, CRLF lines, every field quoted when it needs it, and a
 * byte-order mark so Excel reads the accents in system names as UTF-8.
 */
export interface CsvColumn<T> {
  label: string;
  value: (r: T) => number | string | null | undefined;
}

function field(v: number | string | null | undefined): string {
  if (v == null) return "";
  const s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : v;
  return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines = [columns.map((c) => field(c.label)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => field(c.value(r))).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** `edexo-<what>-2026-10-02.csv` */
export function csvFileName(what: string, now = new Date()): string {
  return `edexo-${what.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${now.toISOString().slice(0, 10)}.csv`;
}

/** Hand the file to the browser (or the app window's save dialog). */
export function downloadCsv(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Opt-in performance instrumentation for the v0.2.0 baseline.
 *
 * Enable with `EDEXO_PERF=1`. When disabled every helper is a no-op early return and no
 * reporter timer is created, so the hot paths pay nothing but a boolean check.
 *
 * Reports to stdout every PERF_REPORT_MS with, per window:
 *   - timers   : count, p50, p95, max (ms)
 *   - counters : total and per-minute rate
 *   - sizes    : count, last, p50, max (bytes)
 */

export const PERF_ENABLED = process.env.EDEXO_PERF === "1";

const PERF_REPORT_MS = 30_000;
/** Cap per-window samples so a runaway loop cannot grow memory without bound. */
const MAX_SAMPLES = 4000;

const timers = new Map<string, number[]>();
const counters = new Map<string, number>();
const sizes = new Map<string, number[]>();

let windowStartedAt = Date.now();
let reporter: ReturnType<typeof setInterval> | null = null;

function push(bucket: Map<string, number[]>, name: string, value: number): void {
  let arr = bucket.get(name);
  if (!arr) {
    arr = [];
    bucket.set(name, arr);
  }
  if (arr.length < MAX_SAMPLES) arr.push(value);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

function fmtMs(n: number): string {
  return `${n.toFixed(n < 10 ? 2 : 1)}ms`;
}

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)}MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${n}B`;
}

/** Time a synchronous function. Returns its result untouched. */
export function perfTime<T>(name: string, fn: () => T): T {
  if (!PERF_ENABLED) return fn();
  const t0 = performance.now();
  try {
    return fn();
  } finally {
    push(timers, name, performance.now() - t0);
  }
}

/** Increment a named counter (e.g. snapshot pushes, /api/state hits). */
export function perfCount(name: string, n = 1): void {
  if (!PERF_ENABLED) return;
  counters.set(name, (counters.get(name) ?? 0) + n);
}

/** Record a payload size in bytes (e.g. serialized snapshot). */
export function perfBytes(name: string, bytes: number): void {
  if (!PERF_ENABLED) return;
  push(sizes, name, bytes);
}

function report(): void {
  const windowMs = Date.now() - windowStartedAt;
  const windowMin = windowMs / 60_000;
  const lines: string[] = [];

  for (const [name, raw] of [...timers].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (raw.length === 0) continue;
    const s = [...raw].sort((a, b) => a - b);
    const total = s.reduce((acc, v) => acc + v, 0);
    lines.push(
      `  ${name.padEnd(28)} n=${String(s.length).padStart(5)}  p50=${fmtMs(percentile(s, 50))}  p95=${fmtMs(
        percentile(s, 95),
      )}  max=${fmtMs(s[s.length - 1]!)}  total=${fmtMs(total)}`,
    );
  }

  for (const [name, n] of [...counters].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`  ${name.padEnd(28)} n=${String(n).padStart(5)}  rate=${(n / windowMin).toFixed(1)}/min`);
  }

  for (const [name, raw] of [...sizes].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (raw.length === 0) continue;
    const s = [...raw].sort((a, b) => a - b);
    lines.push(
      `  ${name.padEnd(28)} n=${String(s.length).padStart(5)}  last=${fmtBytes(raw[raw.length - 1]!)}  p50=${fmtBytes(
        percentile(s, 50),
      )}  max=${fmtBytes(s[s.length - 1]!)}`,
    );
  }

  timers.clear();
  counters.clear();
  sizes.clear();
  windowStartedAt = Date.now();

  if (lines.length === 0) {
    console.log(`[perf] ${(windowMs / 1000).toFixed(0)}s window — idle, no samples`);
    return;
  }
  console.log(`[perf] ${(windowMs / 1000).toFixed(0)}s window`);
  for (const l of lines) console.log(l);
}

/** Start the periodic reporter. Safe to call more than once; no-op when disabled. */
export function startPerfReporter(): void {
  if (!PERF_ENABLED || reporter) return;
  windowStartedAt = Date.now();
  reporter = setInterval(report, PERF_REPORT_MS);
  reporter.unref();
  console.log(`[perf] instrumentation ON (EDEXO_PERF=1) — reporting every ${PERF_REPORT_MS / 1000}s`);
}

export function stopPerfReporter(): void {
  if (!reporter) return;
  clearInterval(reporter);
  reporter = null;
}

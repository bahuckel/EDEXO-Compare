/**
 * How often the server re-reads the two files the game writes.
 *
 * Both used to be module constants — `STATUS_POLL_MS` inside the bootstrap's timer closure and
 * `POLL_MS` at the top of `journalWatcher.ts` — so changing either meant a rebuild. They are now
 * preferences, because the right value is a property of the commander's machine rather than of the
 * app: a slow disk or a busy CPU wants a longer journal poll, and a HUD user chasing a sample wants
 * a shorter status poll.
 *
 * The bounds are here, shared, rather than duplicated in the launcher's markup and the route's
 * validator, so the number an input offers is always a number the server will accept.
 */

/** `Status.json` — the live one: position, fuel, targeted body. Drives the HUDs. */
export const STATUS_POLL_DEFAULT_MS = 1000;
export const STATUS_POLL_MIN_MS = 100;
export const STATUS_POLL_MAX_MS = 10_000;

/**
 * The journal tail. Slower on purpose — the owner asked for it, and a `watchFile` on the newest log
 * wakes the tail early anyway, so this interval is the backstop that catches rotation and the
 * rolling history window, not the thing that delivers events.
 */
export const JOURNAL_POLL_DEFAULT_MS = 2000;
export const JOURNAL_POLL_MIN_MS = 250;
export const JOURNAL_POLL_MAX_MS = 60_000;

/**
 * Clamp and round; anything that is not a number falls back to the default.
 *
 * The coercion is deliberately narrow. `Number(null)`, `Number([])` and `Number("")` are all **0**,
 * which is finite, so a bare `Number(raw)` would turn a missing field into the *minimum* interval
 * rather than the default — the fastest poll the app allows, chosen by a value that meant "nothing".
 */
function clamp(raw: unknown, def: number, min: number, max: number): number {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && raw.trim() !== "") n = Number(raw);
  else return def;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function clampStatusPollMs(raw: unknown): number {
  return clamp(raw, STATUS_POLL_DEFAULT_MS, STATUS_POLL_MIN_MS, STATUS_POLL_MAX_MS);
}

export function clampJournalPollMs(raw: unknown): number {
  return clamp(raw, JOURNAL_POLL_DEFAULT_MS, JOURNAL_POLL_MIN_MS, JOURNAL_POLL_MAX_MS);
}

/** What `/api/status` carries so the launcher can render the two inputs without hard-coded bounds. */
export type PollRatesDTO = {
  statusPollMs: number;
  journalPollMs: number;
  statusMinMs: number;
  statusMaxMs: number;
  statusDefaultMs: number;
  journalMinMs: number;
  journalMaxMs: number;
  journalDefaultMs: number;
};

export function pollRatesDto(statusPollMs: number, journalPollMs: number): PollRatesDTO {
  return {
    statusPollMs,
    journalPollMs,
    statusMinMs: STATUS_POLL_MIN_MS,
    statusMaxMs: STATUS_POLL_MAX_MS,
    statusDefaultMs: STATUS_POLL_DEFAULT_MS,
    journalMinMs: JOURNAL_POLL_MIN_MS,
    journalMaxMs: JOURNAL_POLL_MAX_MS,
    journalDefaultMs: JOURNAL_POLL_DEFAULT_MS,
  };
}

/**
 * The streamer view shows the streamer's own app as the streamer has it (owner, 2026-10-04): compact
 * or cards, which panels are open, the units, the toggles. Those settings live in the app's browser
 * storage under `edexo.*`, which an OBS browser source does not share. So:
 *
 * - the app on the streamer's PC (not a phone, not the streamer view itself) reports its `edexo.*`
 *   settings to the server whenever they change, checked once a second;
 * - the streamer view puts them into its own storage before its first paint, and again whenever they
 *   change, and then draws the app afresh so every panel reads them.
 *
 * Only settings: what the viewers see still follows the game (the body, the scans) as before.
 */
const PREFIX = "edexo.";
/** Not a setting of the picture: diagnostics switches. */
const SKIP = new Set(["edexo.perf"]);
const MAX_VALUE = 20_000;

function snapshot(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(PREFIX) || SKIP.has(k)) continue;
      const v = localStorage.getItem(k);
      if (v != null && v.length <= MAX_VALUE) out[k] = v;
    }
  } catch {
    /* storage blocked: nothing to mirror */
  }
  return out;
}

const isLoopback = () => ["127.0.0.1", "localhost", "[::1]", "::1"].includes(window.location.hostname);

/** In the app on this PC: report the settings when they change. */
export function startUiMirrorSource(): void {
  if (!isLoopback()) return;
  let last = "";
  const tick = () => {
    const values = snapshot();
    const s = JSON.stringify(values);
    if (s === last) return;
    last = s;
    void fetch("/api/ui/mirror", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    }).catch(() => {
      last = ""; // try again next tick
    });
  };
  tick();
  window.setInterval(tick, 1000);
}

interface Mirror {
  rev: number;
  values: Record<string, string>;
}

function apply(m: Mirror): void {
  try {
    // The streamer view's own leftovers go: it shows the streamer's settings, not its own.
    for (const k of Object.keys(snapshot())) if (!(k in m.values)) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(m.values)) localStorage.setItem(k, v);
  } catch {
    /* storage blocked: the defaults show */
  }
}

/** In the streamer view: take the settings before the first paint. Returns the revision taken. */
export async function loadUiMirror(): Promise<number> {
  try {
    const r = await fetch("/api/ui/mirror", { cache: "no-store" });
    if (!r.ok) return -1;
    const m = (await r.json()) as Mirror;
    apply(m);
    return m.rev;
  } catch {
    return -1;
  }
}

/** In the streamer view: follow the settings; `onChange` redraws the app. */
export function watchUiMirror(fromRev: number, onChange: () => void): void {
  let rev = fromRev;
  window.setInterval(() => {
    fetch("/api/ui/mirror", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Mirror>) : null))
      .then((m) => {
        if (!m || m.rev === rev) return;
        rev = m.rev;
        apply(m);
        onChange();
      })
      .catch(() => {});
  }, 1000);
}

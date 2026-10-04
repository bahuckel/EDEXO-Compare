/**
 * The streamer view sees what the streamer sees (owner, 2026-10-04): compact or cards, the panels
 * open or folded, the units, the toggles. Those live in the app's own browser storage, which an OBS
 * browser source does not share; so the app on this PC reports its `edexo.*` settings here when they
 * change, and the streamer view takes them from here. Kept in memory only: the app reports them
 * again on its next start.
 */
export interface UiMirror {
  rev: number;
  values: Record<string, string>;
}

const MAX_KEYS = 400;
const MAX_VALUE = 20_000;

let mirror: UiMirror = { rev: 0, values: {} };

export function uiMirror(): UiMirror {
  return mirror;
}

/** Replace the mirrored settings; anything not an `edexo.` string pair, or too big, is left out. */
export function setUiMirror(values: unknown): UiMirror {
  const next: Record<string, string> = {};
  if (values && typeof values === "object") {
    let n = 0;
    for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
      if (n >= MAX_KEYS) break;
      if (!k.startsWith("edexo.") || typeof v !== "string" || v.length > MAX_VALUE) continue;
      next[k] = v;
      n++;
    }
  }
  if (JSON.stringify(next) !== JSON.stringify(mirror.values)) mirror = { rev: mirror.rev + 1, values: next };
  return mirror;
}

/** Test seam. */
export function resetUiMirrorForTests(): void {
  mirror = { rev: 0, values: {} };
}

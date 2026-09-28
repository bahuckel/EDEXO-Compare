/**
 * Where the commander is, read back from the newest journals at start. Split out of edexoBootstrap.ts (code review D, 2026-09-28).
 */
import { GameStateStore } from "./gameState.js";
import { readJournalFull } from "./journalWatcher.js";

/**
 * Recover the commander's galactic position when the merge cache did not carry one.
 *
 * `commanderPos` (§10.3) is read off `StarPos` on `FSDJump` / `Location`, and the merge cache stores
 * it — but every cache written before that field existed restores as `null`, and the fast path then
 * never replays a line that could fill it. The commander is left with no position until their next
 * jump, which silently disables **every** Phase 7 spatial gate: `demoteFailedSpatialGates` treats a
 * missing coordinate as "no verdict", so radialem, Bark Mounds, Brain Trees and Sinuous Tubers all
 * stay in the strict list no matter where the ship is.
 *
 * Rather than bump the cache format — which would force a full replay of every log for one field —
 * read the position back out of the newest logs. Newest first, stop at the first `StarPos` found,
 * and give up after a handful of files: a commander whose last twelve logs contain no jump and no
 * `Location` has no position to recover.
 */
export async function backfillCommanderPosition(store: GameStateStore, files: string[]): Promise<void> {
  if (store.commanderPos) return;
  const MAX_FILES = 12;
  for (let i = files.length - 1; i >= 0 && i >= files.length - MAX_FILES; i--) {
    // A holder rather than a plain `let`: TypeScript does not track assignments made inside a
    // callback, so a narrowed local would read as `null` after the loop and the branch below would
    // be dead code as far as the compiler is concerned.
    const hit: { pos: { x: number; y: number; z: number } | null } = { pos: null };
    try {
      // Keep the last hit in the file, not the first — the newest line wins.
      await readJournalFull(files[i]!, (line) => {
        const p = (line as Record<string, unknown>).StarPos;
        if (!Array.isArray(p) || p.length < 3) return;
        const [x, y, z] = p as unknown[];
        if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
        hit.pos = { x, y, z };
      });
    } catch {
      continue; // An unreadable log is not a reason to abandon the search.
    }
    if (hit.pos) {
      store.commanderPos = hit.pos;
      return;
    }
  }
}

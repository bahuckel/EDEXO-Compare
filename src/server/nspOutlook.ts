/**
 * The NSP card for one system (shared/nspOutlook.ts has the what and why): what the journals and
 * EDAstro know, else a guess from how many phenomena its neighbourhood has.
 *
 * Cost: the phenomena are ~97,000 systems, walked once per call (well under a millisecond); the
 * known systems around a point come from 25 ly cells counted once from the galaxy index (~1 s, on
 * first use). The answer is kept per system until the phenomena file or the journals change.
 */
import { nspBySystem, nspFamilyLabel, readNspStatus } from "./edastroNsp.js";
import { tileIndex } from "./galaxyTiles.js";
import { NSP_OUTLOOK_RADIUS_LY, NSP_THIN_KNOWN, nspChanceFor, type NspOutlookDTO } from "../shared/nspOutlook.js";

const CELL = 25;
const pack = (cx: number, cy: number, cz: number) => ((cx + 2048) * 512 + (cy + 256)) * 8192 + (cz + 4096);

let cellMemo: { index: unknown; counts: Map<number, number> } | null = null;
function indexCells(): Map<number, number> | null {
  const t = tileIndex();
  if (!t) return null;
  if (cellMemo?.index === t.index) return cellMemo.counts;
  const counts = new Map<number, number>();
  t.index.forEachPoint((_i, x, y, z) => {
    const k = pack(Math.floor(x / CELL), Math.floor(y / CELL), Math.floor(z / CELL));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  });
  cellMemo = { index: t.index, counts };
  return counts;
}

function knownWithin(p: { x: number; y: number; z: number }, r: number): number | null {
  const cells = indexCells();
  if (!cells) return null;
  const n = Math.ceil(r / CELL);
  const [cx, cy, cz] = [Math.floor(p.x / CELL), Math.floor(p.y / CELL), Math.floor(p.z / CELL)];
  let tot = 0;
  for (let a = -n; a <= n; a++)
    for (let b = -n; b <= n; b++)
      for (let c = -n; c <= n; c++) {
        // Whole cells whose nearest corner is inside the sphere; close enough for a rate.
        const dx = Math.max(0, Math.abs(a) - 1) * CELL;
        const dy = Math.max(0, Math.abs(b) - 1) * CELL;
        const dz = Math.max(0, Math.abs(c) - 1) * CELL;
        if (Math.hypot(dx, dy, dz) > r) continue;
        tot += cells.get(pack(cx + a, cy + b, cz + c)) ?? 0;
      }
  return tot;
}

const memo = new Map<string, NspOutlookDTO>();

export function nspOutlook(o: {
  systemAddress: number;
  position: { x: number; y: number; z: number } | null;
  seen: readonly string[];
  region: string | null;
}): NspOutlookDTO | null {
  const st = readNspStatus();
  if (!st.haveData) {
    // Without the EDAstro list there is nothing to add to what he saw himself.
    return o.seen.length
      ? { systemAddress: o.systemAddress, seen: [...o.seen], logged: [], loggedDetail: [], guess: null, nearest: [], region: o.region }
      : null;
  }
  const key = `${o.systemAddress}|${st.fetchedAtMs}|${o.seen.join(",")}`;
  const hit = memo.get(key);
  if (hit) return hit;

  const all = nspBySystem();
  const here = all.find((s) => s.systemAddress === o.systemAddress);
  let nearest: NspOutlookDTO["nearest"] = [];
  let guess: NspOutlookDTO["guess"] = null;
  if (o.position) {
    const p = o.position;
    const R = NSP_OUTLOOK_RADIUS_LY;
    let within = 0;
    const byName = new Map<string, { name: string; system: string; distanceLy: number }>();
    for (const s of all) {
      if (s === here) continue;
      const d = Math.hypot(s.x - p.x, s.y - p.y, s.z - p.z);
      if (d <= R) within++;
      if (d > 1500) continue;
      // One entry per family: four colours of metallic crystals in one system are one kind.
      for (const id of s.ids) {
        const name = nspFamilyLabel(id);
        const cur = byName.get(name);
        if (!cur || d < cur.distanceLy) byName.set(name, { name, system: s.system, distanceLy: Math.round(d) });
      }
    }
    nearest = [...byName.values()].sort((a, b) => a.distanceLy - b.distanceLy).slice(0, 4);
    const known = knownWithin(p, R);
    if (known != null) {
      const rate = within / Math.max(1, known);
      guess = { chance: nspChanceFor(rate), nspSystems: within, knownSystems: known, radiusLy: R, thin: known < NSP_THIN_KNOWN };
    }
  }
  const dto: NspOutlookDTO = {
    systemAddress: o.systemAddress,
    seen: [...o.seen],
    logged: here ? [...new Set(here.ids.map(nspFamilyLabel))] : [],
    loggedDetail: here ? [...here.names] : [],
    guess,
    nearest,
    region: o.region,
  };
  if (memo.size > 200) memo.clear();
  memo.set(key, dto);
  return dto;
}

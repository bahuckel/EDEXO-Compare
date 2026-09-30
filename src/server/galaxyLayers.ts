/**
 * Extra layers for the 3D galaxy map (guild tester report, 2026-09-30: "galaxy map showing not only
 * bios but also points of interest, NSPs, carriers"; D10). Each comes from a list the commander
 * already has on this PC — nothing here fetches anything — and is sent only when its layer is
 * switched on. Tritium sources are not a layer: nothing the app has says where tritium is.
 *
 * Compact on the wire: the phenomena are about 97,000 systems.
 */
import { poiRecords, readPoiStatus } from "./edastroPoi.js";
import { carrierRecords, readCarrierStatus } from "./edastroCarriers.js";
import { nspBySystem, readNspStatus } from "./edastroNsp.js";
import type { BookmarksService } from "./bookmarks.js";
import type { GalaxyLayerDTO, GalaxyLayerKind } from "../shared/galaxyLayers.js";

export type { GalaxyLayerDTO, GalaxyLayerKind } from "../shared/galaxyLayers.js";

const round = (v: number) => Math.round(v * 10) / 10;

/** Builds the point list with its detail lines kept once each. */
function builder() {
  const details: string[] = [];
  const index = new Map<string, number>();
  const points: GalaxyLayerDTO["points"] = [];
  return {
    add(x: number, y: number, z: number, label: string, detail: string, system: string) {
      let i = index.get(detail);
      if (i === undefined) {
        i = details.length;
        details.push(detail);
        index.set(detail, i);
      }
      points.push([round(x), round(y), round(z), label, i, system === label ? "" : system]);
    },
    done: (kind: GalaxyLayerKind, available = true): GalaxyLayerDTO => ({ kind, available, points, details }),
  };
}

export function galaxyLayer(
  kind: GalaxyLayerKind,
  bookmarks: BookmarksService | undefined,
  nowMs = Date.now(),
): GalaxyLayerDTO {
  const out = builder();
  if (kind === "poi") {
    if (!readPoiStatus(nowMs).haveData) return out.done(kind, false);
    for (const r of poiRecords())
      out.add(r.x, r.y, r.z, r.name, [r.typeLabel, r.system].filter(Boolean).join(" · "), r.system);
    return out.done(kind);
  }
  if (kind === "nsp") {
    if (!readNspStatus(nowMs).haveData) return out.done(kind, false);
    for (const s of nspBySystem()) out.add(s.x, s.y, s.z, s.system, s.names.join(", "), s.system);
    return out.done(kind);
  }
  if (kind === "carriers") {
    if (!readCarrierStatus(nowMs).haveData) return out.done(kind, false);
    const day = 86_400_000;
    for (const c of carrierRecords()) {
      const seen = c.lastUpdatedMs != null ? Math.max(0, Math.floor((nowMs - c.lastUpdatedMs) / day)) : null;
      out.add(
        c.x,
        c.y,
        c.z,
        c.name ? `${c.name} (${c.callsign})` : c.callsign,
        [c.system, seen != null ? `seen ${seen === 0 ? "today" : `${seen} d ago`}` : ""]
          .filter(Boolean)
          .join(" · "),
        c.system,
      );
    }
    return out.done(kind);
  }
  const items = (bookmarks?.all() ?? []).filter((b) => b.pos);
  for (const b of items) {
    out.add(
      b.pos!.x,
      b.pos!.y,
      b.pos!.z,
      b.body ? `${b.system} ${b.body}` : b.system,
      [b.tags.join(", "), b.note].filter(Boolean).join(" — "),
      b.system,
    );
  }
  return out.done(kind, items.length > 0);
}

/**
 * The 3D galaxy map's extra layers (server/galaxyLayers.ts builds them; D10, guild tester report
 * 2026-09-30). Each is a list the commander already has on this PC.
 */
export type GalaxyLayerKind = "poi" | "nsp" | "carriers" | "bookmarks";

/**
 * [x, y, z, label, detail, system]: label is the name; detail indexes {@link GalaxyLayerDTO.details},
 * one line for the hover card (the phenomena repeat the same few hundred lines across 97,000
 * systems); system is "" when it is the label.
 */
export type GalaxyLayerPoint = [number, number, number, string, number, string];

export interface GalaxyLayerDTO {
  kind: GalaxyLayerKind;
  /** False when the list has not been downloaded (or there are no bookmarks yet). */
  available: boolean;
  points: GalaxyLayerPoint[];
  details: string[];
}

/** A point's detail line and system name, expanded. */
export function layerPointText(d: GalaxyLayerDTO, p: GalaxyLayerPoint): { detail: string; system: string } {
  return { detail: d.details[p[4]] ?? "", system: p[5] || p[3] };
}

export const GALAXY_LAYERS: readonly {
  kind: GalaxyLayerKind;
  label: string;
  /** Where the data comes from, for a layer that has none yet. */
  needs: string;
  colour: [number, number, number];
  size: number;
}[] = [
  { kind: "poi", label: "Points of interest", needs: "Download them in Points of interest", colour: [0.3, 0.85, 1], size: 6 },
  { kind: "nsp", label: "Phenomena (NSP)", needs: "Download them in Options → Notify me", colour: [0.75, 0.42, 0.85], size: 3 },
  { kind: "carriers", label: "Carriers", needs: "Download them in Carriers", colour: [1, 0.85, 0.3], size: 5 },
  { kind: "bookmarks", label: "Bookmarks", needs: "Bookmark a system with the ☆ beside its name", colour: [0.96, 0.72, 0.24], size: 9 },
];

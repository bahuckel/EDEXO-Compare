/**
 * Fleet carrier services — the keys EDAstro publishes, and what to call them on screen.
 *
 * EDAstro's `fleetcarriers.csv` carries a `Services` column of semicolon-separated keys taken from
 * the game's own `CarrierStats` event. They are not the names the commander sees in the game.
 *
 * **The trap, and it is the whole reason this file exists.** The service a commander knows as
 * *Universal Cartographics* — where exploration data is sold — is spelled **`exploration`**. There
 * is no `universalcartographics` key: counted across all 90,244 carriers with coordinates in the
 * 2026-09-19 file, it appears **zero** times, while `exploration` appears 23,498 times (26.0 %).
 * Filtering on the obvious spelling returns an empty list, which reads as a broken filter rather
 * than a wrong one.
 *
 * Shares from that same file, for the handful worth offering as filters:
 *
 * ```
 * refuel 55.8%   repair 55.7%   rearm 53.0%   exploration 26.0%   shipyard 24.6%
 * bartender 23.3%   vistagenomics 21.7%   outfitting 19.1%
 * ```
 *
 * `vistagenomics` is the one this app exists for: it is where exobiology samples are sold, and a
 * commander with a full sample bag 20,000 ly from the bubble has no other option.
 */

/** A service filter the panel offers, in the order it offers them. */
export interface CarrierServiceOption {
  /** The key as EDAstro spells it in the `Services` column. */
  readonly key: string;
  /** What the commander calls it in the game. */
  readonly label: string;
  /** Why it matters, for the filter's tooltip. */
  readonly hint: string;
}

/**
 * Offered filters, most useful to an explorer first.
 *
 * Deliberately not every key in the file. Thirty-odd exist and half of them sit under 0.1 % — a
 * filter that matches one carrier in the galaxy is noise, and `dock` at 68 % says nothing at all.
 */
export const CARRIER_SERVICE_OPTIONS: readonly CarrierServiceOption[] = [
  {
    key: "vistagenomics",
    label: "Vista Genomics",
    hint: "Sells exobiology samples. The reason this panel exists.",
  },
  {
    key: "exploration",
    label: "Universal Cartographics",
    hint: "Sells exploration data. EDAstro spells this service 'exploration'.",
  },
  { key: "refuel", label: "Refuel", hint: "Tritium for you, not for the carrier." },
  { key: "repair", label: "Repair", hint: "Hull and module repair." },
  { key: "rearm", label: "Restock", hint: "Ammunition and limpets." },
  { key: "outfitting", label: "Outfitting", hint: "Module swaps." },
  { key: "shipyard", label: "Shipyard", hint: "Ship storage and transfer." },
  { key: "bartender", label: "Bartender", hint: "Odyssey consumables and goods." },
] as const;

/** Split the `Services` cell into keys. Tolerates an empty cell, which is a real value. */
export function parseCarrierServices(cell: string | null | undefined): string[] {
  if (!cell) return [];
  return cell
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Does this carrier offer every one of the wanted services?
 *
 * AND rather than OR: a commander asking for Vista Genomics *and* Refuel wants one stop, not a
 * choice of two. With nothing selected every carrier passes.
 */
export function carrierHasServices(services: readonly string[], wanted: readonly string[]): boolean {
  if (wanted.length === 0) return true;
  const have = new Set(services);
  return wanted.every((w) => have.has(w));
}

/** The commander-facing name, falling back to the raw key for anything not offered as a filter. */
export function carrierServiceLabel(key: string): string {
  return CARRIER_SERVICE_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

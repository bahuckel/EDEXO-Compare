/**
 * "My discoveries": every system, body and star in the merged journals, for searching and filtering.
 *
 * Built on request rather than carried on the snapshot — see `src/server/discoveries.ts` for why,
 * and for the difference between an estimated value and a sold one, which this DTO keeps apart on
 * purpose.
 */
import type { GreenGiantMark, GreenGiantVerdict } from "../greenGasGiant.js";

export interface DiscoveriesDTO {
  generatedAt: string;
  systems: DiscoverySystemRow[];
  bodies: DiscoveryBodyRow[];
  stars: DiscoveryStarRow[];
}

export interface DiscoverySystemRow {
  systemAddress: number;
  name: string;
  /** klightspeed codex region, when the system's position is known. */
  region: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  stars: number;
  bodies: number;
  landables: number;
  terraformables: number;
  earthLikes: number;
  waterWorlds: number;
  ammoniaWorlds: number;
  /** Bodies carrying at least one biological signal, and the total across them. */
  bioBodies: number;
  bioSignals: number;
  /** Species confirmed on foot here. */
  speciesConfirmed: number;
  firstDiscoveries: number;
  /**
   * Whether **this system** is the commander's discovery, which is a different question from
   * {@link firstDiscoveries}.
   *
   * The game decides it on the main star — `BodyID 0`'s `WasDiscovered` — and that is what puts his
   * name on the system and pays the bonus. Being first to scan body 7 of somebody else's system
   * makes that *body* his and the system still theirs, so a filter built on the body count listed
   * systems he knew perfectly well he had not found.
   *
   * `null` when the main star was never scanned with the flag present: unknown is not "yes".
   */
  firstDiscoveredSystem: boolean | null;
  firstFootfalls: number;
  dssMapped: number;
  /** Type of body 0, which is what a commander means by "the star". */
  primaryStarType: string | null;
  /** What the app thinks the system is worth, from the same model the map prices with. */
  estimatedCredits: number;
  /**
   * What selling actually paid, or null when he has not sold it.
   *
   * Never merged with {@link estimatedCredits}: one is a measurement and the other is a guess, and a
   * column that silently switches between them is a column nobody can reason about.
   */
  soldExplorationCredits: number | null;
  soldExobiologyCredits: number | null;
  /** Journal `FSSAllBodiesFound` — the honk finished, so the body list is complete. */
  fullyScanned: boolean;
  firstVisit: string | null;
  lastVisit: string | null;
}

export interface DiscoveryBodyRow {
  key: string;
  /** A green gas giant verdict (shared/greenGasGiant.ts), or null. */
  greenGiant?: GreenGiantVerdict | null;
  /** The commander's own green gas giant call (null: none); absent for classes that cannot be green. */
  greenMark?: GreenGiantMark | null;
  /** Body features it has (shared/bodyFeatures.ts labels), for search. */
  features?: string[];
  systemAddress: number;
  system: string;
  region: string | null;
  bodyName: string;
  planetClass: string;
  atmosphere: string | null;
  volcanism: string | null;
  terraformState: string | null;
  /** Tri-state: the journal's own flag, and null when it never said. */
  landable: boolean | null;
  gravityG: number | null;
  surfaceTemperatureK: number | null;
  surfacePressurePa: number | null;
  /**
   * Earth radii, not kilometres.
   *
   * The game shows a body against Earth and a star against the Sun, and the commander's own reason
   * is the better one: kilometres are subject to the km/miles setting, so a table in kilometres is a
   * table he has to convert in his head depending on how the game is configured. It also pairs with
   * {@link massEM} — radius and mass read in the same frame.
   */
  radiusEarth: number | null;
  massEM: number | null;
  distanceLs: number | null;
  bioSignals: number | null;
  speciesConfirmed: string[];
  dssMapped: boolean;
  firstDiscoverer: boolean;
  /**
   * Whether the **system** this sits in is the commander's discovery, from its arrival star.
   *
   * Separate from {@link firstDiscoverer}, which is about this body alone. Both are true facts and
   * they answer different questions: being first to scan a body in somebody else's system makes the
   * body his and the system theirs. Filtering on the body's own flag listed 25 Earth-likes as first
   * discoveries where the Systems tab, asking the same question of the system, found 6.
   *
   * `null` when the arrival star was never scanned with the flag present.
   */
  firstDiscoveredSystem: boolean | null;
  firstFootfall: boolean;
  estimatedCredits: number;
  scannedAt: string | null;
}

export interface DiscoveryStarRow {
  key: string;
  systemAddress: number;
  system: string;
  region: string | null;
  bodyName: string;
  starType: string;
  subclass: number | null;
  luminosity: string | null;
  solarMasses: number | null;
  /** Solar radii, which is how the game itself shows a star. See `DiscoveryBodyRow.radiusEarth`. */
  radiusSolar: number | null;
  surfaceTemperatureK: number | null;
  distanceLs: number | null;
  firstDiscoverer: boolean;
  /**
   * Whether the **system** this sits in is the commander's discovery, from its arrival star.
   *
   * Separate from {@link firstDiscoverer}, which is about this body alone. Both are true facts and
   * they answer different questions: being first to scan a body in somebody else's system makes the
   * body his and the system theirs. Filtering on the body's own flag listed 25 Earth-likes as first
   * discoveries where the Systems tab, asking the same question of the system, found 6.
   *
   * `null` when the arrival star was never scanned with the flag present.
   */
  firstDiscoveredSystem: boolean | null;
  estimatedCredits: number;
  scannedAt: string | null;
}

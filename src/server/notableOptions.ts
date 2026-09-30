/**
 * What the Notable card and the body details add beyond the classic types (owner, 2026-09-30): green
 * gas giants, whose verdict needs the commander's own calls and EDAstro's K10 systems, and the body
 * features he switched on. The server sets the provider once it has those (edexoBootstrap.ts); until
 * then, green gas giants from the journals alone and no features.
 */
import type { BodyFeatureKey } from "../shared/bodyFeatures.js";
import type { GreenGiantSources } from "./greenGiants.js";

export interface NotableOptions {
  green: Omit<GreenGiantSources, "greenCodexBodies" | "k10Systems"> | null;
  features: ReadonlySet<BodyFeatureKey>;
}

let provider: () => NotableOptions = () => ({ green: { marks: { get: () => null } }, features: new Set() });

export function setNotableOptionsProvider(fn: () => NotableOptions): void {
  provider = fn;
}

export function notableOptions(): NotableOptions {
  return provider();
}

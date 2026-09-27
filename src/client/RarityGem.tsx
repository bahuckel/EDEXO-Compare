/**
 * A species' rarity as a small glowing DNA helix (owner, 2026-09-27; first a gem, then "the gems are
 * not really exobio"): gray Common, green Uncommon, blue Rare, purple Epic, gold Legendary. The tier
 * comes from EDSM's codex plus whatever has been added since (`speciesRarityData.ts`), all colours of
 * the species together. Before the name in the compact rows; in the full card it sits where the
 * "analysed" tick was.
 *
 * The strokes are SVG attributes, so the snapshot camera keeps them.
 */
import { rarityTierInfo, type RegionalRarity, type SpeciesRarity } from "@shared/speciesRarity";

const pct = (s: number) => `${(s * 100).toFixed(s < 0.01 ? 2 : 1)} %`;

export function rarityTitle(r: SpeciesRarity): string {
  const t = rarityTierInfo(r.tier);
  const onBodies =
    typeof r.share === "number"
      ? `on ${pct(r.share)} of the bio bodies of its planet types`
      : "by system count";
  return `${t.label} galaxy-wide — ${onBodies}; logged in ${r.systems.toLocaleString()} systems (all colours).`;
}

/** Two strands of a helix, one and a half turns, and the rungs between them — built once. */
const HELIX = (() => {
  const top = 0.8;
  const bottom = 15.2;
  const amp = 3.4;
  const cx = 5;
  const turns = 1;
  const steps = 40;
  const a: string[] = [];
  const b: string[] = [];
  const rungs: [number, number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const y = top + (bottom - top) * f;
    const s = Math.sin(f * turns * 2 * Math.PI);
    a.push(`${i ? "L" : "M"}${(cx + amp * s).toFixed(2)} ${y.toFixed(2)}`);
    b.push(`${i ? "L" : "M"}${(cx - amp * s).toFixed(2)} ${y.toFixed(2)}`);
    // A rung wherever the strands are well apart.
    if (i % 4 === 2 && Math.abs(s) > 0.3) rungs.push([cx - amp * s, cx + amp * s, y]);
  }
  return { a: a.join(" "), b: b.join(" "), rungs };
})();

/** Where the body is: its tier in that region, else "not found here" (left out of that region's quests). */
function regionalTitle(g: SpeciesRarity, r: RegionalRarity): string {
  const galaxy = `${rarityTierInfo(g.tier).label} galaxy-wide${typeof g.share === "number" ? ` (${pct(g.share)})` : ""}.`;
  if (!r.found) {
    return (
      `Not found in ${r.region}${r.count ? ` (only ${r.count} system${r.count === 1 ? "" : "s"})` : ""} — ` +
      `left out of that region's quests. ${galaxy}`
    );
  }
  if (!r.tier)
    return `Found in ${r.region} (${r.count.toLocaleString()} systems); no body data there. ${galaxy}`;
  const here =
    typeof r.share === "number" && typeof r.of === "number"
      ? `on ${pct(r.share)} of the ${r.of.toLocaleString()} bio bodies of its planet types there`
      : `logged in ${r.count.toLocaleString()} systems there`;
  return `${rarityTierInfo(r.tier).label} in ${r.region} — ${here}. ${galaxy}`;
}

export function RarityGem({
  rarity,
  regional,
  className,
}: {
  rarity: SpeciesRarity | undefined;
  /** The body's region: the badge shows this tier when given (a species can be common here, rare there). */
  regional?: RegionalRarity;
  className?: string;
}) {
  if (!rarity) return null;
  const notHere = regional != null && !regional.found;
  const tier = regional?.found && regional.tier ? regional.tier : rarity.tier;
  const t = rarityTierInfo(tier);
  return (
    <svg
      className={`rarity-dna rarity-dna--${tier}${notHere ? " rarity-dna--absent" : ""}${className ? ` ${className}` : ""}`}
      viewBox="0 0 10 16"
      style={{ ["--rarity" as string]: t.colour }}
      role="img"
      aria-label={
        notHere
          ? `Not found in ${regional!.region}`
          : `${t.label} species${regional ? ` in ${regional.region}` : ""}`
      }
    >
      <title>{regional ? regionalTitle(rarity, regional) : rarityTitle(rarity)}</title>
      <g transform="rotate(22 5 8)" fill="none" strokeLinecap="round">
        {HELIX.rungs.map(([x1, x2, y], i) => (
          <line
            key={i}
            x1={x1}
            y1={y}
            x2={x2}
            y2={y}
            stroke={t.colour}
            strokeWidth={0.75}
            strokeOpacity={0.9}
          />
        ))}
        <path d={HELIX.a} stroke={t.colour} strokeWidth={1.15} />
        <path d={HELIX.b} stroke={t.colour} strokeWidth={1.15} strokeOpacity={0.8} />
      </g>
    </svg>
  );
}

/**
 * The galaxy map's Filter drawer (owner, 2026-10-04, overnight Q14): "If you know what online stores do
 * with the different tabs for the different type of thing, but instead of 'Gaming Mice, Keyboards,
 * Monitors' we have 'Star Type, Planet Type' and a whole different tab on the top to switch between
 * exobio and bodies. Exobio should be grouped per genera. Also add a search bar for those filters."
 *
 * Ticks apply as they are made; the map lights the systems that have them and dims the rest (or hides
 * them). Inside one group any tick will do, across groups every group with a tick must hold — a shop's
 * facets. The answer comes from the server as bits over the map's own ordinals (galaxyTraits.ts).
 */
import { useEffect, useMemo, useState } from "react";
import type { GalaxySpeciesCatalogueDTO } from "@shared/types";
import { MenuToggle } from "./galaxy3d/G3dMenu";

export interface GalaxyFilterState {
  tab: "exobio" | "bodies";
  genera: string[];
  species: string[];
  mainStars: string[];
  stars: string[];
  planets: string[];
  features: string[];
  /** Hide what does not match instead of dimming it. */
  hide: boolean;
}

export const EMPTY_GALAXY_FILTER: GalaxyFilterState = {
  tab: "exobio",
  genera: [],
  species: [],
  mainStars: [],
  stars: [],
  planets: [],
  features: [],
  hide: false,
};

const FACETS = ["genera", "species", "mainStars", "stars", "planets", "features"] as const;
type Facet = (typeof FACETS)[number];

/** How many ticks the filter holds; 0 = off. */
export function galaxyFilterTicks(f: GalaxyFilterState): number {
  return FACETS.reduce((n, k) => n + f[k].length, 0);
}

/** The query string for /api/galaxy/filter. */
export function galaxyFilterQuery(f: GalaxyFilterState): string {
  return FACETS.filter((k) => f[k].length)
    .map((k) => `${k}=${encodeURIComponent(f[k].join(","))}`)
    .join("&");
}

export function isGalaxyFilterState(v: unknown): v is GalaxyFilterState {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const strs = (x: unknown) => Array.isArray(x) && x.length <= 200 && x.every((s) => typeof s === "string");
  return (o.tab === "exobio" || o.tab === "bodies") && typeof o.hide === "boolean" && FACETS.every((k) => strs(o[k]));
}

interface TraitRow {
  key: string;
  label: string;
  count: number;
}
interface TraitsDTO {
  available: boolean;
  mainStars: TraitRow[];
  stars: TraitRow[];
  planets: TraitRow[];
  features: TraitRow[];
}

/**
 * One tick as a menu row (owner, 2026-10-04: the Filter insides like the game's menus): the name, how
 * many systems have it, and a box that fills when it is ticked. The checkbox stays for keyboards and
 * screen readers; a genus row has a ▸ that opens its species.
 */
function TickRow({
  label,
  ariaLabel,
  count,
  on,
  onToggle,
  disabled,
  sub,
  expand,
}: {
  label: string;
  ariaLabel?: string;
  count: string;
  on: boolean;
  onToggle: () => void;
  disabled?: boolean;
  sub?: boolean;
  expand?: { open: boolean; label: string; onClick: () => void };
}) {
  return (
    <label className={`g3d-row g3d-row--check g3d-row--tick${sub ? " g3d-row--sub" : ""}${disabled ? " g3d-row--disabled" : ""}`}>
      <input type="checkbox" className="g3d-row__box" aria-label={ariaLabel} checked={on} disabled={disabled} onChange={onToggle} />
      {expand ? (
        <button
          type="button"
          className="g3d-row__expand"
          aria-expanded={expand.open}
          aria-label={expand.label}
          onClick={(ev) => {
            ev.preventDefault();
            expand.onClick();
          }}
        >
          {expand.open ? "▾" : "▸"}
        </button>
      ) : null}
      <span className="g3d-row__label">{label}</span>
      <span className="g3d-row__count">{count}</span>
      <span className={on ? "g3d-tick g3d-tick--on" : "g3d-tick"} aria-hidden="true">
        {on ? "✓" : ""}
      </span>
    </label>
  );
}

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e4 ? `${Math.round(n / 1e3)} k` : n.toLocaleString());

export function GalaxyFilterPanel({
  value,
  onChange,
  matched,
  busy,
}: {
  value: GalaxyFilterState;
  onChange: (next: GalaxyFilterState) => void;
  /** Systems that pass, once the server has answered; null while off or asking. */
  matched: number | null;
  busy: boolean;
}) {
  const [catalogue, setCatalogue] = useState<GalaxySpeciesCatalogueDTO | null>(null);
  const [traits, setTraits] = useState<TraitsDTO | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    void fetch("/api/galaxy/species")
      .then((r) => (r.ok ? (r.json() as Promise<GalaxySpeciesCatalogueDTO>) : null))
      .then((c) => live && setCatalogue(c))
      .catch(() => live && setCatalogue(null));
    void fetch("/api/galaxy/traits")
      .then((r) => (r.ok ? (r.json() as Promise<TraitsDTO>) : null))
      .then((t) => live && setTraits(t))
      .catch(() => live && setTraits(null));
    return () => {
      live = false;
    };
  }, []);

  const q = query.trim().toLowerCase();
  const hit = (s: string) => !q || s.toLowerCase().includes(q);

  /** The genera, each with its species, cut down to what the search box names. */
  const genera = useMemo(() => {
    const by = new Map<string, { dir: string; name: string; species: GalaxySpeciesCatalogueDTO["species"] }>();
    for (const s of catalogue?.species ?? []) {
      const g = by.get(s.genusDir) ?? { dir: s.genusDir, name: s.genusName, species: [] };
      g.species.push(s);
      by.set(s.genusDir, g);
    }
    return [...by.values()]
      .map((g) => ({ ...g, species: [...g.species].sort((a, b) => a.displayName.localeCompare(b.displayName)) }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((g) => (hit(g.name) ? g : { ...g, species: g.species.filter((s) => hit(s.displayName)) }))
      .filter((g) => hit(g.name) || g.species.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue, q]);

  const toggle = (facet: Facet, key: string) => {
    const has = value[facet].includes(key);
    onChange({ ...value, [facet]: has ? value[facet].filter((k) => k !== key) : [...value[facet], key] });
  };
  const ticks = galaxyFilterTicks(value);

  /** A tick's name for its chip, wherever it was ticked: "Stratum (all)", "Neutron star (main)". */
  const chipLabel = (facet: Facet, key: string): string => {
    const sp = catalogue?.species ?? [];
    const row = (rows: TraitRow[] | undefined) => rows?.find((r) => r.key === key)?.label ?? key;
    switch (facet) {
      case "genera":
        return `${sp.find((s) => s.genusDir === key)?.genusName ?? key} (all)`;
      case "species":
        return sp.find((s) => s.speciesId === key)?.displayName ?? key;
      case "mainStars":
        return `${row(traits?.mainStars)} (main)`;
      case "stars":
        return row(traits?.stars);
      case "planets":
        return row(traits?.planets);
      case "features":
        return row(traits?.features);
    }
  };

  const traitGroup = (title: string, facet: Facet, rows: TraitRow[]) => {
    const shown = rows.filter((r) => r.count > 0 && hit(r.label));
    if (!shown.length) return null;
    return (
      <fieldset className="g3d-filter__group" key={facet}>
        <legend className="g3d-menu__sub">{title}</legend>
        {shown.map((r) => (
          <TickRow key={r.key} label={r.label} count={fmt(r.count)} on={value[facet].includes(r.key)} onToggle={() => toggle(facet, r.key)} />
        ))}
      </fieldset>
    );
  };

  return (
    <div className="g3d-filter">
      <div className="g3d-row g3d-row--buttons g3d-filter__tabs" role="tablist" aria-label="Filter by">
        {(
          [
            ["exobio", "Exobio"],
            ["bodies", "Stars & bodies"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={value.tab === k}
            className={value.tab === k ? "g3d-btn g3d-btn--on" : "g3d-btn"}
            onClick={() => onChange({ ...value, tab: k })}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="g3d-row g3d-row--input">
        <input
          className="g3d-row__input g3d-filter__search"
          type="search"
          placeholder={value.tab === "exobio" ? "Search, e.g. stratum or tecton" : "Search, e.g. neutron or earth"}
          aria-label="Search the filters"
          value={query}
          onChange={(ev) => setQuery(ev.target.value)}
        />
      </div>
      <div className="g3d-filter__summary">
        {ticks ? (
          <>
            <div className="g3d-row">
              <span className="g3d-row__label g3d-filter__matched">
                {busy ? "Finding…" : matched != null ? `${matched.toLocaleString()} systems match` : ""}
              </span>
              <button
                type="button"
                className="g3d-row__val g3d-row__button"
                onClick={() => onChange({ ...EMPTY_GALAXY_FILTER, tab: value.tab, hide: value.hide })}
              >
                Clear ({ticks})
              </button>
            </div>
            <MenuToggle
              label="Hide the rest"
              hint="Hide the systems that do not match instead of dimming them"
              on={value.hide}
              set={(hide) => onChange({ ...value, hide })}
            />
          </>
        ) : (
          <p className="g3d-panel__note">Tick anything below: the systems that have it light up, the rest dim.</p>
        )}
      </div>
      {ticks ? (
        <div className="g3d-filter__chips" aria-label="What is ticked">
          {FACETS.flatMap((facet) =>
            value[facet].map((key) => (
              <button
                key={`${facet}:${key}`}
                type="button"
                className="g3d-filter__chip"
                title="Remove"
                onClick={() => toggle(facet, key)}
              >
                {chipLabel(facet, key)} ×
              </button>
            )),
          )}
        </div>
      ) : null}
      <div className="g3d-filter__list">
        {value.tab === "exobio" ? (
          catalogue?.available === false ? (
            <p className="g3d-panel__note">No galaxy index in this build.</p>
          ) : !catalogue ? (
            <p className="g3d-panel__note">Loading the genera…</p>
          ) : (
            genera.map((g) => {
              const expanded = open.has(g.dir) || q.length > 0;
              return (
                <div key={g.dir} className="g3d-filter__genus">
                  <TickRow
                    label={g.name}
                    ariaLabel={`${g.name}, every species`}
                    count={`${g.species.length} species`}
                    on={value.genera.includes(g.dir)}
                    onToggle={() => toggle("genera", g.dir)}
                    expand={{
                      open: expanded,
                      label: `${expanded ? "Hide" : "Show"} the ${g.name} species`,
                      onClick: () =>
                        setOpen((cur) => {
                          const next = new Set(cur);
                          if (next.has(g.dir)) next.delete(g.dir);
                          else next.add(g.dir);
                          return next;
                        }),
                    }}
                  />
                  {expanded
                    ? g.species.map((s) => (
                        <TickRow
                          key={s.speciesId}
                          sub
                          label={s.displayName}
                          count={fmt(s.systemCount)}
                          on={value.species.includes(s.speciesId) || value.genera.includes(g.dir)}
                          disabled={value.genera.includes(g.dir)}
                          onToggle={() => toggle("species", s.speciesId)}
                        />
                      ))
                    : null}
                </div>
              );
            })
          )
        ) : traits && !traits.available ? (
          <p className="g3d-panel__note">The star and body list is not in this build.</p>
        ) : !traits ? (
          <p className="g3d-panel__note">Loading the stars and bodies…</p>
        ) : (
          <>
            {traitGroup("Main star", "mainStars", traits?.mainStars ?? [])}
            {traitGroup("Any star in the system", "stars", traits?.stars ?? [])}
            {/* Every star is in the data; planets only where they matter for biology (galaxyTraits.ts). */}
            {traitGroup("Planet type (worlds with biology)", "planets", traits?.planets ?? [])}
            {traitGroup("Features (worlds with biology)", "features", traits?.features ?? [])}
          </>
        )}
      </div>
      <p className="g3d-panel__note">
        Any tick inside a group; every group that has one. Systems in the galaxy index: the ones somebody
        found biology in.
      </p>
    </div>
  );
}

/**
 * Everything the commander has scanned, searchable — systems, bodies and stars.
 *
 * "My exobiology" showed the 373 species he had confirmed on foot, which is the certain end of a far
 * larger record: 3,406 systems, 18,127 bodies and 5,196 stars sit in the merged journals with their
 * physics already resolved, and none of it was reachable from the app. These are those three tables.
 *
 * ## One table shape, three column sets
 *
 * The three tabs differ only in their columns and their filters, so they share a renderer rather
 * than repeating a table three times. A column declares how to read a row, how to show it, and how
 * to sort it — the alternative, a `switch` per cell, is how the two species lists came to disagree
 * about photographs.
 *
 * ## Sorted, filtered and windowed
 *
 * 18,127 rows will not go in the DOM. The list is cut to {@link PAGE} after filtering and sorting,
 * with a count of what was left out, because a commander searching for a body wants the match and
 * not the scrollbar. Sorting happens before the cut, so "most valuable" means most valuable of
 * everything rather than of the first few hundred.
 */
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { DiscoveriesDTO, DiscoveryBodyRow, DiscoveryStarRow, DiscoverySystemRow } from "@shared/types";
import { fuzzyRankAny } from "./fuzzyMatch";

/** Rows rendered at once. Enough to scroll through, far short of what would stall the panel. */
const PAGE = 300;

type Row = DiscoverySystemRow | DiscoveryBodyRow | DiscoveryStarRow;

interface Column<T> {
  key: string;
  label: string;
  /** Right-aligned, tabular figures — every numeric column. */
  numeric?: boolean;
  /** Sort key. Null sorts last whichever way the column is pointing. */
  value: (r: T) => number | string | null;
  render: (r: T) => React.ReactNode;
  title?: string;
}

const cr = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(n).toLocaleString()} CR`;
const num = (n: number | null | undefined, digits = 0) =>
  n == null || !Number.isFinite(n) ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: digits });
const date = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

/** `—` for a zero count, so a dense table reads as data rather than as a field of noughts. */
const count = (n: number) => (n > 0 ? n.toLocaleString() : "—");

function SortHeader<T>({
  col,
  sort,
  onSort,
}: {
  col: Column<T>;
  sort: { key: string; dir: 1 | -1 };
  onSort: (key: string) => void;
}) {
  const active = sort.key === col.key;
  return (
    <th
      scope="col"
      className={`disc-th${col.numeric ? " disc-th--num" : ""}${active ? " disc-th--active" : ""}`}
      title={col.title}
    >
      <button type="button" className="disc-sort" onClick={() => onSort(col.key)}>
        {col.label}
        <span className="disc-sort-caret">{active ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

function Table<T extends Row>({
  rows,
  columns,
  sort,
  onSort,
  rowKey,
  empty,
}: {
  rows: T[];
  columns: Column<T>[];
  sort: { key: string; dir: 1 | -1 };
  onSort: (key: string) => void;
  rowKey: (r: T) => string;
  empty: string;
}) {
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort.key) ?? columns[0]!;
    const out = [...rows];
    out.sort((a, b) => {
      const av = col.value(a);
      const bv = col.value(b);
      // Null is "not measured", never "zero" — it sorts to the bottom either way, so pointing a
      // column the other way does not fill the top of the screen with blanks.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const d = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
      return d * sort.dir;
    });
    return out;
  }, [rows, columns, sort]);

  const shown = sorted.slice(0, PAGE);
  if (rows.length === 0) return <p className="dim disc-empty">{empty}</p>;

  return (
    <>
      <div className="disc-table-wrap">
        <table className="disc-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <SortHeader key={c.key} col={c} sort={sort} onSort={onSort} />
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={c.numeric ? "disc-td disc-td--num" : "disc-td"}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > PAGE ? (
        <p className="dim tiny disc-more">
          Showing the first {PAGE.toLocaleString()} of {sorted.length.toLocaleString()} — narrow the
          search or sort to bring the rest into view.
        </p>
      ) : null}
    </>
  );
}

/** A filter that is on when any chip is picked; an empty set means "everything". */
function ChipRow({
  label,
  options,
  picked,
  onToggle,
}: {
  label: string;
  options: { key: string; label: string; n?: number }[];
  picked: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="disc-chip-row">
      <span className="small-caps dim disc-chip-label">{label}</span>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          className={`disc-chip${picked.has(o.key) ? " disc-chip--on" : ""}`}
          onClick={() => onToggle(o.key)}
        >
          {o.label}
          {o.n != null ? <span className="dim tiny"> {o.n.toLocaleString()}</span> : null}
        </button>
      ))}
    </div>
  );
}

function useToggleSet(): [Set<string>, (k: string) => void, () => void] {
  const [set, setSet] = useState<Set<string>>(() => new Set());
  const toggle = (k: string) =>
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  return [set, toggle, () => setSet(new Set())];
}

/**
 * The values of a field, as chips — a filter list nobody has to maintain by hand.
 *
 * `limit` caps the list for fields whose values are open-ended, like a region name. Pass `Infinity`
 * where the set is closed and every member is worth filtering by: the owner asked for exactly that
 * on planet class, and he is right. Frequency is the wrong ranking for a filter, because the values
 * worth filtering *for* are the rare ones. On his data Earth-like world is the thirteenth commonest
 * class — 30 bodies against 10,170 Icy ones — so a top-twelve list cut off the very thing somebody
 * opens the panel to find, and Ammonia world, Water giant and Helium rich gas giant with it.
 *
 * Order stays by count, so the classes he has most of read first and the rarities sit at the end.
 */
function topValues<T>(rows: T[], read: (r: T) => string | null, limit = 12) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = read(r);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, n]) => ({ key, label: key, n }));
}

export type DiscoveriesTab = "systems" | "bodies" | "stars";

export function DiscoveriesTables({
  data,
  tab,
  onNavigateSystem,
}: {
  data: DiscoveriesDTO;
  tab: DiscoveriesTab;
  onNavigateSystem?: (systemAddress: number, bodyName?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "estimated", dir: -1 });
  const [classFilter, toggleClass, clearClass] = useToggleSet();
  const [flagFilter, toggleFlag, clearFlags] = useToggleSet();

  // Each tab has its own natural ordering and its own filter vocabulary; carrying one tab's sort
  // into another silently shows a table ordered by a column it does not have.
  useEffect(() => {
    setQuery("");
    clearClass();
    clearFlags();
    setSort({ key: tab === "stars" ? "mass" : "estimated", dir: -1 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const onSort = (key: string) =>
    setSort((s) => (s.key === key ? { key, dir: (s.dir === 1 ? -1 : 1) as 1 | -1 } : { key, dir: -1 }));

  const q = deferred.trim();

  /* ------------------------------------------------------------------ systems */
  if (tab === "systems") {
    const columns: Column<DiscoverySystemRow>[] = [
      {
        key: "name",
        label: "System",
        value: (r) => r.name,
        render: (r) =>
          onNavigateSystem ? (
            <button type="button" className="disc-link" onClick={() => onNavigateSystem(r.systemAddress)}>
              {r.name}
            </button>
          ) : (
            r.name
          ),
      },
      { key: "region", label: "Region", value: (r) => r.region, render: (r) => r.region ?? "—" },
      {
        key: "star",
        label: "Star",
        value: (r) => r.primaryStarType,
        render: (r) => r.primaryStarType ?? "—",
        title: "Type of the arrival star",
      },
      { key: "stars", label: "Stars", numeric: true, value: (r) => r.stars, render: (r) => count(r.stars) },
      { key: "bodies", label: "Bodies", numeric: true, value: (r) => r.bodies, render: (r) => count(r.bodies) },
      {
        key: "landables",
        label: "Land",
        numeric: true,
        value: (r) => r.landables,
        render: (r) => count(r.landables),
        title: "Landable bodies",
      },
      {
        key: "bio",
        label: "Bio",
        numeric: true,
        value: (r) => r.bioSignals,
        render: (r) => count(r.bioSignals),
        title: "Biological signals across the system",
      },
      {
        key: "species",
        label: "Species",
        numeric: true,
        value: (r) => r.speciesConfirmed,
        render: (r) => count(r.speciesConfirmed),
        title: "Species confirmed on foot here",
      },
      {
        key: "firsts",
        label: "Firsts",
        numeric: true,
        value: (r) => r.firstDiscoveries,
        render: (r) => count(r.firstDiscoveries),
        title: "Bodies you were the first to discover",
      },
      {
        key: "estimated",
        label: "Estimated",
        numeric: true,
        value: (r) => r.estimatedCredits,
        render: (r) => cr(r.estimatedCredits),
        title: "What the app values the system's scan data at",
      },
      {
        key: "sold",
        label: "Sold",
        numeric: true,
        value: (r) => (r.soldExplorationCredits ?? 0) + (r.soldExobiologyCredits ?? 0) || null,
        render: (r) => {
          const e = r.soldExplorationCredits;
          const b = r.soldExobiologyCredits;
          if (e == null && b == null) return <span className="dim">—</span>;
          return (
            <span title={`Cartographic ${cr(e ?? 0)} · Exobiology ${cr(b ?? 0)}`}>
              {cr((e ?? 0) + (b ?? 0))}
            </span>
          );
        },
        title:
          "What selling actually paid. Exobiology is exact; cartographic is apportioned across a sale by body count.",
      },
      { key: "visited", label: "Visited", value: (r) => r.firstVisit, render: (r) => date(r.firstVisit) },
    ];

    const regions = topValues(data.systems, (r) => r.region);
    const filtered = data.systems.filter((r) => {
      if (classFilter.size && !(r.region && classFilter.has(r.region))) return false;
      if (flagFilter.has("bio") && r.bioSignals <= 0) return false;
      if (flagFilter.has("species") && r.speciesConfirmed <= 0) return false;
      if (flagFilter.has("firsts") && r.firstDiscoveries <= 0) return false;
      if (flagFilter.has("footfall") && r.firstFootfalls <= 0) return false;
      if (flagFilter.has("sold") && r.soldExplorationCredits == null && r.soldExobiologyCredits == null)
        return false;
      if (flagFilter.has("unsold") && (r.soldExplorationCredits != null || r.soldExobiologyCredits != null))
        return false;
      if (flagFilter.has("earthlike") && r.earthLikes <= 0) return false;
      if (flagFilter.has("water") && r.waterWorlds <= 0) return false;
      if (flagFilter.has("ammonia") && r.ammoniaWorlds <= 0) return false;
      if (flagFilter.has("terra") && r.terraformables <= 0) return false;
      if (flagFilter.has("full") && !r.fullyScanned) return false;
      if (!q) return true;
      return fuzzyRankAny([r.name, r.region ?? "", r.primaryStarType ?? ""], q) != null;
    });

    return (
      <>
        <Search query={query} setQuery={setQuery} n={filtered.length} of={data.systems.length} what="systems" />
        <ChipRow label="Region" options={regions} picked={classFilter} onToggle={toggleClass} />
        <ChipRow
          label="Has"
          options={[
            { key: "bio", label: "Biology" },
            { key: "species", label: "Species found" },
            { key: "firsts", label: "First discovery" },
            { key: "footfall", label: "First footfall" },
            { key: "earthlike", label: "Earth-like" },
            { key: "water", label: "Water world" },
            { key: "ammonia", label: "Ammonia world" },
            { key: "terra", label: "Terraformable" },
            { key: "full", label: "Fully scanned" },
            { key: "sold", label: "Sold" },
            { key: "unsold", label: "Unsold" },
          ]}
          picked={flagFilter}
          onToggle={toggleFlag}
        />
        <Table
          rows={filtered}
          columns={columns}
          sort={sort}
          onSort={onSort}
          rowKey={(r) => String(r.systemAddress)}
          empty="No systems match."
        />
      </>
    );
  }

  /* ------------------------------------------------------------------- bodies */
  if (tab === "bodies") {
    const columns: Column<DiscoveryBodyRow>[] = [
      {
        key: "name",
        label: "Body",
        value: (r) => r.bodyName,
        render: (r) =>
          onNavigateSystem ? (
            <button
              type="button"
              className="disc-link"
              onClick={() => onNavigateSystem(r.systemAddress, r.bodyName)}
            >
              {r.bodyName}
            </button>
          ) : (
            r.bodyName
          ),
      },
      { key: "class", label: "Type", value: (r) => r.planetClass, render: (r) => r.planetClass },
      { key: "atmo", label: "Atmosphere", value: (r) => r.atmosphere, render: (r) => r.atmosphere ?? "—" },
      {
        key: "grav",
        label: "Gravity",
        numeric: true,
        value: (r) => r.gravityG,
        render: (r) => (r.gravityG == null ? "—" : `${num(r.gravityG, 2)} g`),
      },
      {
        key: "temp",
        label: "Temp",
        numeric: true,
        value: (r) => r.surfaceTemperatureK,
        render: (r) => (r.surfaceTemperatureK == null ? "—" : `${num(r.surfaceTemperatureK)} K`),
      },
      {
        key: "mass",
        label: "Mass",
        numeric: true,
        value: (r) => r.massEM,
        render: (r) => (r.massEM == null ? "—" : `${num(r.massEM, 3)} EM`),
      },
      {
        key: "radius",
        label: "Radius",
        numeric: true,
        value: (r) => r.radiusEarth,
        render: (r) => (r.radiusEarth == null ? "—" : `${num(r.radiusEarth, 3)} R⊕`),
        title: "Earth radii — the game's own frame, and free of the km/miles setting",
      },
      {
        key: "bio",
        label: "Bio",
        numeric: true,
        value: (r) => r.bioSignals,
        render: (r) => (r.bioSignals ? r.bioSignals : <span className="dim">—</span>),
      },
      {
        key: "species",
        label: "Found",
        value: (r) => r.speciesConfirmed.join(", ") || null,
        render: (r) =>
          r.speciesConfirmed.length ? (
            <span title={r.speciesConfirmed.join("\n")}>
              {r.speciesConfirmed.length === 1
                ? r.speciesConfirmed[0]
                : `${r.speciesConfirmed.length} species`}
            </span>
          ) : (
            <span className="dim">—</span>
          ),
        title: "Species you confirmed on foot",
      },
      {
        key: "estimated",
        label: "Estimated",
        numeric: true,
        value: (r) => r.estimatedCredits,
        render: (r) => cr(r.estimatedCredits),
      },
      { key: "system", label: "System", value: (r) => r.system, render: (r) => r.system },
      { key: "when", label: "Scanned", value: (r) => r.scannedAt, render: (r) => date(r.scannedAt) },
    ];

    // Every class present, however few: see `topValues`. Seventeen of them on this commander's
    // data, which is a readable row of chips and a complete one.
    const classes = topValues(data.bodies, (r) => r.planetClass, Infinity);
    const filtered = data.bodies.filter((r) => {
      if (classFilter.size && !classFilter.has(r.planetClass)) return false;
      if (flagFilter.has("landable") && r.landable !== true) return false;
      if (flagFilter.has("bio") && !(r.bioSignals && r.bioSignals > 0)) return false;
      if (flagFilter.has("species") && r.speciesConfirmed.length === 0) return false;
      if (flagFilter.has("dss") && !r.dssMapped) return false;
      if (flagFilter.has("first") && !r.firstDiscoverer) return false;
      if (flagFilter.has("footfall") && !r.firstFootfall) return false;
      if (flagFilter.has("terra") && !/terraformable/i.test(r.terraformState ?? "")) return false;
      if (flagFilter.has("volcanic") && !r.volcanism) return false;
      if (flagFilter.has("atmo") && !r.atmosphere) return false;
      if (!q) return true;
      return (
        fuzzyRankAny(
          [r.bodyName, r.system, r.planetClass, r.atmosphere ?? "", r.volcanism ?? "", ...r.speciesConfirmed],
          q,
        ) != null
      );
    });

    return (
      <>
        <Search query={query} setQuery={setQuery} n={filtered.length} of={data.bodies.length} what="bodies" />
        <ChipRow label="Type" options={classes} picked={classFilter} onToggle={toggleClass} />
        <ChipRow
          label="Only"
          options={[
            { key: "landable", label: "Landable" },
            { key: "atmo", label: "Has atmosphere" },
            { key: "volcanic", label: "Volcanic" },
            { key: "bio", label: "Biology" },
            { key: "species", label: "Species found" },
            { key: "dss", label: "Mapped" },
            { key: "first", label: "First discovery" },
            { key: "footfall", label: "First footfall" },
            { key: "terra", label: "Terraformable" },
          ]}
          picked={flagFilter}
          onToggle={toggleFlag}
        />
        <Table
          rows={filtered}
          columns={columns}
          sort={sort}
          onSort={onSort}
          rowKey={(r) => r.key}
          empty="No bodies match."
        />
      </>
    );
  }

  /* -------------------------------------------------------------------- stars */
  const columns: Column<DiscoveryStarRow>[] = [
    {
      key: "name",
      label: "Star",
      value: (r) => r.bodyName,
      render: (r) =>
        onNavigateSystem ? (
          <button
            type="button"
            className="disc-link"
            onClick={() => onNavigateSystem(r.systemAddress, r.bodyName)}
          >
            {r.bodyName}
          </button>
        ) : (
          r.bodyName
        ),
    },
    {
      key: "type",
      label: "Class",
      value: (r) => r.starType,
      render: (r) => `${r.starType}${r.subclass != null ? r.subclass : ""}`,
    },
    { key: "lum", label: "Lum", value: (r) => r.luminosity, render: (r) => r.luminosity ?? "—" },
    {
      key: "mass",
      label: "Mass",
      numeric: true,
      value: (r) => r.solarMasses,
      render: (r) => (r.solarMasses == null ? "—" : `${num(r.solarMasses, 3)} M☉`),
    },
    {
      key: "radius",
      label: "Radius",
      numeric: true,
      value: (r) => r.radiusSolar,
      render: (r) => (r.radiusSolar == null ? "—" : `${num(r.radiusSolar, 3)} R☉`),
      title: "Solar radii, as the game shows a star",
    },
    {
      key: "temp",
      label: "Temp",
      numeric: true,
      value: (r) => r.surfaceTemperatureK,
      render: (r) => (r.surfaceTemperatureK == null ? "—" : `${num(r.surfaceTemperatureK)} K`),
    },
    {
      key: "estimated",
      label: "Estimated",
      numeric: true,
      value: (r) => r.estimatedCredits,
      render: (r) => cr(r.estimatedCredits),
    },
    { key: "region", label: "Region", value: (r) => r.region, render: (r) => r.region ?? "—" },
    { key: "system", label: "System", value: (r) => r.system, render: (r) => r.system },
    { key: "when", label: "Scanned", value: (r) => r.scannedAt, render: (r) => date(r.scannedAt) },
  ];

  /*
    Every star type, for the same reason as planet class.

    The cap of 16 hid seven of this commander's 23, and they were the ones worth filtering for:
    neutron stars (2), Wolf-Rayet (1), Herbig Ae/Be (2) and three white-dwarf classes. A black hole
    survived at rank 12 by luck rather than design. Twenty-three chips is the same order as the
    seventeen on Bodies and reads as one row.
  */
  const types = topValues(data.stars, (r) => r.starType, Infinity);
  const filtered = data.stars.filter((r) => {
    if (classFilter.size && !classFilter.has(r.starType)) return false;
    if (flagFilter.has("first") && !r.firstDiscoverer) return false;
    if (!q) return true;
    return fuzzyRankAny([r.bodyName, r.system, r.starType, r.luminosity ?? "", r.region ?? ""], q) != null;
  });

  return (
    <>
      <Search query={query} setQuery={setQuery} n={filtered.length} of={data.stars.length} what="stars" />
      <ChipRow label="Class" options={types} picked={classFilter} onToggle={toggleClass} />
      <ChipRow
        label="Only"
        options={[{ key: "first", label: "First discovery" }]}
        picked={flagFilter}
        onToggle={toggleFlag}
      />
      <Table
        rows={filtered}
        columns={columns}
        sort={sort}
        onSort={onSort}
        rowKey={(r) => r.key}
        empty="No stars match."
      />
    </>
  );
}

function Search({
  query,
  setQuery,
  n,
  of,
  what,
}: {
  query: string;
  setQuery: (s: string) => void;
  n: number;
  of: number;
  what: string;
}) {
  return (
    <div className="my-exo-search">
      <input
        type="search"
        className="my-exo-search-input"
        placeholder={`Search ${what}…`}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <span className="my-exo-search-count dim tiny">
        {n === of ? `${of.toLocaleString()} ${what}` : `${n.toLocaleString()} of ${of.toLocaleString()}`}
      </span>
    </div>
  );
}
